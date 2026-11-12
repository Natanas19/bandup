/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const sql = fs.readFileSync('supabase/migrations/20261112100000_band_logos.sql', 'utf8').replace(/--[^\n]*/g, '');
// Contract checks only: do not substitute for PostgreSQL/RLS/concurrency tests.
test('bucket is separate with bounded image types, without modifying avatar policies', () => {
  assert.match(sql, /'band-logos', 'band-logos', true, 2097152/);
  assert.match(sql, /image\/jpeg','image\/png','image\/webp/);
  assert.doesNotMatch(sql, /\b(?:DROP|ALTER)\s+POLICY|\bavatars\b/i);
});
test('direct INSERT/UPDATE requires private consumed transaction capability; no client flag bypass', () => {
  assert.match(sql, /AFTER INSERT OR UPDATE ON public\.bands/);
  assert.match(sql, /NEW\.logo_url IS NOT NULL/);
  assert.match(sql, /NEW\.logo_url IS NOT DISTINCT FROM OLD\.logo_url/);
  assert.match(sql, /DELETE FROM private\.band_logo_write_permits[\s\S]*transaction_id = pg_catalog\.txid_current\(\)[\s\S]*logo_url = NEW\.logo_url/);
  assert.match(sql, /REVOKE ALL ON private\.band_logo_write_permits FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /ALTER TABLE private\.band_logo_write_permits ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /set_config|DISABLE TRIGGER|CREATE OR REPLACE FUNCTION private\.prevent_last/i);
});
test('RPC takes no user or URL argument, serializes band then members then validates association', () => {
  const rpc = sql.slice(sql.indexOf('CREATE FUNCTION public.bandup_set_band_logo'), sql.indexOf('ALTER FUNCTION private.band_logo_band_id'));
  assert.match(rpc, /\(p_band_id uuid, p_object_path text\)/);
  assert.match(rpc, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  const band = rpc.indexOf('FROM public.bands WHERE id = p_band_id FOR UPDATE NOWAIT');
  const members = rpc.indexOf('FROM public.band_members WHERE band_id = p_band_id ORDER BY id FOR UPDATE NOWAIT');
  assert.ok(band > 0 && members > band);
  assert.match(rpc.slice(members), /IF NOT EXISTS \(SELECT 1 FROM public\.band_members\s+WHERE band_id = p_band_id AND user_id = actor AND role = 'admin'\)/);
  assert.match(rpc, /private\.band_logo_band_id\(p_object_path\) IS DISTINCT FROM p_band_id/);
  assert.match(rpc, /bucket_id = 'band-logos' AND name = p_object_path FOR SHARE NOWAIT/);
  assert.match(rpc, /NOT BETWEEN 1 AND 2097152/);
  assert.match(rpc, /INSERT INTO private\.band_logo_write_permits[\s\S]*UPDATE public\.bands SET logo_url = target_url/);
});
test('restrictive gates prevent unrelated permissive policies enabling updates/deletes', () => {
  for (const operation of ['UPDATE', 'DELETE']) assert.match(sql, new RegExp('AS RESTRICTIVE FOR ' + operation + " TO PUBLIC\\s+USING \\(bucket_id <> 'band-logos'\\)"));
  assert.match(sql, /AS RESTRICTIVE FOR INSERT TO PUBLIC/);
  assert.match(sql, /AS RESTRICTIVE FOR SELECT TO PUBLIC/);
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role;\s*GRANT EXECUTE/);
  assert.doesNotMatch(sql, /GRANT[^;]+TO (?:PUBLIC|anon|service_role)/i);
});
const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON storage\.objects\s+([\s\S]*?);/g)]
  .map(([, name, body]) => ({ name, body }));
