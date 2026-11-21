/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const origin = 'https://bandup.example';
const token = 'fixture-recovery-token-1234';
const submitEvent = { preventDefault() {} };

function load(file, dependencies, globals = {}) {
  const testModule = { exports: {} };
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  vm.runInNewContext(outputText, {
    module: testModule, exports: testModule.exports, URL, URLSearchParams,
    require: name => dependencies[name] ?? require(name), ...globals,
  });
  return testModule.exports;
}

function recoveryLibrary(auth, calls = []) {
  return load('src/lib/password-recovery.ts', {
    '@supabase/supabase-js': { createClient(_url, _key, options) {
      calls.push(options.auth);
      return { auth };
    } },
  }, { process: { env: { NEXT_PUBLIC_SITE_URL: origin, NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture-key' } } });
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
}

function page(file, library, hash = '', search = '') {
  const states = [], refs = [], effects = [], navigations = [], history = [];
  let stateIndex = 0, refIndex = 0;
  const location = { hash, search, origin };
  const Page = load(file, {
    react: {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = value; }];
      },
      useRef: initial => refs[refIndex++] ??= { current: initial },
      useEffect: run => effects.push(run),
    },
    'next/link': { default: () => null },
    'next/navigation': { useRouter: () => ({ replace: value => navigations.push(value) }) },
    '@/components/password-input': { default: () => null },
    '@/lib/password-recovery': library,
  }, { window: { location, history: { replaceState(_state, _title, path) {
    history.push(path);
    location.hash = '';
    location.search = '';
  } } } });
  const render = () => { stateIndex = 0; refIndex = 0; return nodes(Page.default()); };
  render();
  const effect = effects[0];
  if (effect) {
    effect()();
    effect(); // Strict Mode replay after the fragment has been removed.
  }
  return { render, navigations, history };
}

test('request uses the exact approved callback and keeps email responses uniform', async () => {
  for (const response of [{ error: null }, { error: { code: 'user_not_found' } }, new Error('Offline')]) {
    const configurations = [], requests = [];
    let disposed = 0;
    const lib = recoveryLibrary({
      async resetPasswordForEmail(email, options) {
        requests.push([email, options.redirectTo]);
        if (response instanceof Error) throw response;
        return response;
      },
      async dispose() { disposed++; },
    }, configurations);
    assert.equal(await lib.requestPasswordRecovery('a@example.test', origin), lib.recoveryRequestMessage);
    assert.deepEqual(requests, [['a@example.test', origin + '/redefinir-senha']]);
    assert.equal(configurations[0].persistSession, false);
    assert.equal(configurations[0].autoRefreshToken, false);
    assert.equal(configurations[0].detectSessionInUrl, false);
    assert.equal(configurations[0].storageKey, 'bandup-password-recovery');
    assert.equal(disposed, 1);
    await assert.rejects(lib.requestPasswordRecovery('a@example.test', 'https://outside.example'));
    assert.equal(requests.length, 1);
  }
});

test('request form validates email and suppresses duplicate submits', async () => {
  let resolve;
  const calls = [];
  const { render } = page('src/app/esqueci-minha-senha/page.tsx', {
    requestPasswordRecovery(email, from) {
      calls.push([email, from]);
      return new Promise(done => { resolve = done; });
    },
  });
  const submit = () => render().find(node => node.type === 'form').props.onSubmit(submitEvent);
  await submit();
  assert.equal(render().find(node => node.props.role === 'alert').props.children, 'Informe um e-mail válido.');
  render().find(node => node.type === 'input').props.onChange({ target: { value: ' a@example.test ' } });
  const pending = submit();
  await submit();
  assert.equal(render().find(node => node.type === 'button').props.disabled, true);
  assert.deepEqual(calls, [['a@example.test', origin]]);
  resolve('Resposta genérica');
  await pending;
  assert.equal(render().find(node => node.props.role === 'status').props.children, 'Resposta genérica');
});

test('reset scrubs the fragment, verifies only on explicit action and updates only the recovery account', async () => {
  const calls = [], configurations = [];
  const lib = recoveryLibrary({
    async verifyOtp(args) {
      calls.push(['verify', args.token_hash === token, args.type]);
      return { data: { user: { id: 'recovery-account' }, session: { access_token: 'fixture', user: { id: 'recovery-account' } } } };
    },
    async updateUser(args) {
      calls.push(['update', args.password.length]);
      return { data: { user: { id: 'recovery-account' } } };
    },
    async signOut(args) { calls.push(['signout', args.scope]); },
    async dispose() { calls.push(['dispose']); },
  }, configurations);
  const { render, history, navigations } = page('src/app/redefinir-senha/page.tsx', lib, '#token_hash=' + token);
  assert.deepEqual(history, ['/redefinir-senha']);
  assert.deepEqual(calls, []);
  assert.equal(render().some(node => node.type === 'form'), false);
  const confirm = render().find(node => node.type === 'button').props.onClick;
  await Promise.all([confirm(), confirm()]);
  assert.deepEqual(calls, [['verify', true, 'recovery']]);
  assert.equal(configurations[0].persistSession, false);
  const change = (name, value) => render().find(node => node.props.name === name).props.onChange({ target: { value } });
  const submit = () => render().find(node => node.type === 'form').props.onSubmit(submitEvent);
  change('password', 'short');
  await submit();
  change('password', 'new-password');
  await submit();
  assert.equal(calls.length, 1);
  change('confirmation', 'new-password');
  await submit();
  assert.deepEqual(calls, [['verify', true, 'recovery'], ['update', 12], ['signout', 'local'], ['dispose']]);
  assert.deepEqual(navigations, ['/login']);
});

test('direct access, token duplicates and rejected recovery never fall back to an existing account', async () => {
  let verifications = 0;
  const lib = recoveryLibrary({
    async verifyOtp() { verifications++; return { data: { user: null, session: null }, error: new Error('Expired or used') }; },
    async updateUser() { assert.fail('password update without recovery'); },
    async signOut() {},
    async dispose() {},
  });
  for (const hash of ['', '#token_hash=' + token + '&token_hash=' + token]) {
    const { render } = page('src/app/redefinir-senha/page.tsx', lib, hash);
    assert.equal(render().find(node => node.props.role === 'alert').props.children, lib.recoveryLinkError);
    assert.equal(render().some(node => node.type === 'form'), false);
  }
  assert.equal(verifications, 0);
  const { render, navigations } = page('src/app/redefinir-senha/page.tsx', lib, '#token_hash=' + token);
  await render().find(node => node.type === 'button').props.onClick();
  assert.equal(verifications, 1);
  assert.equal(render().find(node => node.props.role === 'alert').props.children, lib.recoveryLinkError);
  assert.equal(render().some(node => node.type === 'form'), false);
  assert.deepEqual(navigations, []);
});
