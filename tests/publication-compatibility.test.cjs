/* eslint-disable @typescript-eslint/no-require-imports */
/* Offline security/source-contract checks only. No SQL client or network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const bridge = read('supabase/migrations/20261028000000_legacy_publication_compatibility.sql');
const url = read('supabase/migrations/20261028010000_legacy_external_link_url_safety.sql');
const oldProfile = read('supabase/migrations/20261020000000_public_band_profiles.sql');
const oldUrl = read('supabase/migrations/20261027000000_external_link_url_safety.sql');
const suite = read('supabase/tests/publication_compatibility.sql');
const fixture = read('supabase/tests/legacy_publication_fixture.sql');
const target = read('supabase/tests/publication_compatibility_target.sql');
const body = (sql, tag) => sql.split(`AS $${tag}$`)[1].split(`$${tag}$;`)[0];

test('legacy bridge is transactional, preserves band flags and fails on collisions', () => {
  assert.match(bridge, /BEGIN;/);
  assert.match(bridge, /COMMIT;\s*$/);
  assert.match(bridge, /lock_timeout = '5s'/);
  assert.doesNotMatch(bridge, /CREATE\s+(?:ROLE|TABLE|VIEW|POLICY|FUNCTION)\s+IF NOT EXISTS|ADD COLUMN IF NOT EXISTS|DROP (ROLE|POLICY|VIEW public\.|TABLE public\.)/i);
  assert.doesNotMatch(bridge, /ALTER TABLE public\.bands|UPDATE public\.|DELETE FROM public\.|INSERT INTO public\./i);
  assert.match(bridge, /ADD COLUMN is_public boolean NOT NULL DEFAULT false/);
  for (const token of ['bandup_profile_reader', 'relrowsecurity', 'relowner', 'tgenabled',
    'attnotnull', 'attgenerated', 'pg_get_viewdef', 'pg_auth_members', 'column_privilege']) {
    assert.ok(bridge.includes(token), token);
  }
});

test('both public link surfaces and both readers require the link and band flags', () => {
  assert.match(bridge, /ALTER POLICY social_links_select_for_public_reader[\s\S]*?USING \(is_public IS TRUE AND EXISTS/);
  assert.doesNotMatch(bridge, /CREATE POLICY social_links_select_for_public_reader/);
  assert.match(bridge, /CREATE POLICY social_links_select_for_profile_reader[\s\S]*?TO bandup_profile_reader USING \(is_public IS TRUE/);
  const legacy = bridge.split('CREATE OR REPLACE VIEW public.public_social_links')[1].split('CREATE VIEW public.public_band_profiles')[0];
  assert.match(legacy, /WHERE is_public IS TRUE AND EXISTS/);
  assert.match(legacy, /band\.is_public IS TRUE/);
  const profile = bridge.split('CREATE VIEW public.public_band_profiles')[1];
  assert.match(profile, /link\.is_public IS TRUE/);
  assert.match(profile, /WHERE band\.is_public IS TRUE/);
  assert.match(bridge, /b\.contract=a\.contract/);
});

test('before/after snapshots have identical definitions and distinguish intentional column grants from writes', () => {
  const before = bridge.split('CREATE TEMP TABLE bandup_compat_before ON COMMIT DROP AS\n')[1].split(';')[0];
  const after = bridge.split('CREATE TEMP TABLE bandup_compat_after ON COMMIT DROP AS\n')[1].split(';')[0];
  assert.equal(before, after);
  assert.match(before, /acl\.grantee<>c\.relowner/);
  assert.match(before, /acl\.grantee IS DISTINCT FROM[\s\S]*?bandup_profile_reader/);
  assert.match(bridge, /has_any_column_privilege\(r,relation_oid,'INSERT,UPDATE,REFERENCES'\)/);
  assert.match(bridge, /Profile reader received non-projection columns/);
});

test('authorization retains M7 rules with an explicit fail-closed URL-stage gate', () => {
  const extract = sql => sql.slice(sql.indexOf('CREATE FUNCTION private.guard_band_publication()'),
    sql.indexOf('CREATE ROLE bandup_', sql.indexOf('CREATE FUNCTION private.guard_band_publication()')))
    .replace(/--[^\n]*/g, '').trim();
  const gate = /  IF NEW\.is_public IS TRUE\n     AND \(pg_catalog\.to_regprocedure\('private\.guard_external_link_url_v1\(\)'\) IS NULL[\s\S]*?      CONSTRAINT = 'social_links_url_stage_required';\n  END IF;\n\n/;
  assert.match(bridge, gate);
  assert.match(bridge.match(gate)[0], /t\.tgname='social_links_zz_guard_external_url'/);
  assert.match(bridge.match(gate)[0], /t\.tgenabled='O'/);
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  assert.equal(normalize(extract(bridge).replace(gate, '')), normalize(extract(oldProfile)));
  assert.match(bridge, /ALTER VIEW public\.public_band_profiles OWNER TO bandup_profile_reader/);
  assert.doesNotMatch(bridge, /ALTER ROLE bandup_public_reader|REVOKE bandup_public_reader FROM CURRENT_USER/);
});

