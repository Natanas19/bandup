/* eslint-disable @typescript-eslint/no-require-imports */
// Offline only: reads sources. Never imports a DB client or invokes a process.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const a = require('./historical-public-read-layer-artifacts.cjs');
const base = 'supabase/tests/';
const sql = name => a.read(base + name + '.sql');
const sha = text => createHash('sha256').update(text).digest('hex');

test('19 decoded archived elements retain the independently recorded canonical hash', () => {
  assert.equal(a.evidence.version, '20261004120000');
  assert.equal(a.evidence.name, 'public_read_layer');
  assert.equal(a.evidence.statements.length, 19);
  assert.equal(sha(JSON.stringify(a.evidence.statements)), '51437fbe5bebfd41b6baac17d4be80956d7b952d4a385aa84f52391b50706445');
  assert.equal(a.evidence.canonical_json_sha256, sha(JSON.stringify(a.evidence.statements)));
  assert.equal(a.evidence.archive_sha256, '0ce7f630719d36396cfa5336960a92699210c11b5c6f5d805c47bc24a0929e96');
  assert.match(a.evidence.source, /not the original/);
  const altered = [...a.evidence.statements];
  altered[10] = altered[10].replace('start_at >= now()', 'true');
  assert.notEqual(sha(JSON.stringify(altered)), a.evidence.canonical_json_sha256);
});

test('fixture embeds each exact statement in original order, without silent normalization', () => {
  const fixture = sql('historical_public_read_layer_fixture');
  assert.equal(fixture, a.fixture());
  const body = fixture.split('-- BEGIN ARCHIVED STATEMENTS: exact decoded elements; added semicolon separators.\n')[1]
    .split('-- END ARCHIVED STATEMENTS')[0];
  const chunks = body.split(/-- ARCHIVED STATEMENT \d+\n/).slice(1);
  assert.deepEqual(chunks.map((s, i) => {
    const expected = a.evidence.statements[i] + ';\n';
    assert.ok(s.startsWith(expected));
    assert.equal(s.slice(expected.length).trim(), '');
    return s.slice(0, a.evidence.statements[i].length);
  }), a.evidence.statements);
  assert.match(body, /GRANT bandup_public_reader TO CURRENT_USER/);
  assert.match(body, /GRANT USAGE, CREATE ON SCHEMA public/);
  assert.doesNotMatch(body, /REVOKE CREATE|REVOKE bandup_public_reader|TO anon, authenticated|CREATE FUNCTION|CREATE TRIGGER/);
  assert.match(body, /TO anon;\s*$/);
  assert.doesNotMatch(fixture, /INSERT INTO auth|INSERT INTO public/);
});

test('independent lab gate is deliberately unbound, never a configurable existing-lab bypass', () => {
  const gate = sql('historical_lab_identity_check');
  assert.match(gate, /RAISE EXCEPTION 'Historical laboratory identity not reviewed; execution disabled'/);
  const code = gate.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /\bIF\b|current_setting|\\if|\\connect|CREATE|ALTER|GRANT|COMMIT/);
  assert.match(gate, /5433, 5434/);
  assert.match(gate, /7701800113631615116/);
});

test('all executable new SQL gates before objects/data and uses explicit transaction endings', () => {
  for (const [name, ending] of [
    ['historical_lab_bootstrap', 'COMMIT'], ['historical_public_read_layer_fixture', 'COMMIT'],
    ['historical_post_m8', 'ROLLBACK'], ['historical_public_read_layer_checks', 'ROLLBACK'],
    ['historical_public_read_layer_negative', 'ROLLBACK'], ['historical_bridge_rejection', 'ROLLBACK'],
  ]) {
    const source = sql(name);
    const gateAt = source.indexOf('\\ir historical_lab_identity_check.sql');
    assert.ok(source.indexOf('BEGIN') < gateAt, name);
    const code = source.replace(/--[^\n]*/g, '');
    const firstWrite = code.search(/\b(?:CREATE|INSERT|ALTER|GRANT|REVOKE)\b/);
    assert.ok(firstWrite < 0 || code.indexOf('\\ir historical_lab_identity_check.sql') < firstWrite, name);
    assert.match(source, new RegExp(ending + ';\\s*$'), name);
    if (ending === 'ROLLBACK') assert.doesNotMatch(code, /\bCOMMIT;/, name);
    assert.doesNotMatch(source, /\\ir (?:compatibility_lab_identity|publication_compatibility_target)/, name);
    assert.doesNotMatch(code, /supabase_migrations|\\(?:connect|!|gexec)\b/, name);
  }
});

test('bootstrap and PostM8 reuse existing contracts only with the independent gate', () => {
  assert.equal(sql('historical_lab_bootstrap'), a.bootstrap());
  assert.equal(sql('historical_post_m8'), a.postM8());
  const bootstrap = sql('historical_lab_bootstrap');
  assert.match(bootstrap, /Bootstrap collision/);
  assert.match(bootstrap, /pg_default_acl/);
  assert.match(bootstrap, /CREATE FUNCTION auth.uid/);
  assert.doesNotMatch(bootstrap.replace(/--[^\n]*/g, ''), /CREATE ROLE bandup_|CREATE SCHEMA private|CREATE EXTENSION/);
});

