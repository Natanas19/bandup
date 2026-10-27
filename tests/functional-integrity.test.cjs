/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const migrationName = '20261027010000_functional_integrity.sql';
const migration = read('supabase/migrations/' + migrationName);
const suite = read('supabase/tests/functional_integrity.sql');
const fixture = read('supabase/tests/functional_integrity_legacy_fixture.sql');
const cases = JSON.parse(read('supabase/tests/functional_integrity_cases.json'));
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = { exports: {} }; cache.set(file, loaded);
  vm.runInNewContext(ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module: loaded, exports: loaded.exports, URL,
    require(name) {
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient() { throw new Error('Offline tests must never access Supabase'); } };
      const base = name.startsWith('@/') ? 'src/' + name.slice(2) : path.join(path.dirname(file), name);
      return load(base + '.ts');
    },
  }, { filename: file });
  return loaded.exports;
}

test('required-text cases agree with actual application validation, including tabs/NBSP/Unicode', () => {
  const { requiredTextError } = load('src/lib/form-validation.ts');
  for (const entry of cases.text) assert.equal(requiredTextError(entry.value, 'field') === null, entry.nonblank, JSON.stringify(entry.value));
});
test('slug contract agrees with actual public path helper, including UTF-16 boundaries', () => {
  const { getPublicProfilePath } = load('src/lib/band-publication.ts');
  for (const entry of cases.slugs) assert.equal(getPublicProfilePath(entry.value) !== null, entry.valid, JSON.stringify(entry.value).slice(0, 90));
});
test('protected columns match the historical schema; all eleven timestamps are covered', () => {
  const historical = read('supabase/migrations/20261001000000_initial_bandup_schema.sql');
  let count = 0;
  for (const table of ['bands', 'band_members', 'social_links', 'tasks', 'events']) {
    const definition = historical.match(new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`))[1];
    const descriptor = migration.match(new RegExp(`CREATE TRIGGER ${table}_zz_guard_functional_integrity[\\s\\S]*?guard_functional_integrity_v1\\(([^;]+)\\);`))[1];
    for (const match of definition.matchAll(/^\s*(\w+) TIMESTAMPTZ\b/gm)) {
      count++;
      assert.ok(descriptor.includes(`'${table === 'events' && match[1] === 'start_at' ? 'start' : 'time'}:${match[1]}'`));
    }
  }
  assert.equal(count, 11);
  assert.match(migration, /'events','event_type','text',true/);
  assert.match(migration, /t\.tgfoid=pg_catalog\.to_regprocedure/);
  assert.match(migration, /'UTF8'/);
});
test('legacy skip precedes validation and optional NULLs retain original constraints', () => {
  const body = migration.split('AS $functional_guard$')[1].split('$functional_guard$;')[0];
  assert.ok(body.indexOf('IS NOT DISTINCT FROM') < body.indexOf('IF value IS NULL'));
  assert.ok(body.indexOf('IF value IS NULL') < body.indexOf('pg_catalog.btrim'));
  assert.match(body, /IF value IS NULL THEN CONTINUE; END IF/);
  assert.match(body, /timestamp_value<pg_catalog\.statement_timestamp\(\)/);
  assert.doesNotMatch(body, /\bnow\(|clock_timestamp|NEW\.\w+\s*:=|SECURITY DEFINER/i);
  assert.match(body, /pg_catalog\.isfinite\(timestamp_value\)/);
  assert.match(body, /pg_catalog\.ascii[\s\S]*?>65535/);
  assert.match(body, /slug_units>2048/);
});
test('migration is additive and preserves source/view/security contracts', () => {
  assert.match(migration, /BEGIN;/); assert.ok(migration.trimEnd().endsWith('COMMIT;'));
  assert.match(migration, /SECURITY INVOKER\nSET search_path = ''/);
  assert.match(migration, /WHERE contract=after_contract/);
  for (const token of ['attacl', 'polqual', 'polwithcheck', 'relowner', 'relacl', 'relrowsecurity', 'pg_get_viewdef', 'pg_get_functiondef', 'pg_get_constraintdef', 'object collision', 'lock_timeout']) assert.ok(migration.includes(token), token);
  assert.doesNotMatch(migration, /^\s*(?:ALTER|GRANT|CREATE POLICY|DROP|CREATE OR REPLACE|UPDATE public\.|INSERT INTO public\.|DELETE FROM public\.)/im);
  assert.equal((migration.match(/^CREATE FUNCTION /gm) ?? []).length, 1);
  assert.equal((migration.match(/^CREATE TRIGGER /gm) ?? []).length, 5);
  assert.match(migration, /REVOKE ALL ON FUNCTION private\.guard_functional_integrity_v1\(\)/);
});
test('prepared SQL tests cover actual DML/NULL/date/slug/legacy behavior without installing triggers', () => {
  for (const token of ['INSERT INTO public.bands', 'INSERT INTO public.tasks', 'INSERT INTO public.events', 'INSERT INTO public.social_links', 'due_date=NULL', 'SET end_at=NULL', "'23502'", "'22007'", "'events_start_at_not_past'", "'tasks_ownership_immutable'", "'social_links_external_url_safe'", 'chr(160)', 'chr(128512)', '1025', '1999-12-31T21:00:00-03', 'legacy task remains editable', 'SET LOCAL ROLE authenticated', 'SET LOCAL ROLE anon']) assert.ok(suite.includes(token), token);
  assert.ok(suite.trimEnd().endsWith('ROLLBACK;'));
  assert.doesNotMatch(suite, /CREATE TRIGGER|DISABLE TRIGGER|ALTER ROLE|GRANT |REVOKE |COMMIT;/);
  assert.match(fixture, /guard_functional_integrity_v1\(\)'\) IS NOT NULL/);
  assert.ok(fixture.trimEnd().endsWith('COMMIT;'));
  assert.match(fixture, /'infinity'/);
});
test('prepared SQL dollar quotes, shared include and tenth-migration ordering are consistent', () => {
  const names = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(file => file.endsWith('.sql')).sort();
  assert.equal(names[9], migrationName);
  for (const source of [migration, suite, fixture]) {
    const tags = source.match(/\$[a-z_][a-z_0-9]*\$/gi) ?? [];
    for (const tag of new Set(tags)) assert.equal(tags.filter(value => value === tag).length % 2, 0, tag);
  }
  for (const source of [suite, fixture]) assert.ok(source.includes('\\ir sql_test_capabilities.sql'));
});
test('documented decisions defer ambiguous HTML caps and distinguish prepared SQL from runtime evidence', () => {
  const doc = read('supabase/tests/functional_integrity.md');
  for (const token of ['NOT EXECUTED', 'UTF-16', 'NOT added', 'statement_timestamp()', 'ROLLBACK', 'COMMIT', 'two-session', 'U+200B']) assert.ok(doc.includes(token), token);
  const body = migration.split('AS $functional_guard$')[1].split('$functional_guard$;')[0];
  assert.doesNotMatch(body, /\b(?:100|200|300|500|2000)\b/);
});