test('reviewed preflights and rollback-only negative suites match local historical contracts', () => {
  const { contractBlock, protectIfCaseExpressions, negativeSuite } = require('./publication-contracts.cjs');
  for (const [stage, sql] of [['bridge', bridge], ['url', url]]) {
    assert.ok(sql.includes(protectIfCaseExpressions(contractBlock(stage))), stage + ' contract drift');
    const negative = read('supabase/tests/compatibility_negative_' + stage + '.sql');
    assert.equal(negative, negativeSuite(stage));
    assert.equal((negative.match(/SELECT pg_temp.reject_drift\(/g) || []).length, 28);
    assert.ok(negative.indexOf('\\ir publication_compatibility_target.sql') < negative.indexOf('CREATE FUNCTION'));
    assert.match(negative, /ROLLBACK;\s*$/);
    assert.doesNotMatch(negative, /COMMIT;/);
    for (const token of ['tgqual IS NULL', "tgattr=''", 'tgnargs=0', 'tgconstraint=0',
      'proowner', 'proconfig IS DISTINCT FROM', 'actual.prosrc', 'actual.proargtypes',
      'm.admin_option', 'Reader policy differs', 'Anonymous source privileges',
      'Unexpected public view column ACL', 'Unexpected public view table ACL']) assert.ok(sql.includes(token), token);
  }
});

test('negative suites pin transaction search_path before baseline policy deparsing', () => {
  const { negativeSuite } = require('./publication-contracts.cjs');
  const setting = "SET LOCAL search_path = '';";
  const assertPinned = sql => {
    // Function-local settings do not protect either standalone baseline DO block.
    const preamble = sql.split('CREATE FUNCTION pg_temp.reject_drift')[0];
    assert.match(preamble, /BEGIN;\n(?:--[^\n]*\n)*SET LOCAL search_path = '';\n\\ir publication_compatibility_target\.sql/);
    assert.equal((sql.match(/^SET LOCAL search_path = '';$/gm) || []).length, 1);
    assert.match(sql, /LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS \$negative\$/);
    assert.equal((sql.match(/DO \$baseline\$/g) || []).length, 2);
  };
  for (const stage of ['bridge', 'url']) {
    const sql = read('supabase/tests/compatibility_negative_' + stage + '.sql');
    assert.equal(sql, negativeSuite(stage));
    assertPinned(sql);
    assert.throws(() => assertPinned(sql.replace(setting, '')), assert.AssertionError);
    assert.throws(() => assertPinned(sql.replace(setting, "SET search_path = '';")), assert.AssertionError);
    assert.throws(() => assertPinned(sql.replace(setting, 'SET LOCAL search_path = public;')), assert.AssertionError);
    const lateSetting = sql.replace(setting + '\n', '').replace('-- Re-run baseline', setting + '\n-- Re-run baseline');
    assert.throws(() => assertPinned(lateSetting), assert.AssertionError);
  }
});

test('proposed migrations protect every IF/CASE delimiter and match the negative/PostM8 contracts', () => {
  const { contractBlock, protectIfCaseExpressions, assertProtectedIfCases } = require('./publication-contracts.cjs');
  const { postM8ReviewedContract, postM8Suite } = require('./post-m8-contracts.cjs');
  const expressions = [
    /\(CASE WHEN expected\.result_type='boolean'[\s\S]*?END ELSE '' END\)/,
    /\(CASE WHEN reader='bandup_public_reader'::regrole::oid THEN 3 ELSE 2 END\)/,
  ];
  // Migrations contain diagnostics such as '--no-owner' inside SQL literals.
  assert.doesNotThrow(() => assertProtectedIfCases("DO $$ BEGIN IF ok THEN RAISE EXCEPTION '--no-owner; IF CASE'; END IF; END; $$;"));
  for (const [stage, sql] of [['bridge', bridge], ['url', url]]) {
    const original = contractBlock(stage);
    const corrected = protectIfCaseExpressions(original);
    assert.doesNotThrow(() => assertProtectedIfCases(sql));
    assert.ok(sql.includes(corrected), stage + ' must retain every reviewed predicate');
    let unwrapped = corrected;
    for (const expression of expressions) {
      assert.match(sql, expression);
      const mutation = sql.replace(expression, match => match.slice(1, -1));
      assert.throws(() => assertProtectedIfCases(mutation), /Unprotected CASE/);
      unwrapped = unwrapped.replace(expression, match => match.slice(1, -1));
    }
    assert.equal(unwrapped, original, 'exactly four added parentheses, no contract changes');
    const negative = read('supabase/tests/compatibility_negative_' + stage + '.sql');
    const embedded = negative.split('INSERT INTO reviewed_check VALUES ($check$\n')[1].split('$check$);')[0];
    const body = corrected.slice(corrected.indexOf('DO $reviewed_contract$')).split('-- END REVIEWED CONTRACT')[0];
    assert.equal(embedded, body + '\n');
    if (stage === 'bridge') assert.equal(corrected, postM8ReviewedContract());
  }
  assert.equal(read('supabase/tests/compatibility_post_m8.sql'), postM8Suite());
});

test('both negative suites protect SQL CASE inside IF and preserve the exact security predicates', () => {
  const { contractBlock, protectIfCaseExpressions, assertProtectedIfCases } = require('./publication-contracts.cjs');
  const argumentCase = /\(CASE WHEN expected\.result_type='boolean'[\s\S]*?END ELSE '' END\)/;
  const inventoryCase = /\(CASE WHEN reader='bandup_public_reader'::regrole::oid THEN 3 ELSE 2 END\)/;
  const unwrap = match => match.slice(1, -1);
  for (const stage of ['bridge', 'url']) {
    const original = contractBlock(stage);
    const protectedBlock = protectIfCaseExpressions(original);
    assert.throws(() => assertProtectedIfCases(original), /Unprotected CASE/);
    assert.doesNotThrow(() => assertProtectedIfCases(protectedBlock));
    assert.equal(protectedBlock.replace(argumentCase, unwrap).replace(inventoryCase, unwrap), original);
    const negative = read('supabase/tests/compatibility_negative_' + stage + '.sql');
    const embedded = negative.split('INSERT INTO reviewed_check VALUES ($check$\n')[1].split('$check$);')[0];
    const expected = protectedBlock.slice(protectedBlock.indexOf('DO $reviewed_contract$')).split('-- END REVIEWED CONTRACT')[0];
    assert.equal(embedded, expected + '\n');
    assert.doesNotThrow(() => assertProtectedIfCases(negative));
    for (const expression of [argumentCase, inventoryCase]) {
      assert.match(embedded, expression);
      assert.throws(() => assertProtectedIfCases(negative.replace(expression, unwrap)), /Unprotected CASE/);
    }
  }
});

test('all compatibility test SQL is scanned for the IF/CASE delimiter regression, including dollar-quoted checks', () => {
  const { assertProtectedIfCases } = require('./publication-contracts.cjs');
  const directory = path.join(root, 'supabase/tests');
  const names = fs.readdirSync(directory).filter(name => /^(compatibility_|publication_compatibility|legacy_publication_fixture).*\.sql$/.test(name));
  assert.ok(names.includes('compatibility_negative_bridge.sql'));
  assert.ok(names.includes('compatibility_negative_url.sql'));
  for (const name of names) assert.doesNotThrow(() => assertProtectedIfCases(read('supabase/tests/' + name)), name);
});

test('prepared SQL has balanced lexical parentheses and phase checks remain inside the reader loop', () => {
  const names = [
    'supabase/migrations/20261028000000_legacy_publication_compatibility.sql',
    'supabase/migrations/20261028010000_legacy_external_link_url_safety.sql',
    ...['compatibility_negative_bridge', 'compatibility_negative_url', 'compatibility_url_cases',
      'compatibility_url_fixture', 'compatibility_url_safety', 'compatibility_interstage_publication']
      .map(name => 'supabase/tests/' + name + '.sql'),
  ];
  for (const name of names) {
    const lexical = read(name).replace(/--[^\n]*/g, '').replace(/'(?:''|[^'])*'/g, "''");
    let depth = 0;
    for (const char of lexical) {
      if (char === '(') depth++;
      if (char === ')') depth--;
      assert.ok(depth >= 0, name + ' extra closing parenthesis');
    }
    assert.equal(depth, 0, name + ' unclosed parenthesis');
  }
  for (const sql of [bridge, url]) {
    assert.match(sql, /FOR reader IN[\s\S]*?Reader powers\/membership\/schema ACL differs[\s\S]*?Reader policy inventory differs[\s\S]*?FOR expected IN SELECT p\.\*/);
  }
});

