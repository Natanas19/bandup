/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20261114180000_musician_availability.sql', 'utf8');
const executable = sql.replace(/--[^\n]*/g, '');
const normalized = executable.replace(/\s+/g, ' ').trim();

test('candidate is atomic, bounded and refuses to reuse an existing availability object', () => {
  assert.match(sql, /LOCAL REVIEW CANDIDATE ONLY/);
  assert.match(normalized, /^BEGIN;/);
  assert.match(normalized, /COMMIT;$/);
  assert.match(normalized, /SET LOCAL lock_timeout = '3s'/);
  assert.match(normalized, /SET LOCAL statement_timeout = '30s'/);
  assert.match(normalized, /to_regclass\('public.musician_availability'\) IS NOT NULL/);
  assert.match(normalized, /to_regtype\('public.musician_availability'\) IS NOT NULL/);
  assert.doesNotMatch(executable, /CREATE TABLE IF NOT EXISTS|EXCEPTION WHEN OTHERS/i);
});

test('table stores only identity and explicit default-off consent, cascading account deletion', () => {
  const definition = normalized.match(/CREATE TABLE public\.musician_availability \((.*?)\);/)[1];
  assert.equal(definition, ' user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, available boolean NOT NULL DEFAULT false ');
  assert.match(normalized, /a\.atttypid = 'pg_catalog.uuid'::regtype AND a\.attnotnull/);
  assert.match(normalized, /k\.contype = 'p' AND k\.conkey = ARRAY\[a\.attnum\]/);
  assert.match(normalized, /NOT k\.condeferrable AND i\.indisvalid AND i\.indisunique/);
  assert.doesNotMatch(executable, /INSERT INTO|UPDATE public\.|DELETE FROM|CREATE TRIGGER/i);
});

test('all three policies are authenticated-only and match the current owner in every row predicate', () => {
  assert.match(normalized, /ALTER TABLE public\.musician_availability ENABLE ROW LEVEL SECURITY/);
  const policies = [...normalized.matchAll(/CREATE POLICY (\w+) ON public\.musician_availability FOR (SELECT|INSERT|UPDATE) TO authenticated (.*?);/g)];
  assert.equal(policies.length, 3);
  assert.equal((normalized.match(/CREATE POLICY/g) ?? []).length, 3);
  const byCommand = Object.fromEntries(policies.map(p => [p[2], p[3]]));
  assert.equal(byCommand.SELECT, 'USING (user_id = (SELECT auth.uid()))');
  assert.equal(byCommand.INSERT, 'WITH CHECK (user_id = (SELECT auth.uid()))');
  assert.equal(byCommand.UPDATE, 'USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()))');
});

test('column grants permit own inserts and available updates without identity changes or public access', () => {
  const grants = normalized.match(/\bGRANT .*?;/g);
  assert.deepEqual(grants, [
    'GRANT SELECT (user_id, available), INSERT (user_id, available) ON TABLE public.musician_availability TO authenticated;',
    'GRANT UPDATE (available) ON TABLE public.musician_availability TO authenticated;',
  ]);
  const revoke = 'REVOKE ALL ON TABLE public.musician_availability FROM PUBLIC, anon, authenticated, service_role;';
  assert.ok(normalized.indexOf(revoke) < normalized.indexOf(grants[0]));
  assert.match(normalized, /ALTER TABLE public\.musician_availability OWNER TO postgres/);
  assert.doesNotMatch(normalized, /GRANT .*? ON (?:TABLE )?auth\./);
});