test('historical checker requires temporal RLS as well as exact archived view bodies', () => {
  const checker = sql('historical_public_read_layer_contract');
  assert.ok(checker.endsWith(a.expectedViews()));
  for (const token of ['start_at>=nowandexistsselect1frompublic.bands', "polcmd='r'", 'polpermissive',
    'polroles=ARRAY[reader]', 'polwithcheck IS NULL', '0=ANY(polroles)', 'policy inventory',
    'relrowsecurity', 'relowner<>reader', 'pg_get_viewdef', 'security_invoker=false', 'security_barrier=true',
    'reader membership', 'admin_option', 'persistent CREATE', 'reader column ACL', 'acl.is_grantable',
    'has_any_column_privilege', 'application powers', 'anonymous source access', 'later objects']) assert.ok(checker.includes(token), token);
  assert.match(checker, /IF ok IS DISTINCT FROM true THEN/);
  assert.match(checker, /NOT pg_catalog.has_table_privilege\('authenticated',view_oid,'SELECT'\)/);
  assert.match(checker, /NOT pg_catalog.has_table_privilege\('service_role',view_oid,'SELECT'\)/);
});

test('behavior suite distinguishes direct reader RLS, anon views and exact permission denials', () => {
  const source = sql('historical_public_read_layer_checks');
  const data = sql('historical_public_read_layer_data');
  for (const token of ['SET LOCAL ROLE bandup_public_reader', 'SET LOCAL ROLE anon',
    'SET LOCAL ROLE authenticated', 'SET LOCAL ROLE service_role', 'reader hides private-band events',
    'anon hides private-band and past events', 'anon hides private-band links',
    'FROM public.events', 'FROM public.public_events', 'EXCEPTION WHEN insufficient_privilege THEN RETURN']) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /WHEN OTHERS|GRANT SELECT/);
  assert.match(data, /pg_catalog.now\(\)-interval '1 day'/);
  assert.match(data, /\(pg_catalog.now\(\)\)/);
  assert.match(data, /pg_catalog.now\(\)\+interval '1 day'/);
  assert.match(data, /javascript:historical-fixture/);
  assert.doesNotMatch(data, /COMMIT|ROLLBACK|ALTER|GRANT|CREATE/);
});