test('URL corpus and upgrade fixtures cover both public surfaces without disabling guards', () => {
  const cases = JSON.parse(read('supabase/tests/external_link_url_cases.json'));
  const corpus = read('supabase/tests/compatibility_url_cases.sql');
  cases.forEach((entry, index) => {
    const value = entry.input === null ? 'NULL' : `pg_catalog.convert_from(pg_catalog.decode('${Buffer.from(entry.input).toString('hex')}', 'hex'), 'UTF8')`;
    assert.ok(corpus.includes(`(${index}, ${value}, ${entry.sql})`), 'case ' + index);
  });
  const sql = read('supabase/tests/compatibility_url_safety.sql');
  for (const token of ['public.public_social_links', 'public.public_band_profiles', 'SET LOCAL ROLE anon',
    'SET LOCAL ROLE authenticated', 'social_links_external_url_safe', 'ON CONFLICT', 'bulk atomicity',
    'legacy values unchanged', 'complete validator corpus']) assert.ok(sql.includes(token), token);
  assert.doesNotMatch(sql, /DISABLE TRIGGER|session_replication_role/);
  assert.match(sql, /ROLLBACK;\s*$/);
  for (const name of ['compatibility_url_fixture.sql', 'compatibility_url_safety.sql', 'compatibility_interstage_publication.sql']) {
    const content = read('supabase/tests/' + name);
    assert.ok(content.indexOf('\\ir publication_compatibility_target.sql') < content.indexOf(name.includes('fixture') ? 'INSERT INTO' : 'CREATE FUNCTION'));
  }
  const stage = read('supabase/tests/compatibility_interstage_publication.sql');
  assert.match(stage, /social_links_url_stage_required/);
  assert.match(stage, /ON CONFLICT/);
  assert.match(stage, /ROLLBACK;\s*$/);
});

