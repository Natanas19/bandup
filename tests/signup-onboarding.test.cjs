/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');

function harness(file, result, initial = {}) {
  const states = { ...initial }, refs = [], calls = [], effects = [];
  let cursor = 0, refCursor = 0;
  const client = { auth: { signUp: async args => {
    calls.push(args);
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result() : result;
  } } };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, window: { location: { origin: 'http://localhost:3000' } },
    require(name) {
      if (name === 'react') return { ...React,
        useState(value) { const i = cursor++; if (!(i in states)) states[i] = value;
          return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef(value) { const i = refCursor++; return refs[i] ??= { current: value }; },
        useEffect(fn) { effects.push(fn); },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ replace: url => calls.push(url) }) };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null };
      return require(name);
    },
  });
  return { states, calls, render() { cursor = refCursor = 0; return mod.exports.default(); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const signup = (result, initial = {}) => harness('src/app/cadastro/page.tsx', result,
  { 0: ' person@example.com ', 1: 'password123', 2: 'password123', ...initial });
const submit = h => nodes(h.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });

test('signup with session navigates only to dashboard and trims email', async () => {
  const h = signup({ data: { session: { user: { id: 'new' } } }, error: null });
  await submit(h);
  assert.equal(h.calls[0].email, 'person@example.com');
  assert.equal(h.calls[0].options.emailRedirectTo, 'http://localhost:3000/login');
  assert.deepEqual(h.calls.slice(1), ['/dashboard']);
  assert.equal(h.states[1], '');
});
test('confirmation and duplicate accounts display the same neutral response without redirect', async () => {
  for (const result of [
    { data: { session: null }, error: null },
    { data: null, error: { code: 'user_already_exists', message: 'Account exists: person@example.com' } },
    { data: null, error: { code: 'email_exists' } },
  ]) {
    const h = signup(result); await submit(h);
    assert.equal(h.states[5], true);
    assert.equal(h.states[3], '');
    assert.equal(h.calls.length, 1);
    const tree = nodes(h.render());
    assert.equal(tree.some(n => n.type === 'form'), false);
    assert.ok(tree.some(n => n.props?.role === 'status'));
    assert.ok(tree.some(n => n.props?.href === '/login'));
  }
});
test('invalid inputs do not call Supabase', async () => {
  for (const initial of [{ 0: 'invalid' }, { 1: 'short', 2: 'short' }, { 2: 'different' }]) {
    const h = signup(null, initial); await submit(h);
    assert.equal(h.calls.length, 0); assert.ok(h.states[3]);
  }
});
test('service failures never expose raw errors and allow retry', async () => {
  for (const result of [new Error('secret'), { data: null, error: { code: 'unexpected', message: 'secret' } }]) {
    const h = signup(result); await submit(h);
    assert.ok(h.states[3]); assert.equal(h.states[3].includes('secret'), false);
    assert.equal(h.states[4], false); assert.equal(h.states[5], false);
  }
});
test('double submit sends a single request and displays loading', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = signup(() => pending);
  const first = submit(h); await submit(h);
  assert.equal(h.calls.length, 1);
  assert.ok(nodes(h.render()).some(n => n.type === 'button' && n.props.disabled));
  finish({ data: { session: null }, error: null }); await first;
});
test('musician choice stays on dashboard and keeps band creation available', () => {
  // Dashboard state: authenticated user, musician choice, no bands, loaded.
  const h = harness('src/app/dashboard/page.tsx', null, { 0: { id: 'u' }, 1: [], 2: false });
  const button = nodes(h.render()).find(n => n.type === 'button' && n.props['aria-pressed'] === false);
  assert.ok(button); button.props.onClick();
  const tree = nodes(h.render());
  assert.ok(tree.some(n => n.props?.role === 'status'));
  assert.ok(tree.some(n => n.props?.href === '/bandas/nova'));
  assert.equal(h.calls.length, 0);
});
test('existing memberships preserve band navigation without onboarding choices', () => {
  const h = harness('src/app/dashboard/page.tsx', null, {
    0: { id: 'u' }, 1: [{ role: 'admin', band: { id: 'b', name: 'Band' } }], 2: false,
  });
  const tree = nodes(h.render());
  assert.ok(tree.some(n => n.props?.href === '/bandas/b'));
  assert.equal(tree.some(n => n.props?.['aria-pressed'] !== undefined), false);
});