test('every PUBLIC policy uses function-free expressions, independent of private EXECUTE ACLs', () => {
  const publicPolicies = policies.filter(p => /TO PUBLIC\b/.test(p.body));
  assert.equal(publicPolicies.length, 4);
  for (const policy of publicPolicies) {
    const expression = policy.body.slice(policy.body.indexOf('(')).replace(/\b(?:WITH CHECK|USING)\s*/g, '');
    assert.doesNotMatch(expression, /\b(?:private|auth)\.|\w+\s*\(/, policy.name);
    if (/FOR (?:INSERT|SELECT)\b/.test(policy.body)) assert.match(policy.body, /OR CURRENT_USER = 'authenticated'/);
  }
});
test('authenticated restrictive rules alone execute authorization; other buckets skip locking helper', () => {
  for (const [operation, helper] of [['INSERT', 'authorize_band_logo_insert'], ['SELECT', 'can_read_band_logo']]) {
    const rule = policies.find(p => new RegExp('AS RESTRICTIVE FOR ' + operation + ' TO authenticated').test(p.body));
    assert.ok(rule);
    assert.match(rule.body, new RegExp("CASE WHEN bucket_id = 'band-logos' THEN private\\." + helper + '\\(name\\) ELSE true END'));
    const permissive = policies.find(p => new RegExp('^FOR ' + operation + ' TO authenticated').test(p.body));
    assert.ok(permissive); assert.doesNotMatch(permissive.body, /private\./);
  }
  assert.equal(policies.filter(p => /private\.authorize_band_logo_insert\(name\)/.test(p.body)).length, 1);
});
test('only wrapper helpers and RPC get API EXECUTE; effective inherited privileges are checked', () => {
  const grant = sql.match(/GRANT EXECUTE ON FUNCTION ([\s\S]*?) TO authenticated;/)?.[1];
  assert.ok(grant);
  assert.match(grant, /private\.authorize_band_logo_insert\(text\)/);
  assert.match(grant, /private\.can_read_band_logo\(text\)/);
  assert.match(grant, /public\.bandup_set_band_logo\(uuid,text\)/);
  assert.doesNotMatch(grant, /band_logo_band_id|guard_band_logo_write/);
  assert.match(sql, /has_table_privilege\(api_role, 'private\.band_logo_write_permits'/);
  assert.match(sql, /has_any_column_privilege\(api_role, 'private\.band_logo_write_permits'/);
  assert.match(sql, /has_function_privilege\(api_role, signature, 'EXECUTE'\) IS DISTINCT FROM allowed/);
  assert.match(sql, /has_function_privilege\(api_role, signature, 'EXECUTE WITH GRANT OPTION'\)/);
  assert.match(sql, /has_schema_privilege\(api_role, 'private', 'CREATE'\)/);
  assert.match(sql, /pg_has_role\(api_role, 'postgres', 'MEMBER'\)/);
  assert.match(sql, /has_parameter_privilege\(api_role, 'session_replication_role', 'SET'\)/);
  assert.match(sql, /'public\.bands', 'TRIGGER,TRUNCATE'/);
});
test('every definer is owned by postgres with fixed search_path/row_security; read helper takes no locks', () => {
  const definitions = [...sql.matchAll(/CREATE FUNCTION ([\w.]+)\([^;]*?\) RETURNS [\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)];
  assert.equal(definitions.length, 5);
  for (const [definition, name] of definitions) {
    assert.match(definition, /SET search_path = pg_catalog, pg_temp/);
    assert.match(sql, new RegExp('ALTER FUNCTION ' + name.replaceAll('.', '\\.') + '\\([^;]*\\) OWNER TO postgres;'));
    if (name !== 'private.band_logo_band_id') assert.match(definition, /SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = off/);
    if (name === 'private.can_read_band_logo') {
      assert.match(definition, /LANGUAGE sql STABLE/); assert.doesNotMatch(definition, /FOR UPDATE|FOR SHARE/);
      assert.match(definition, /auth\.role\(\) = 'authenticated' AND auth\.uid\(\) IS NOT NULL/);
    }
  }
});
test('installation and authorization have bounded lock waits and fresh role checks after locks', () => {
  assert.match(sql, /BEGIN;\s*SET LOCAL lock_timeout = '3s';\s*SET LOCAL statement_timeout = '30s';/);
  assert.match(sql, /WHERE oid = 'storage\.objects'::regclass AND relrowsecurity/);
  assert.match(sql, /WHERE oid = 'public\.bands'::regclass AND relrowsecurity/);
  const insert = sql.slice(sql.indexOf('CREATE FUNCTION private.authorize_band_logo_insert'), sql.indexOf('CREATE FUNCTION private.can_read_band_logo'));
  assert.match(insert, /SET lock_timeout = '3s'/);
  const band = insert.indexOf('FROM public.bands WHERE id = target FOR UPDATE NOWAIT');
  const actor = insert.indexOf('FROM public.band_members WHERE band_id = target AND user_id = actor FOR UPDATE NOWAIT');
  assert.ok(band > 0 && actor > band);
  assert.match(insert.slice(actor), /IF NOT FOUND THEN RETURN false; END IF;\s+RETURN EXISTS/);
  assert.doesNotMatch(sql, /SKIP LOCKED|WHEN lock_not_available[^$]*RETURN (?:true|target_url)/i);
});
