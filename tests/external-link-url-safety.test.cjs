/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20261027000000_external_link_url_safety.sql');
const cases = JSON.parse(read('supabase/tests/external_link_url_cases.json'));
const suite = read('supabase/tests/external_link_url_safety.sql');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('src/lib/social-links.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports: mod.exports, module: mod, URL });
test('shared corpus documents actual JavaScript acceptance without executing SQL', () => {
  for (const entry of cases) {
    assert.equal(mod.exports.getSafeExternalUrl(entry.input) !== null, entry.javascript, JSON.stringify(entry.input));
    if (entry.sql !== entry.javascript) assert.ok(entry.note, 'Parser differences need explanation');
  }
});
test('prepared SQL corpus covers each case without embedding control bytes', () => {
  cases.forEach((entry, index) => {
    const value = entry.input === null ? 'NULL' : `pg_catalog.convert_from(pg_catalog.decode('${Buffer.from(entry.input).toString('hex')}', 'hex'), 'UTF8')`;
    assert.ok(suite.includes(`(${index}, ${value}, ${entry.sql})`));
  });
  assert.ok(suite.includes('ROLLBACK;'));
  assert.ok(!suite.includes('COMMIT;'));
});
test('view changes only the safe URL predicate and retains projection/order', () => {
  const historical = read('supabase/migrations/20261020000000_public_band_profiles.sql');
  const oldQuery = historical.match(/CREATE VIEW public\.public_band_profiles[\s\S]*?AS\s*(SELECT[\s\S]*?WHERE band\.is_public IS TRUE;)/)[1];
  const newQuery = migration.match(/CREATE OR REPLACE VIEW public\.public_band_profiles[\s\S]*?AS\s*(SELECT[\s\S]*?WHERE band\.is_public IS TRUE;)/)[1];
  assert.equal(newQuery.replace(/\s+AND private\.is_safe_external_url_v1\(link\.url\) IS TRUE/, ''), oldQuery);
  assert.match(migration, /view_contract = after_view AND source_contract = after_source/);
  assert.match(migration, /pg_get_viewdef\('pg_temp\.bandup_url_expected_view'/);
});
test('validator is pure, invoker, immutable and bounded; guard allows legacy hiding', () => {
  const validator = migration.split('AS $url_validator$')[1].split('$url_validator$;')[0];
  assert.doesNotMatch(validator, /\b(SELECT|INSERT|UPDATE|DELETE|EXECUTE)\b/i);
  assert.match(migration, /IMMUTABLE[\s\S]*?SECURITY INVOKER[\s\S]*?SET search_path = ''/);
  assert.match(validator, /octet_length\(input_value\) > 8192/);
  assert.match(validator, /\[\[:cntrl:\]\]/);
  assert.match(migration, /NEW\.url IS DISTINCT FROM OLD\.url OR NEW\.is_public IS TRUE/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.social_links/);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|ALTER POLICY|ALTER ROLE|DROP POLICY|DROP VIEW public\.|UPDATE public\.|DELETE FROM public\.|INSERT INTO public\./i);
});
test('prepared migration is ninth and guards existing permissions and structure', () => {
  const names = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
  assert.equal(names.filter(name => name <= '20261027000000_external_link_url_safety.sql').length, 9);
  assert.equal(names[8], '20261027000000_external_link_url_safety.sql');
  for (const evidence of ['relrowsecurity', 'polpermissive', 'relowner', 'relacl', 'attacl', 'social_links_guard_publication', 'lock_timeout', 'object collision']) assert.ok(migration.includes(evidence));
  assert.doesNotMatch(migration, /GRANT\s+(SELECT|USAGE|ALL)\b/i);
  assert.match(suite, /SET LOCAL ROLE anon/);
});