test('compatibility manifest explicitly orders alternatives and requires M8 before the bridge', () => {
  const manifest = JSON.parse(read('supabase/compatibility-publication.manifest.json'));
  assert.equal(manifest.automaticDbPush, false);
  assert.deepEqual(manifest.orderedCandidates, [
    'migrations/20261028000000_legacy_publication_compatibility.sql',
    'migrations/20261028010000_legacy_external_link_url_safety.sql',
    'migrations/20261027010000_functional_integrity.sql',
  ]);
  assert.equal(manifest.excludedOriginalAlternatives.length, 2);
  assert.ok(manifest.prerequisites.some(text => text.includes('20261023000000') && text.includes('BEFORE')));
});

test('URL branch retains exact validator and trigger behavior and covers the legacy endpoint', () => {
  assert.equal(body(url, 'url_validator'), body(oldUrl, 'url_validator'));
  assert.equal(body(url, 'url_guard'), body(oldUrl, 'url_guard'));
  assert.match(url, /count\(\*\)[^\n]*social_links[^\n]*<> 6/);
  assert.match(url, /WHERE rolname = 'bandup_profile_reader'/);
  assert.match(url, /'social_links_select_for_public_reader', 'r', 'bandup_public_reader'/);
  assert.match(url, /'social_links_select_for_profile_reader', 'r', 'bandup_profile_reader'/);
  assert.match(url, /CREATE OR REPLACE VIEW public\.public_social_links[\s\S]*?WHERE is_public IS TRUE AND private\.is_safe_external_url_v1\(url\) IS TRUE/);
  assert.match(url, /bandup_url_legacy_before/);
  assert.match(url, /bandup_url_legacy_after/);
  assert.match(url, /view_contract = after_view AND source_contract = after_source/);
  assert.match(url, /service_role, bandup_public_reader, bandup_profile_reader/);
});

