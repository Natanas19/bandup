/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const sql = fs.readFileSync('supabase/migrations/20261112120000_band_discovery_logos_v2.sql', 'utf8');
function load(file) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, URL,
    process: { env: { NODE_ENV: 'production' } }, require(name) {
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      if (name.startsWith('@/lib/')) return load(path.resolve(__dirname, '../src', name.slice(2) + '.ts'));
      return require(name);
    } });
  return mod.exports;
}
test('candidate creates only v2, preserves old RPC and never changes policies, Storage or data', () => {
  const executable = sql.replace(/--[^\n]*/g, '');
  assert.equal((executable.match(/CREATE FUNCTION /g) ?? []).length, 1);
  assert.match(executable, /CREATE FUNCTION public.bandup_discover_bands_v2\(/);
  assert.doesNotMatch(executable, /CREATE OR REPLACE|DROP FUNCTION|ALTER TABLE|CREATE POLICY|ALTER POLICY|storage\.|\b(?:INSERT INTO|UPDATE public|DELETE FROM)\b/i);
  assert.match(executable, /RETURNS TABLE\(band_id uuid, display_name text, summary text, logo_url text\)/);
  assert.match(executable, /SELECT b.id, b.name, ''::text/);
  assert.doesNotMatch(executable, /b\.description|is_public|band_members|accepting_requests/);
  assert.match(executable, /FOREACH api_role/);
  assert.match(executable, /aclexplode/);
  assert.match(executable, /EXECUTE WITH GRANT OPTION/);
});
test('shared frontend validator accepts expected public images and rejects unsafe render sources', () => {
  const { safeBandLogo } = load('src/lib/public-band-data.ts');
  const origin = 'https://zwmihhdvvpqgyavworgh.supabase.co';
  const url = origin + '/storage/v1/object/public/band-logos/00000000-0000-0000-0000-000000000001/11111111-1111-4111-8111-111111111111.png';
  assert.equal(safeBandLogo(url, origin), url);
  for (const value of [null, '', 'not a URL', url.replace(origin, 'https://evil.example'),
    url.replace('https://', 'http://'), url.replace('https://', 'https://user:pass@'),
    url + '?token=secret', url + '#fragment', url.replace('.png', '.svg')]) {
    assert.equal(safeBandLogo(value, origin), null);
  }
  // Bucket/band binding belongs to SQL; safeBandLogo is the existing general renderer guard.
});
