/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sql = fs.readFileSync('supabase/migrations/20261115120000_musician_discovery.sql', 'utf8');
const code = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

test('atomic additive RPC with no source mutation or source grants', () => {
  assert.match(code, /^BEGIN;/); assert.match(code, /COMMIT;$/);
  assert.doesNotMatch(code, /CREATE OR REPLACE|ALTER TABLE|CREATE POLICY|INSERT INTO|UPDATE |DELETE FROM|GRANT SELECT|CREATE TRIGGER/i);
  assert.match(code, /Discovery name collision/);
});
test('authenticated identity checked inside a definer with fixed search path', () => {
  assert.match(code, /STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = off/);
  assert.match(code, /auth.role\(\) IS DISTINCT FROM 'authenticated' OR actor IS NULL/);
  assert.match(code, /auth.users u WHERE u.id = actor/);
  assert.match(code, /FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(code, /GRANT EXECUTE .* TO authenticated;/);
  assert.match(code, /has_function_privilege\('service_role', target, 'EXECUTE'\)/);
});
test('public projection has no Auth identity, email, metadata or avatar URL', () => {
  assert.match(code, /RETURNS TABLE\(display_name text, photo_ref text, available boolean\)/);
  assert.match(code, /SELECT names.name, NULL::text, COALESCE\(a.available, false\)/);
  assert.doesNotMatch(code, /avatar_url|email|RETURNS TABLE\([^)]*uuid/i);
  assert.match(code, /raw.name !~ '\[<>@\]'/);
  assert.match(code, /ELSE 'Músico'::text/);
});
test('universal base, literal server search and deterministic bounded pages', () => {
  assert.match(code, /FROM auth.users u CROSS JOIN LATERAL/);
  assert.match(code, /LEFT JOIN public.musician_availability a ON a.user_id = u.id/);
  assert.doesNotMatch(code, /band_members|WHERE a.available|ILIKE|LIKE /);
  assert.match(code, /pg_catalog.strpos\(pg_catalog.lower\(names.name\)/);
  assert.match(code, /p_offset IS NULL OR p_offset < 0/);
  assert.match(code, /p_limit NOT BETWEEN 1 AND 50/);
  assert.match(code, /char_length\(p_query\) > 100/);
  assert.match(code, /ORDER BY u.id LIMIT p_limit OFFSET p_offset/);
});
