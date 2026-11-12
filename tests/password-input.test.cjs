/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');

const PasswordMarker = () => null;
function fixture(file, initial = {}, result = { data: { session: {} }, error: null }) {
  const states = { ...initial }, calls = [];
  let cursor = 0;
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === 'react') return { ...React,
        useState(value) { const i = cursor++; if (!(i in states)) states[i] = value;
          return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef: value => ({ current: value }), useEffect() {},
      };
      if (name === '@/components/password-input') return { __esModule: true, default: PasswordMarker };
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null };
      if (name === 'next/navigation') return { useRouter: () => ({ replace: url => calls.push(url) }) };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => ({ auth: {
        signInWithPassword: async args => { calls.push(args); return result; },
      } }) };
      if (name === '@/lib/display-name') return { normalizeDisplayName: value => value || null };
      if (name === '@/lib/avatar-upload') {
        const avatar = { exports: {} };
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/avatar-upload.ts'), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText, { module: avatar, exports: avatar.exports });
        return avatar.exports;
      }
      if (name === '@/lib/email-confirmation') return {};
      if (name === '@/lib/avatar-draft') return {};
      return require(name);
    },
  });
  return { calls, render(props) { cursor = 0; return mod.exports.default(props); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test('visibility toggles both ways without changing the password or submitting the form', () => {
  const h = fixture('src/components/password-input.tsx');
  let edits = 0;
  const props = { id: 'confirmation', name: 'confirmation', value: 'secret-value',
    visibilityLabel: 'confirmação de senha', autoComplete: 'new-password', minLength: 8,
    required: true, className: 'text-base', onChange: () => edits++ };
  for (const visible of [false, true, false]) {
    const tree = nodes(h.render(props));
    const input = tree.find(n => n.type === 'input');
    const button = tree.find(n => n.type === 'button');
    assert.equal(input.props.type, visible ? 'text' : 'password');
    assert.equal(input.props.value, props.value);
    assert.equal(input.props.autoComplete, 'new-password');
    assert.equal(input.props.minLength, 8);
    assert.equal(input.props.required, true);
    assert.match(input.props.className, /pr-14/);
    assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-controls'], input.props.id);
    assert.equal(button.props['aria-pressed'], visible);
    assert.equal(button.props['aria-label'], `${visible ? 'Ocultar' : 'Mostrar'} confirmação de senha`);
    button.props.onClick();
  }
  assert.equal(edits, 0);
});

test('password fields have independent visibility and respect disabled state', () => {
  const a = fixture('src/components/password-input.tsx');
  const b = fixture('src/components/password-input.tsx');
  nodes(a.render({ id: 'password' })).find(n => n.type === 'button').props.onClick();
  assert.equal(nodes(a.render({ id: 'password' })).find(n => n.type === 'input').props.type, 'text');
  const tree = nodes(b.render({ id: 'confirmation', disabled: true }));
  assert.equal(tree.find(n => n.type === 'input').props.type, 'password');
  assert.equal(tree.find(n => n.type === 'input').props.disabled, true);
  assert.equal(tree.find(n => n.type === 'button').props.disabled, true);
});

test('login, signup and confirmation use the shared input with password manager hints', () => {
  const login = nodes(fixture('src/app/login/page.tsx', { 4: false }).render());
  assert.deepEqual(login.filter(n => n.type === PasswordMarker).map(n => [n.props.id, n.props.autoComplete]),
    [['password', 'current-password']]);
  const signup = nodes(fixture('src/app/cadastro/page.tsx').render());
  assert.deepEqual(signup.filter(n => n.type === PasswordMarker).map(n => [n.props.id, n.props.autoComplete]),
    [['password', 'new-password'], ['confirmation', 'new-password']]);
});

test('login preserves credentials, redirect and email confirmation errors', async () => {
  for (const confirmed of [false, true]) {
    const h = fixture('src/app/login/page.tsx', { 0: ' person@example.com ', 1: 'password123', 4: false },
      confirmed ? { data: { session: {} }, error: null }
        : { data: null, error: { message: 'Email not confirmed' } });
    await nodes(h.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(h.calls[0].email, 'person@example.com');
    assert.equal(h.calls[0].password, 'password123');
    if (confirmed) assert.equal(h.calls[1], '/dashboard');
    else {
      assert.equal(h.calls.length, 1);
      assert.match(nodes(h.render()).find(n => n.props?.role === 'alert').props.children, /Confirme seu e-mail antes de entrar.*acesso ao e-mail cadastrado/);
    }
  }
});