test('prepared suite exercises application roles, all combinations, authorization and bulk atomicity', () => {
  for (const token of ['SET LOCAL ROLE anon', 'SET LOCAL ROLE authenticated',
    'SET LOCAL ROLE bandup_public_reader', 'SET LOCAL ROLE bandup_profile_reader',
    'compat_zero', 'ON CONFLICT', 'mixed bulk transfer is atomic',
    'private-band-private-link', 'unpublish removes legacy events',
    'legacy rows retained and unpublished', 'invalid legacy value not rewritten']) {
    assert.ok(suite.includes(token), token);
  }
  assert.match(suite, /ROLLBACK;\s*$/);
  assert.doesNotMatch(suite, /COMMIT;/);
  assert.ok(fixture.includes('COMMIT;'), 'upgrade fixture is separately committed');
  assert.ok(fixture.includes('NOT the missing 20261004120000 SQL'));
});

test('all future test writes are gated before fixtures; no existing lab allowlist changed', () => {
  const identity = read('supabase/tests/compatibility_lab_identity_check.sql');
  assert.match(target, /\\ir compatibility_lab_identity_check.sql/);
  assert.match(identity, /bandup_expected_database/);
  assert.match(identity, /bandup_expected_system_identifier/);
  assert.match(identity, /current_database\(\)='bandup_publication_compat_test'/);
  assert.match(identity, /inet_server_addr\(\)='127\.0\.0\.1'/);
  assert.match(identity, /inet_server_port\(\)=5434/);
  assert.match(identity, /inet_server_port\(\)<>5433/);
  assert.match(identity, /system_identifier::text[\s\S]*?='7701800113631615116'/);
  for (const sql of [fixture, suite]) {
    assert.ok(sql.indexOf('\\ir publication_compatibility_target.sql') < sql.indexOf('CREATE '));
  }
});

test('compatibility variants retain historical functional/profile cases and only change the reviewed harness contract', () => {
  const header = '-- COMPATIBILITY BRANCH; PREPARED, NOT EXECUTED. Original suite preserved.\n';
  for (const [original, variant] of [
    ['functional_integrity.sql', 'compatibility_functional_integrity.sql'],
    ['functional_integrity_legacy_fixture.sql', 'compatibility_functional_integrity_legacy_fixture.sql'],
    ['public_band_profiles.sql', 'compatibility_public_band_profiles.sql'],
  ]) {
    let expected = read('supabase/tests/' + original)
      .replace('\\ir sql_test_capabilities.sql', '\\ir publication_compatibility_target.sql');
    expected = original.startsWith('functional_')
      ? expected.replaceAll('bandup_functional_integrity_20261027b', 'bandup_publication_compat_test')
      : expected.replaceAll('bandup_public_reader', 'bandup_profile_reader');
    assert.equal(read('supabase/tests/' + variant), header + expected);
  }
});

test('existing application contract stays compatible and public fetch remains uncached', () => {
  const app = read('src/lib/supabase/public-server.ts');
  assert.match(app, /from\("public_band_profiles"\)/);
  assert.match(app, /select\("name,slug,description,logo_url,links"\)/);
  assert.match(app, /cache: "no-store"/);
  const docs = read('docs/publication-compatibility.md');
  assert.match(docs, /NÃO executar `supabase db push`/);
  assert.match(docs, /produção permanece bloqueada/);
});
