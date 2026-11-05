/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const sql = fs.readFileSync('supabase/migrations/20261105120000_band_member_display_names.sql', 'utf8');
const code = sql.replace(/--[^\n]*/g, '');
const body = code.split('AS $function$')[1].split('$function$;')[0];

test('new RPC matches the existing frontend contract and exposes exactly the two allowed columns', () => {
  const client = fs.readFileSync('src/lib/display-name.ts', 'utf8');
  assert.match(client, /rpc\("bandup_member_display_names", \{ p_band_id: bandId \}\)/);
  assert.match(code, /CREATE FUNCTION public\.bandup_member_display_names\(p_band_id UUID\)/);
  assert.match(code, /RETURNS TABLE \(user_id UUID, display_name TEXT\)/);
  assert.doesNotMatch(code, /CREATE OR REPLACE/i);
  assert.doesNotMatch(body, /SELECT\s+\w+\.\*|SELECT\s+\*/i);
  assert.doesNotMatch(body, /\b(email|phone|encrypted_password|raw_app_meta_data)\b/i);
  assert.match(body, /raw_user_meta_data ->> 'display_name'/);
});
test('membership is enforced before producing rows and inside the result query', () => {
  assert.match(body, /caller_id UUID := auth\.uid\(\)/);
  assert.match(body, /auth\.role\(\) IS DISTINCT FROM 'authenticated'/);
  assert.match(body, /caller_id IS NULL[\s\S]*p_band_id IS NULL/);
  const check = /caller\.band_id = p_band_id AND caller\.user_id = caller_id/g;
  assert.equal((body.match(check) ?? []).length, 2);
  assert.ok(body.indexOf("ERRCODE = '42501'") < body.indexOf('RETURN QUERY'));
  assert.match(body, /WHERE member\.band_id = p_band_id/);
  assert.doesNotMatch(body, /private\.is_band_member/);
});
test('definer has no dynamic SQL or writes and a safe qualified search path', () => {
  assert.match(code, /STABLE\s+SECURITY DEFINER\s+SET search_path = ''\s+SET row_security = off/);
  assert.match(code, /SET row_security = off\s+SET standard_conforming_strings = on\s+AS \$function\$/);
  assert.doesNotMatch(body, /\b(EXECUTE|INSERT|UPDATE|DELETE|MERGE|TRUNCATE|GRANT|ALTER)\b/i);
  assert.match(body, /FROM public\.band_members AS member/);
  assert.match(body, /LEFT JOIN auth\.users AS account/);
});
test('new function privileges are restricted atomically without touching existing grants or policies', () => {
  assert.match(code.trim(), /^BEGIN;/); assert.match(code.trim(), /COMMIT;$/);
  assert.match(code, /SET LOCAL standard_conforming_strings = on;/);
  assert.match(code, /REVOKE ALL ON FUNCTION public\.bandup_member_display_names\(UUID\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(code, /GRANT EXECUTE ON FUNCTION public\.bandup_member_display_names\(UUID\) TO authenticated;/);
  assert.doesNotMatch(code, /(?:ALTER|CREATE|DROP)\s+(?:TABLE|POLICY|ROLE)|ALTER DEFAULT PRIVILEGES|GRANT\s+\w+\s+ON\s+(?:TABLE|SCHEMA)/i);
  assert.match(code, /has_function_privilege\('anon', function_oid, 'EXECUTE'\)/);
  assert.match(code, /has_function_privilege\('service_role', function_oid, 'EXECUTE'\)/);
  assert.match(code, /pg_catalog\.aclexplode/);
});

test('postflight retains the supported effective grant-option check and the separate direct ACL audit', () => {
  const postflight = code.split('DO $postflight$')[1];
  assert.match(postflight, /has_function_privilege\('authenticated', function_oid, 'EXECUTE WITH GRANT OPTION'\)/);
  assert.match(postflight, /COALESCE\(p\.proacl, pg_catalog\.acldefault\('f', p\.proowner\)\)/);
  assert.match(postflight, /acl\.grantee NOT IN/);
  assert.match(postflight, /acl\.grantee <> p\.proowner AND acl\.is_grantable/);
  assert.ok(postflight.indexOf('Unexpected effective RPC execution privileges') < postflight.indexOf('pg_catalog.aclexplode'));
});
test('missing, non-string, empty, oversized and unsafe names have a non-private fallback', () => {
  assert.match(body, /jsonb_typeof\(account\.raw_user_meta_data -> 'display_name'\) = 'string'/);
  assert.match(body, /char_length\(raw\.name\) BETWEEN 1 AND 80/);
  assert.match(body, /raw\.name !~ U&'/);
  assert.ok(body.includes('\\0001-\\001F\\007F-\\009F'));
  assert.ok(body.includes('\\202A-\\202E\\2066-\\2069'));
  assert.match(body, /raw\.name !~ '\[<>@\]'/);
  assert.doesNotMatch(body, /\[:alpha:\]|\[:digit:\]|regexp_replace/);
  assert.match(body, /char_length\(clean\.name\) BETWEEN 1 AND 80/);
  assert.match(body, /ELSE 'Integrante'::TEXT/);
});

test('Unicode handling retains emoji joiners and combining marks instead of using a locale alphabet', () => {
  const rejection = body.match(/AND raw\.name !~ U&'([^']+)'/)[1];
  assert.equal(rejection.includes('\\200D'), false);
  assert.equal(rejection.includes('\\0300'), false);
  assert.match(body, /pg_catalog\.btrim\(pg_catalog\.left\(raw\.name, 81\),\s+U&'/);
  assert.ok(body.includes('\\00A0'));
  assert.ok(body.includes('\\+0E0100-\\+0E01EF'));
});

// Audits the literal code-point ranges, not PostgreSQL regex/SQL execution.
function decodeUnicodeEscapes(value) {
  return value.replace(/\\\+([0-9A-F]{6})|\\([0-9A-F]{4})/g,
    (_, long, short) => String.fromCodePoint(parseInt(long ?? short, 16)));
}
test('static Unicode range audit preserves international names and emoji and identifies prohibited controls', () => {
  const unsafe = new RegExp(decodeUnicodeEscapes(body.match(/AND raw\.name !~ U&'([^']+)'/)[1]), 'u');
  const invisible = new RegExp(decodeUnicodeEscapes(body.match(/AND clean\.name !~ U&'([^']+)'/)[1]), 'u');
  for (const name of ['José', 'Jose\u0301', '山田 太郎', 'Ana 🎸', '👩‍🎤', '🇧🇷', '👍🏽', 'Ana  Silva', 'O’Connor', 'A&B']) {
    assert.equal(unsafe.test(name), false, name);
    assert.equal(invisible.test(name), false, name);
  }
  for (const name of ['A\nB', 'A\tB', 'A\u007fB', 'A\u0085B', 'A\u061cB', 'A\u200eB', 'A\u202eB', 'A\u2066B']) {
    assert.equal(unsafe.test(name), true);
  }
  for (const name of ['', '\u200d', '\u200d \u200c', '\u00a0\u200d\u3000', '\ufe0f', '\u{e0100}']) {
    assert.equal(invisible.test(name), true);
  }
  assert.match(body, /char_length\(raw\.name\) BETWEEN 1 AND 80/);
  assert.match(body, /THEN clean\.name\s+ELSE 'Integrante'/);
});
test('preflight fails on collisions or inadequate ownership/schema instead of repairing the database', () => {
  assert.match(code, /current_user <> 'postgres'/);
  assert.match(code, /r\.rolsuper OR r\.rolbypassrls/);
  assert.match(code, /n\.nspname IN \('public', 'private'\)/);
  assert.match(code, /p\.proname = 'bandup_member_display_names'/);
  assert.match(code, /has_column_privilege/);
  assert.match(code, /a\.atttypid = pg_catalog\.to_regtype/);
  assert.match(code, /c\.relrowsecurity/);
  assert.doesNotMatch(code, /tasks\.event_id/);
});
