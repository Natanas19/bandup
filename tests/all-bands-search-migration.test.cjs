/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261105190000_all_bands_search_review.sql'), 'utf8').replace(/\r\n/g, '\n');
const reference = fs.readFileSync(path.join(root, 'bandup_rpc_definicoes_instaladas.sql'), 'utf8').replace(/\r\n/g, '\n');
const refs = Object.fromEntries([...reference.matchAll(/CREATE OR REPLACE FUNCTION public[.](bandup_\w+)\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$/g)].map(m => [m[1], m[2]]));
const literal = tag => {
  const delimiter = '$' + tag + '$', pieces = migration.split(delimiter);
  assert.equal(pieces.length, 3, 'one complete literal: ' + tag);
  return pieces[1];
};
function patch(body, oldFragment, newFragment) {
  assert.equal(body.split(oldFragment).length, 2, 'replace exactly one reviewed fragment');
  return body.replace(oldFragment, newFragment);
}

test('migration embeds the actual complete installed bodies and rejects unexpected drift', () => {
  assert.deepEqual(Object.keys(refs).sort(), ['bandup_discover_bands', 'bandup_request_entry']);
  assert.equal(literal('reference_discover'), refs.bandup_discover_bands);
  assert.equal(literal('reference_request'), refs.bandup_request_entry);
  assert.match(migration, /normalized_body IS DISTINCT FROM expected_body/);
  assert.match(migration, /after_metadata IS DISTINCT FROM before_metadata/);
  assert.match(migration, /pg_get_functiondef\(target_oid\)/);
  assert.match(migration, /EXECUTE replacement_definition/);
  assert.doesNotMatch(migration, /CONSTANT text := NULL/);
});

test('request changes only directory eligibility; quotas, cooldown, identity and locks remain byte-identical', () => {
  const before = refs.bandup_request_entry;
  const after = patch(before, literal('old_gate'), literal('new_gate'));
  assert.equal(literal('new_gate'), '  IF NOT FOUND THEN');
  assert.doesNotMatch(after, /band_join_directory|accepting_requests/);
  assert.equal(after.replace(literal('new_gate'), literal('old_gate')), before);
  for (const fragment of [
    'actor UUID := auth.uid()', 'IF actor IS NULL',
    "pg_catalog.current_setting('transaction_isolation')<>'read committed'",
    'pg_catalog.pg_try_advisory_xact_lock(824711,pg_catalog.hashtext(actor::text))',
    'PERFORM 1 FROM public.bands WHERE id=p_band_id FOR UPDATE;',
    "status='pending')>=5", ">=10", "interval '24 hours'", "interval '10 minutes'",
    "ERRCODE='23505'", "ERRCODE='54000'", 'pg_catalog.clock_timestamp()',
    'INSERT INTO public.band_join_requests', 'RETURN request_id;',
  ]) assert.ok(after.includes(fragment), fragment);
  assert.ok(after.indexOf("An entry request is already pending") < after.indexOf("Entry request limit reached"));
});

test('single installed discovery contract searches all bands with the same UUID cursor and limit range', () => {
  const after = patch(refs.bandup_discover_bands, literal('old_query'), literal('new_query'));
  assert.match(after, /SELECT b.id,b.name,''::text FROM public.bands b/);
  assert.match(after, /WHERE p_after IS NULL OR b.id>p_after\s+ORDER BY b.id LIMIT p_limit/);
  assert.match(after, /p_limit NOT BETWEEN 1 AND 50/);
  assert.match(after, /IF auth.uid\(\) IS NULL/);
  assert.doesNotMatch(after, /band_join_directory|accepting_requests|description|band_members|tasks|events|auth.users/);
  assert.match(migration, /TABLE\(band_id uuid, display_name text, summary text\)/);
  assert.doesNotMatch(migration, /CREATE FUNCTION public[.]bandup_search_bands|^\s*(?:GRANT|REVOKE|DROP FUNCTION)\b/m);
});

test('review preserves owner, ACL, defaults and security settings without changing unrelated tables or RPCs', () => {
  assert.match(migration, /'prosrc'-'proargdefaults'/);
  assert.match(migration, /'defaults_sql',pg_catalog.pg_get_expr\(p.proargdefaults,0\)/);
  assert.match(migration, /p.prosecdef/);
  assert.match(migration, /'row_security=off'=ANY\(p.proconfig\)/);
  assert.match(migration, /p.proowner=\(SELECT oid FROM pg_catalog.pg_roles/);
  const executable = migration.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(executable, /^\s*(?:ALTER TABLE|CREATE POLICY|DROP TABLE|TRUNCATE|GRANT|REVOKE|DISABLE TRIGGER)\b/im);
  assert.doesNotMatch(executable, /CREATE(?: OR REPLACE)? FUNCTION public.bandup_(decide|cancel)_entry/);
});


test('both RPCs must have exactly the confirmed postgres/authenticated ACL before any replacement', () => {
  const begin = migration.indexOf('-- Confirm the exact ACL');
  const end = migration.indexOf('INTO source_body,before_metadata', begin);
  const acl = migration.slice(begin, end);
  assert.ok(begin > 0 && end > begin);
  assert.match(acl, /count\(\*\)[\s\S]*aclexplode\(p.proacl\)[\s\S]*<> 2/);
  assert.match(acl, /count\(DISTINCT a.grantee\)[\s\S]*<> 2/);
  assert.match(acl, /a.grantee NOT IN \(\(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres'\),[\s\S]*rolname='authenticated'/);
  assert.match(acl, /a.grantor<>\(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres'\)/);
  assert.match(acl, /a.privilege_type<>'EXECUTE' OR a.is_grantable/);
  assert.doesNotMatch(acl, /COALESCE\(p.proacl/);
  assert.ok(end < migration.indexOf('EXECUTE replacement_definition'));
});

test('effective execution is checked before and after replacement including inherited privileges', () => {
  const before = migration.slice(0, migration.indexOf('EXECUTE replacement_definition'));
  const after = migration.slice(migration.indexOf('EXECUTE replacement_definition'));
  for (const fragment of [before, after]) {
    assert.ok(fragment.includes("NOT pg_catalog.has_function_privilege('postgres',target_oid,'EXECUTE')"));
    assert.ok(fragment.includes("NOT pg_catalog.has_function_privilege('authenticated',target_oid,'EXECUTE')"));
    assert.ok(fragment.includes("pg_catalog.has_function_privilege('authenticated',target_oid,'EXECUTE WITH GRANT OPTION')"));
    assert.ok(fragment.includes("pg_catalog.has_function_privilege('anon',target_oid,'EXECUTE')"));
    assert.ok(fragment.includes("pg_catalog.has_function_privilege('service_role',target_oid,'EXECUTE')"));
  }
  assert.match(migration, /current_user <> 'postgres'/);
  assert.match(migration, /p.proowner=\(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user\)/);
});

test('installed discovery/request defaults are verified without changing signatures or dependencies', () => {
  assert.match(migration, /p.pronargdefaults=2 AND pg_catalog.pg_get_expr\(p.proargdefaults,0\)='NULL::uuid, 20'/);
  assert.match(migration, /p.pronargdefaults=0 AND p.proargdefaults IS NULL/);
  assert.doesNotMatch(migration, /DROP FUNCTION|ALTER FUNCTION|CREATE FUNCTION public[.]/);
  assert.match(migration, /definition:=pg_catalog.pg_get_functiondef\(target_oid\)/);
  assert.match(migration, /after_metadata IS DISTINCT FROM before_metadata/);
});