test('negative setup failures never count as rejection and every mutation is undone', () => {
  const source = sql('historical_public_read_layer_negative');
  assert.ok(source.includes("EXECUTE mutation; -- Outside the rejection handler"));
  assert.match(source, /EXECUTE mutation;[^]*?BEGIN\n      PERFORM pg_temp.historical_check\(\);/);
  assert.match(source, /EXCEPTION WHEN SQLSTATE 'P0001' THEN\n      IF SQLERRM<>expected_message THEN RAISE; END IF;/);
  assert.match(source, /IF NOT rejected THEN RAISE EXCEPTION/);
  assert.match(source, /RAISE SQLSTATE 'ZX001';/);
  assert.match(source, /EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;/);
  assert.match(source, /END;\n  PERFORM pg_temp.historical_check\(\);/);
  assert.doesNotMatch(source, /WHEN OTHERS/);
  assert.equal((source.match(/^SELECT pg_temp.historical_reject\(/gm) || []).length, 31);
  for (const token of ['REVOKE CREATE', 'REVOKE bandup_public_reader', 'USING (true)',
    'BYPASSRLS', 'TO PUBLIC', 'DISABLE ROW LEVEL SECURITY', 'OWNER TO CURRENT_USER', 'security_invoker=true']) assert.ok(source.includes(token), token);
});

test('direct schema ACLs cannot be replaced by PUBLIC or inherited USAGE', () => {
  const source = sql('historical_public_read_layer_contract');
  const validate = text => {
    const helper = text.split('AS $schema_acl$')[1].split('$schema_acl$;')[0];
    assert.match(helper, /pg_catalog.aclexplode\(n.nspacl\)/);
    assert.match(helper, /a.grantee=role_name::regrole::oid/);
    assert.match(helper, /array_agg\(a.privilege_type ORDER BY a.privilege_type\)/);
    assert.match(helper, /\)=privileges/);
    assert.match(helper, /a.is_grantable/);
    assert.doesNotMatch(helper, /has_schema_privilege\(/);
    assert.match(text, /pg_temp.historical_schema_acl\(item.role_name,item.schema_name,item.privileges\)/);
    assert.match(text, /effective schema USAGE/);
  };
  validate(source);
  assert.throws(() => validate(source.replaceAll('a.grantee=role_name::regrole::oid', 'true')), assert.AssertionError);
  assert.throws(() => validate(source.replace(')=privileges', ') IS NOT NULL')), assert.AssertionError);
  assert.throws(() => validate(source.replaceAll('a.is_grantable', 'false')), assert.AssertionError);
  for (const role of ['anon','authenticated','service_role']) {
    for (const schema of ['public','auth']) assert.ok(source.includes(`('${role}','${schema}',ARRAY['USAGE']::text[])`));
  }
  assert.ok(source.includes("('authenticated','private',ARRAY['USAGE']::text[])"));
  assert.ok(source.includes("('bandup_public_reader','public',ARRAY['CREATE','USAGE']::text[])"));
  const negatives = sql('historical_public_read_layer_negative');
  assert.ok(negatives.includes('GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE USAGE ON SCHEMA public FROM bandup_public_reader'));
  for (const schema of ['public','auth','private']) assert.ok(negatives.includes(`REVOKE USAGE ON SCHEMA ${schema} FROM authenticated`));
  const bootstrap = sql('historical_lab_bootstrap');
  assert.match(bootstrap, /FOREACH schema_name IN ARRAY ARRAY\['public','auth'\]/);
  assert.match(bootstrap, /a.grantee=role_name::regrole::oid AND a.privilege_type='USAGE' AND NOT a.is_grantable/);
});

test('PG17 membership options are explicit and independent of reader NOINHERIT', () => {
  const source = sql('historical_public_read_layer_contract');
  const validate = text => {
    const membership = text.split("'reader flags');")[1].split("'reader membership');")[0];
    assert.match(membership, /member=CURRENT_USER::regrole::oid AND grantor=10/);
    assert.match(membership, /NOT admin_option AND inherit_option AND set_option/);
    assert.match(text, /SESSION_USER=CURRENT_USER/);
    assert.match(text, /AND rolsuper AND rolinherit/);
  };
  validate(source);
  for (const option of ['admin_option', 'inherit_option', 'set_option']) {
    assert.throws(() => validate(source.replaceAll(option, 'true')), assert.AssertionError);
  }
  assert.match(sql('historical_public_read_layer_fixture'), /AND rolsuper AND rolinherit/);
  const negatives = sql('historical_public_read_layer_negative');
  for (const option of ['ADMIN TRUE','INHERIT FALSE','SET FALSE']) {
    assert.ok(negatives.includes('GRANT bandup_public_reader TO CURRENT_USER WITH ' + option));
  }
  // The archived GRANT remains untouched; options describe the controlled lab.
  assert.equal(a.evidence.statements[1], 'GRANT bandup_public_reader TO CURRENT_USER');
});

test('every historical SQL file including includes rechecks the unbound gate before work', () => {
  const validate = source => {
    const code = source.replace(/--[^\n]*/g, '');
    assert.match(code, /^\s*\\set ON_ERROR_STOP on/m);
    const gate = code.indexOf('\\ir historical_lab_identity_check.sql');
    assert.ok(gate>=0);
    const firstWork = code.search(/\b(?:CREATE|INSERT|ALTER|GRANT|REVOKE|SELECT|DO)\b/);
    assert.ok(firstWork<0 || gate<firstWork);
    assert.doesNotMatch(code, /\\if|historical_verified|set_config\('.*verified/);
  };
  const names = fs.readdirSync(path.join(__dirname, '../supabase/tests'))
    .filter(n => /^historical_.*\.sql$/.test(n) && n!=='historical_lab_identity_check.sql');
  for (const name of names) {
    const source = a.read(base + name);
    validate(source);
    assert.throws(() => validate(source.replace('\\ir historical_lab_identity_check.sql','')), assert.AssertionError, name);
  }
  for (const include of ['historical_public_read_layer_contract','historical_public_read_layer_data']) {
    const source = sql(include);
    assert.ok(source.indexOf('\\ir historical_lab_identity_check.sql') < source.search(/^(?:CREATE|INSERT)/m));
  }
});

test('Bridge rejection copies the exact current read-only preflight, not migration DDL', () => {
  const rejection = sql('historical_bridge_rejection');
  assert.equal(rejection, a.bridgeRejection());
  assert.equal(rejection.split('$bridge_readonly$')[1].trim(), a.bridgeContract());
  assert.match(rejection, /IF SQLERRM<>'Reader powers\/membership\/schema ACL differs' THEN RAISE; END IF;/);
  assert.match(rejection, /IF NOT rejected THEN RAISE EXCEPTION/);
  assert.equal((rejection.match(/^SELECT pg_temp.historical_check\(\);/gm) || []).length, 2);
  assert.doesNotMatch(rejection, /WHEN OTHERS|\\ir .*migrations|COMMIT;/);
});

test('SQL includes resolve locally and prepared PL/pgSQL retains protected IF syntax', () => {
  const { assertProtectedIfCases } = require('./publication-contracts.cjs');
  for (const name of fs.readdirSync(path.join(__dirname, '../supabase/tests')).filter(n => /^historical_.*\.sql$/.test(n))) {
    const source = a.read(base + name);
    assert.doesNotThrow(() => assertProtectedIfCases(source), name);
    for (const [, include] of source.matchAll(/^\\ir ([a-z_]+\.sql)$/gm)) {
      assert.ok(fs.existsSync(path.join(__dirname, '../supabase/tests', include)), name + ': ' + include);
    }
  }
});
