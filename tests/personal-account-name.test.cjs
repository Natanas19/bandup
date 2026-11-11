/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { test } = require('node:test');

function load(file, requireLocal, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, ...globals, require: requireLocal });
  return mod.exports;
}
const names = load('src/lib/display-name.ts', require);
const user = (id, name) => ({ id, user_metadata: { display_name: name } });
const result = account => ({ data: { user: account }, error: null });
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
function fixture(account = user('a', 'Ana Silva')) {
  let state = null, effect, callback, reader = async () => result(account), inCallback = false;
  let reads = 0, writes = 0, unsubscribed = 0, timerId = 0;
  const timers = new Map();
  const client = { auth: {
    getUser() { assert.equal(inCallback, false, 'Auth calls must not run inside Auth notifications'); reads++; return reader(); },
    onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { unsubscribed++; } } } }; },
  } };
  const Component = load('src/components/personal-account-name.tsx', name => {
    if (name === 'react') return { ...React, useEffect: fn => { effect = fn; }, useState: () => [state, value => { state = value; writes++; }] };
    if (name === '@/lib/display-name') return names;
    if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
    return require(name);
  }, { window: {
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
  } }).default;
  Component();
  return {
    render: () => Component(), start: () => effect(),
    reader(fn) { reader = fn; },
    emit(event, account) { inCallback = true; try { callback(event, account ? { user: account } : null); } finally { inCallback = false; } },
    async flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await settle(); },
    stats: () => ({ reads, writes, unsubscribed, timers: timers.size }),
  };
}

test('sidebar name starts with fallback and uses the normalized name of the verified account', async () => {
  const h = fixture(user('a', '  Ana   Silva  '));
  assert.equal(h.render().props.children, 'Meu Painel');
  const dispose = h.start(); await settle();
  assert.equal(h.render().props.children, 'Ana Silva');
  assert.match(h.render().props.className, /break-words/);
  assert.match(h.render().props.className, /overflow-wrap:anywhere/);
  dispose(); assert.equal(h.stats().unsubscribed, 1);
});
test('missing or invalid names, signed-out accounts and Auth errors keep the fallback', async () => {
  for (const account of [null, user('a'), user('a', ''), user('a', 'private@example.com'), user('a', {})]) {
    const h = fixture(account); const dispose = h.start(); await settle();
    assert.equal(h.render().props.children, 'Meu Painel'); dispose();
  }
  for (const reader of [async () => ({ data: { user: null }, error: { message: 'private detail' } }),
    async () => { throw Error('private detail'); }]) {
    const h = fixture(); h.reader(reader); const dispose = h.start(); await settle();
    assert.equal(h.render().props.children, 'Meu Painel'); dispose();
  }
});
test('account switching hides the old name immediately and waits for the expected verified user', async () => {
  const h = fixture(); const dispose = h.start(); await settle();
  let finish;
  h.reader(() => new Promise(resolve => { finish = resolve; }));
  h.emit('SIGNED_IN', user('b', 'Untrusted event name'));
  assert.equal(h.render().props.children, 'Meu Painel');
  await h.flush(); finish(result(user('b', 'Bruno'))); await settle();
  assert.equal(h.render().props.children, 'Bruno');
  h.reader(async () => result(user('b', 'Bruno')));
  h.emit('SIGNED_IN', user('c', 'Other'));
  await h.flush(); assert.equal(h.render().props.children, 'Meu Painel'); dispose();
});
test('metadata updates refresh the same account name outside the Auth callback', async () => {
  const h = fixture(); const dispose = h.start(); await settle();
  h.reader(async () => result(user('a', 'Novo Nome')));
  h.emit('USER_UPDATED', user('a', 'Untrusted event name'));
  assert.equal(h.render().props.children, 'Ana Silva');
  await h.flush(); assert.equal(h.render().props.children, 'Novo Nome'); dispose();
});
test('logout, newer sessions and unmount invalidate late name responses', async () => {
  for (const mode of ['logout', 'switch', 'unmount']) {
    const h = fixture(); let finish;
    h.reader(() => new Promise(resolve => { finish = resolve; }));
    const dispose = h.start();
    if (mode === 'logout') h.emit('SIGNED_OUT', null);
    if (mode === 'switch') { h.emit('SIGNED_IN', user('b', 'Bruno')); h.reader(async () => result(user('b', 'Bruno'))); }
    if (mode === 'unmount') dispose();
    const writes = h.stats().writes;
    finish(result(user('a', 'Old Name'))); await settle();
    assert.equal(h.render().props.children, 'Meu Painel');
    assert.equal(h.stats().writes, writes);
    if (mode === 'switch') { await h.flush(); assert.equal(h.render().props.children, 'Bruno'); }
    if (mode !== 'unmount') dispose();
    assert.equal(h.stats().timers, 0);
  }
});
test('only the sidebar card renders the account name; navigation and responsive boundaries stay intact', () => {
  const source = fs.readFileSync('src/components/personal-workspace.tsx', 'utf8');
  assert.equal((source.match(/<PersonalAccountName\s*\/>/g) ?? []).length, 1);
  assert.match(source, /<aside[\s\S]*<PersonalAccountName\s*\/>[\s\S]*<\/aside>/);
  assert.match(source, /hidden w-64[\s\S]*md:flex/);
  assert.match(source, /<PersonalNavigation sidebar\s*\/>/);
  assert.match(source, /<SpaceSwitcherHeader settingsHref="\/dashboard\/configuracoes"\s*\/>[\s\S]*<PersonalNavigation\s*\/>/);
  const header = fs.readFileSync('src/components/space-switcher.tsx', 'utf8');
  assert.match(header, /justify-between/);
  assert.match(header, /<SpaceSwitcher bandId=\{bandId\} bandName=\{bandName\}\s*\/>[\s\S]*<WorkspaceSettingsMenu href=\{settingsHref\} showBandFeatures=\{!!bandId\}\s*\/>/);
});