test('guards reject bypass and unexpected inherited/default privileges without repairing other objects', () => {
  for (const check of [
    /rolname IN \('anon', 'authenticated'\) AND \(rolsuper OR rolbypassrls\)/,
    /pg_has_role\(api_role, 'postgres', 'MEMBER'\)/,
    /has_table_privilege\(api_role, relation, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'\)/,
    /has_any_column_privilege\( api_role, relation, 'SELECT,INSERT,UPDATE,REFERENCES'\)/,
    /has_column_privilege\('authenticated', relation, 'user_id', 'UPDATE'\)/,
    /aclexplode\(c\.relacl\)/,
    /aclexplode\(col\.attacl\)/,
    /a\.is_grantable/,
  ]) assert.match(normalized, check);
  const mutationTargets = [...normalized.matchAll(/(?:ALTER TABLE|REVOKE ALL ON TABLE|ON TABLE) ([\w.]+)/g)].map(m => m[1]);
  assert.ok(mutationTargets.length > 0);
  assert.ok(mutationTargets.every(name => name === 'public.musician_availability'));
  assert.doesNotMatch(executable, /ALTER DEFAULT PRIVILEGES|ALTER ROLE|ALTER SCHEMA|CREATE FUNCTION|CREATE OR REPLACE|band_members|supabase_migrations/i);
});

test('preflight verifies effective executor REFERENCES and scalar UUID identity before creating the table', () => {
  const preflight = normalized.split('CREATE TABLE public.musician_availability')[0];
  assert.match(preflight, /has_column_privilege\(current_user, 'auth.users', 'id', 'REFERENCES'\)/);
  assert.match(preflight, /IF NOT pg_catalog.has_column_privilege[\s\S]*RAISE EXCEPTION 'Executor lacks REFERENCES/);
  assert.match(preflight, /p\.oid = pg_catalog.to_regprocedure\('auth.uid\(\)'\)/);
  assert.match(preflight, /p\.prokind = 'f' AND NOT p\.proretset AND p\.prorettype = 'pg_catalog.uuid'::regtype/);
  assert.match(preflight, /RAISE EXCEPTION 'Expected scalar UUID Auth identity helper'/);
});

test('postflight validates exact policy identities, commands, roles and both nullable predicates', () => {
  const postflight = normalized.split('DO $postflight$')[1];
  const expected = [...postflight.matchAll(/\('(musician_availability_\w+)', '([raw])', (true|false), (true|false)\)/g)]
    .map(match => match.slice(1));
  assert.deepEqual(expected, [
    ['musician_availability_select_own', 'r', 'true', 'false'],
    ['musician_availability_insert_own', 'a', 'false', 'true'],
    ['musician_availability_update_own', 'w', 'true', 'true'],
  ]);
  assert.match(postflight, /owner_predicate CONSTANT text := '\(user_id=\(SELECTauth.uid\(\)ASuid\)\)'/);
  assert.match(postflight, /LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = relation AND p.polname = expected.policy_name/);
  assert.match(postflight, /WHERE p.oid IS NULL/);
  assert.match(postflight, /p.polcmd::text IS DISTINCT FROM expected.command/);
  assert.match(postflight, /p.polroles IS DISTINCT FROM ARRAY\['authenticated'::regrole::oid\]/);
  assert.match(postflight, /p.polpermissive IS DISTINCT FROM true/);
  for (const [column, required] of [['polqual', 'needs_using'], ['polwithcheck', 'needs_check']]) {
    assert.ok(postflight.includes(`pg_catalog.pg_get_expr(p.${column}, p.polrelid, false), '[[:space:]]', '', 'g' ) IS DISTINCT FROM CASE WHEN expected.${required} THEN owner_predicate ELSE NULL::text END`));
  }
  assert.match(postflight, /RAISE EXCEPTION 'Unexpected availability policy contract'/);
});

test('no UI, search RPC, Auth data copy or migration-ledger writes are introduced', () => {
  assert.doesNotMatch(executable, /raw_user_meta_data|email|avatar|display_name|CREATE VIEW|CREATE FUNCTION|INSERT INTO|UPDATE auth|DELETE FROM auth/i);
  assert.match(normalized, /count\(\*\) FROM pg_catalog.pg_policy WHERE polrelid = relation\) <> 3/);
  assert.match(normalized, /oid = relation AND relrowsecurity AND relowner = 'postgres'::regrole/);
});
