/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const sql = fs.readFileSync('supabase/migrations/20261112140000_pending_request_avatars.sql','utf8');
const executable = sql.replace(/--[^\n]*/g,'');
test('candidate creates one additive read-only RPC and only its own ACL', () => {
  assert.equal((executable.match(/CREATE FUNCTION /g) ?? []).length,1);
  assert.match(executable,/CREATE FUNCTION public.bandup_pending_request_avatars\(p_band_id uuid, p_request_ids uuid\[\]\)/);
  assert.match(executable,/RETURNS TABLE\(request_id uuid, avatar_url text\)/);
  assert.match(executable,/STABLE SECURITY DEFINER/);
  assert.match(executable,/SET search_path = pg_catalog, pg_temp SET row_security = off/);
  assert.doesNotMatch(executable,/CREATE OR REPLACE|DROP |ALTER TABLE|CREATE POLICY|ALTER POLICY|INSERT INTO|DELETE FROM|UPDATE public|UPDATE auth/);
  for (const line of executable.split('\n').filter(line => /^(?:GRANT|REVOKE|ALTER FUNCTION)/.test(line))) {
    assert.ok(line.includes('public.bandup_pending_request_avatars(uuid,uuid[])'));
  }
});
test('authorization precedes batch validation and result scope cannot enumerate users', () => {
  const body = sql.split('AS $function$')[1].split('END $function$')[0];
  assert.ok(body.indexOf("MESSAGE = 'Request avatars unavailable'") < body.indexOf('IF p_request_ids IS NULL'));
  assert.match(body,/auth.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(body,/cardinality\(p_request_ids\) > 20/);
  assert.match(body,/array_ndims\(p_request_ids\) <> 1/);
  assert.match(body,/q.band_id = p_band_id AND q.status = 'pending' AND q.id = ANY\(p_request_ids\)/);
  assert.match(body,/m.user_id = actor AND m.role = 'admin'/);
  assert.doesNotMatch(body,/u\.email|u\.raw_app_meta_data|applicant_name|bio|picture/);
  assert.match(body,/avatars\/' \|\| q.requester_id::text/);
});
test('schema drift, collisions, default grants and inherited access fail closed', () => {
  for (const fragment of ['RPC name collision','Missing/incompatible source column',
    'Request IDs must be uniquely indexed','Expected existing source RLS enabled',
    'Expected existing public avatars bucket','aclexplode','EXECUTE WITH GRANT OPTION',
    "has_function_privilege('anon'", "has_function_privilege('service_role'"]) assert.ok(sql.includes(fragment),fragment);
});
