/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/display-name.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: mod, exports: mod.exports });
const { normalizeDisplayName, loadMemberNames } = mod.exports;

test('display names normalize Unicode and spaces; untrusted metadata fails closed', () => {
  assert.equal(normalizeDisplayName('  Jose\u0301   Silva  '), 'José Silva');
  assert.equal(normalizeDisplayName('a'.repeat(80)), 'a'.repeat(80));
  for (const value of [null, undefined, {}, 12, '', '  ', 'a'.repeat(81),
    'private@example.com', '<script>', 'A\nB', 'A\u200bB', 'A\u202eB']) {
    assert.equal(normalizeDisplayName(value), null);
  }
});

test('unvalidated member backend makes no calls; denied/missing backend has no private fallback', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; throw Error('private detail'); } };
  assert.equal((await loadMemberNames(client, 'band')).size, 0);
  assert.equal(calls, 0);
  assert.equal((await loadMemberNames(client, 'band', true)).size, 0);
  assert.equal(calls, 1);
});

test('future band scoped response is validated again and never substitutes email fields', async () => {
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'bandup_member_display_names');
    assert.equal(args.p_band_id, 'band');
    return { data: [
      { user_id: 'a', display_name: ' Ana ' },
      { user_id: 'b', display_name: 'private@example.com' },
      { user_id: 'c', email: 'private@example.com' },
      { user_id: 'd', display_name: { name: 'bad' } },
    ], error: null };
  } };
  const names = await loadMemberNames(client, 'band', true);
  assert.equal(names.size, 1);
  assert.equal(names.get('a'), 'Ana');
});

test('legacy account can save only its own Auth metadata; invalid names never reach Auth', async () => {
  const React = require('react');
  const calls = [], states = [], refs = [], saved = [];
  let writeError = null;
  let cursor = 0, refCursor = 0;
  const component = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/display-name-settings.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: component, exports: component.exports, require(name) {
    if (name === 'react') return { ...React,
      useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial;
        return [states[i], value => { states[i] = value; }]; },
      useRef(initial) { const i = refCursor++; return refs[i] ??= { current: initial }; },
    };
    if (name === '@/lib/display-name') return mod.exports;
    if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => ({ auth: {
      updateUser: async args => { calls.push(args); return { error: writeError }; },
    } }) };
    return require(name);
  } });
  const render = () => { cursor = refCursor = 0; return component.exports.default({ onSaved: name => saved.push(name) }); };
  const submit = () => render().props.onSubmit({ preventDefault() {} });
  await submit(); assert.equal(calls.length, 0);
  states[0] = 'private@example.com'; await submit(); assert.equal(calls.length, 0);
  assert.deepEqual(saved, []);
  writeError = { message: 'private detail' };
  states[0] = 'Ana Silva'; await submit();
  assert.deepEqual(saved, []);
  assert.match(states[2], /Não foi possível salvar/);
  writeError = null; calls.length = 0;
  states[0] = ' Ana Silva '; await submit();
  assert.equal(JSON.stringify(calls), JSON.stringify([{ data: { display_name: 'Ana Silva' } }]));
  assert.equal(states[0], 'Ana Silva');
  assert.match(states[2], /Nome salvo/);
  assert.deepEqual(saved, ['Ana Silva']);
});
