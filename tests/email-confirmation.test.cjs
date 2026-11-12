/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/email-confirmation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: mod, exports: mod.exports, URLSearchParams, Date });
const { resolveLoginSession, confirmationFailure, sessionFailure } = mod.exports;
const callback = new URL('https://bandup.example/login#access_token=secret&refresh_token=secret&type=signup');
function fixture(overrides = {}) {
  const calls = [];
  const user = { id: 'user', email_confirmed_at: '2026-11-04', user_metadata: { display_name: 'Ana Silva' } };
  const state = { user, session: { user, access_token: 'secret', expires_at: Date.now() / 1000 + 3600 }, ...overrides };
  const client = { auth: {
    async initialize() { calls.push('initialize'); if (state.pending) await state.pending; return { error: state.initError }; },
    async verifyOtp(args) {
      calls.push(['verify', args]);
      if (state.verifyPending) await state.verifyPending;
      if (state.verifyThrows) throw Error('sensitive diagnostic');
      const session = state.verificationSession === undefined ? state.session : state.verificationSession;
      if (!state.verifyError && session && !state.skipPersistence) state.session = session;
      return { data: { session }, error: state.verifyError };
    },
    async getSession() { calls.push('session'); if (state.throws) throw Error('secret'); return { data: { session: state.session }, error: state.sessionError }; },
    async getUser() { calls.push('user'); return { data: { user: state.user }, error: state.userError }; },
    async signInWithPassword(args) { calls.push(['signin', args]); return state.signinResponse; },
  } };
  return { client, calls, state };
}

test('valid confirmation waits for SDK persistence and server verification, preserving display name', async () => {
  let release;
  const f = fixture({ pending: new Promise(resolve => { release = resolve; }) });
  const result = resolveLoginSession(f.client, callback);
  assert.deepEqual(f.calls, ['initialize']);
  release();
  assert.equal((await result).authenticated, true);
  assert.deepEqual(f.calls, ['initialize', 'session', 'user']);
  assert.equal(f.state.user.user_metadata.display_name, 'Ana Silva');
});

test('expired, invalid and reused links cannot fall back to an older valid session', async () => {
  for (const code of ['otp_expired', 'access_denied', 'invalid_token']) {
    const f = fixture();
    const result = await resolveLoginSession(f.client, new URL(`https://bandup.example/login#error_code=${code}&error_description=secret`));
    assert.equal(result.authenticated, false);
    assert.equal(result.message, confirmationFailure);
    assert.deepEqual(f.calls, ['initialize']);
  }
  const f = fixture({ initError: { message: 'secret' } });
  assert.equal((await resolveLoginSession(f.client, callback)).authenticated, false);
  assert.deepEqual(f.calls, ['initialize']);
});

test('missing session, unconfirmed user, mismatched identity and invalid tokens never authenticate', async () => {
  for (const override of [
    { session: null }, { user: null }, { user: { id: 'user' } },
    { user: { id: 'other', email_confirmed_at: 'date' } },
    { sessionError: { message: 'secret' } }, { userError: { message: 'secret' } },
    { session: { user: { id: 'user' }, access_token: 'secret', expires_at: 1 } },
    { session: { user: { id: 'user' }, expires_at: Date.now() / 1000 + 3600 } },
    { throws: true },
  ]) {
    const result = await resolveLoginSession(fixture(override).client, callback);
    assert.equal(result.authenticated, false);
    assert.equal(result.message, confirmationFailure);
  }
});

test('ordinary login accepts a server verified existing session and leaves signed out login available', async () => {
  const url = new URL('https://bandup.example/login');
  assert.equal((await resolveLoginSession(fixture().client, url)).authenticated, true);
  assert.equal((await resolveLoginSession(fixture({ session: null }).client, url)).message, '');
  assert.equal((await resolveLoginSession(fixture({ throws: true }).client, url)).message, sessionFailure);
});

test('unsupported callback types or incomplete flows cannot report signup success', async () => {
  for (const suffix of ['#type=signup', '#access_token=incomplete', '#type=recovery&access_token=secret', '?code=unsupported', '?token_hash=unsupported', '?error=invalid']) {
    const result = await resolveLoginSession(fixture().client, new URL('https://bandup.example/login' + suffix));
    assert.equal(result.authenticated, false);
    assert.equal(result.message, confirmationFailure);
  }
});

test('implicit callbacks accept signup/email types only for the session actually returned by that link', async () => {
  for (const type of ['signup', 'email']) {
    assert.equal((await resolveLoginSession(fixture().client,
      new URL(`https://bandup.example/login#access_token=secret&refresh_token=secret&type=${type}`))).authenticated, true);
  }
  const f = fixture({ session: { user: { id: 'user' }, access_token: 'older-session', expires_at: Date.now() / 1000 + 3600 } });
  assert.equal((await resolveLoginSession(f.client, callback)).authenticated, false);
  assert.deepEqual(f.calls, ['initialize', 'session']);
});

test('custom token-hash templates verify once, persist the resulting session and verify the confirmed account', async () => {
  for (const pathname of ['/login', '/auth/confirm']) for (const type of ['email', 'signup']) {
    const f = fixture();
    const result = await resolveLoginSession(f.client,
      new URL(`https://bandup.example${pathname}?token_hash=fake-confirmation-hash&type=${type}&next=https://other.invalid`));
    assert.equal(result.authenticated, true);
    assert.equal(f.calls[0], 'initialize');
    assert.equal(JSON.stringify(f.calls[1]), JSON.stringify(['verify', { token_hash: 'fake-confirmation-hash', type }]));
    assert.deepEqual(f.calls.slice(2), ['session', 'user']);
  }
});

test('failed, reused, expired or sessionless hash verification never accepts an older signed-in session', async () => {
  for (const override of [{ verifyError: { code: 'otp_expired' } }, { verifyError: { code: 'invalid_token' } },
    { verificationSession: null }, { verifyThrows: true }, { user: { id: 'user' } },
    { user: { id: 'other', email_confirmed_at: 'date' } }]) {
    const f = fixture(override);
    const result = await resolveLoginSession(f.client, new URL('https://bandup.example/login?token_hash=fake-hash&type=email'));
    assert.equal(result.authenticated, false); assert.equal(result.message, confirmationFailure);
    assert.equal(f.calls.filter(call => Array.isArray(call)).length, 1);
  }
});

test('hash success cannot use a different session left in storage', async () => {
  const f = fixture({ skipPersistence: true,
    verificationSession: { user: { id: 'user' }, access_token: 'new-confirmation-token', expires_at: Date.now() / 1000 + 3600 } });
  const result = await resolveLoginSession(f.client, new URL('https://bandup.example/login?token_hash=fake&type=email'));
  assert.equal(result.authenticated, false); assert.equal(result.message, confirmationFailure);
  assert.equal(f.calls.includes('user'), false);
});

test('installed Supabase SDK verifies a token-hash, persists its session and reads the confirmed user', async t => {
  const { createClient } = require('@supabase/supabase-js');
  const requests = [], storage = new Map();
  const user = { id: '11111111-1111-4111-8111-111111111111', email_confirmed_at: '2026-11-12T00:00:00Z' };
  const session = { access_token: 'unit-access-token', refresh_token: 'unit-refresh-token',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  const client = createClient('https://auth-unit.invalid', 'sb_publishable_unit_test', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'email-confirmation-unit',
      storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname; requests.push(path);
      assert.equal(new URL(String(input)).origin, 'https://auth-unit.invalid');
      if (path === '/auth/v1/verify') {
        assert.deepEqual(JSON.parse(init.body), { token_hash: 'unit-hash', type: 'email', gotrue_meta_security: {} });
        return new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.equal(path, '/auth/v1/user');
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer unit-access-token');
      return new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  t.after(() => client.auth.stopAutoRefresh());
  const result = await resolveLoginSession(client, new URL('https://bandup.example/auth/confirm?token_hash=unit-hash&type=email'));
  assert.equal(result.authenticated, true);
  assert.deepEqual(requests, ['/auth/v1/verify', '/auth/v1/user']);
  assert.ok(storage.has('email-confirmation-unit'));
});

test('unsupported, incomplete or mixed token-hash callbacks do not request OTP verification', async () => {
  for (const query of ['token_hash=fake', 'token_hash=fake&type=recovery', 'token_hash=fake&type=invite',
    'token_hash=fake&type=email_change', 'token_hash=fake&type=email&access_token=ambiguous',
    'token_hash=fake&type=email&refresh_token=ambiguous', 'token_hash=fake&type=email&code=ambiguous',
    'token_hash=fake&type=email&error=invalid']) {
    const f = fixture();
    assert.equal((await resolveLoginSession(f.client, new URL('https://bandup.example/login?' + query))).authenticated, false);
    assert.equal(f.calls.some(call => Array.isArray(call)), false);
  }
});

test('confirmation route reuses the tested login flow without server secrets or another Auth client', () => {
  const source = fs.readFileSync('src/app/auth/confirm/page.tsx', 'utf8');
  assert.match(source, /export \{ default \} from "@\/app\/login\/page"/);
  assert.doesNotMatch(source, /service_role|SERVICE_ROLE|createClient/);
});

function pageFixture(f, href = callback.href) {
  const React = require('react');
  const component = { exports: {} }, states = [], refs = [], navigations = [], cleanups = [], timers = new Map();
  let cursor = 0, refCursor = 0, effect, nextTimer = 0;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/login/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: component, exports: component.exports, URL,
    window: { location: { href }, history: { state: {}, replaceState: (...args) => cleanups.push(args) },
      setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id) },
    require(name) {
      if (name === 'react') return { ...React,
        useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial;
          return [states[i], value => { states[i] = value; }]; },
        useRef(initial) { const i = refCursor++; return refs[i] ??= { current: initial }; },
        useEffect(fn) { effect = fn; },
      };
      if (name === '@/lib/email-confirmation') return mod.exports;
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => f.client };
      if (name === 'next/navigation') return { useRouter: () => ({ replace: path => navigations.push(path) }) };
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null };
      return require(name);
    },
  });
  const render = () => { cursor = refCursor = 0; return component.exports.default(); };
  render();
  return { states, navigations, cleanups, timers, render, start: () => effect() };
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate); };

test('login callback navigates only after validation and cleans sensitive URL parameters', async () => {
  const h = pageFixture(fixture()); const dispose = h.start();
  assert.deepEqual(h.navigations, []);
  await settle();
  assert.deepEqual(h.navigations, ['/dashboard']);
  assert.equal(h.cleanups[0][2], '/login');
  dispose();
});

test('failed callback shows a safe explanation and reveals the login form', async () => {
  const h = pageFixture(fixture(), 'https://bandup.example/login#error=access_denied&error_description=secret');
  const dispose = h.start(); await settle();
  assert.deepEqual(h.navigations, []);
  assert.equal(h.states[4], false);
  assert.equal(h.states[2], confirmationFailure);
  assert.equal(h.cleanups[0][2], '/login');
  dispose();
});

test('password login blocks an unconfirmed email and succeeds after confirmation without exposing server diagnostics', async () => {
  const f = fixture({ session: null, signinResponse: { data: { session: null }, error: {
    code: 'email_not_confirmed', message: 'Email not confirmed',
  } } });
  const h = pageFixture(f, 'https://bandup.example/login'); const dispose = h.start(); await settle();
  h.states[0] = ' person@example.com '; h.states[1] = 'unit-password';
  const findForm = tree => {
    if (!tree || typeof tree !== 'object') return null;
    if (Array.isArray(tree)) return tree.map(findForm).find(Boolean);
    return tree.type === 'form' ? tree : findForm(tree.props?.children);
  };
  await findForm(h.render()).props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.navigations, []); assert.match(h.states[2], /Confirme seu e-mail/);
  assert.doesNotMatch(h.states[2], /Email not confirmed|person@example/);
  f.state.signinResponse = { data: { session: { user: f.state.user } }, error: null };
  await findForm(h.render()).props.onSubmit({ preventDefault() {} });
  assert.deepEqual(h.navigations, ['/dashboard']);
  assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'signin').at(-1)[1].email, 'person@example.com');
  dispose();
});

test('hash callback survives StrictMode without consuming the one-time link twice and ignores external next URLs', async () => {
  let release;
  const f = fixture({ verifyPending: new Promise(resolve => { release = resolve; }) });
  const h = pageFixture(f, 'https://bandup.example/auth/confirm?token_hash=fake-hash&type=email&next=https://other.invalid');
  const firstDispose = h.start(); await settle(); firstDispose();
  const dispose = h.start(); release(); await settle();
  assert.equal(f.calls.filter(call => Array.isArray(call)).length, 1);
  assert.deepEqual(h.navigations, ['/dashboard']);
  assert.equal(h.cleanups.at(-1)[2], '/login'); dispose();
});

test('timeout and leaving the screen prevent delayed redirects; StrictMode does not replay initialization', async () => {
  for (const mode of ['timeout', 'unmount', 'strict']) {
    let release;
    const f = fixture({ pending: new Promise(resolve => { release = resolve; }) });
    const h = pageFixture(f); const dispose = h.start();
    if (mode === 'timeout') [...h.timers.values()][0]();
    else dispose();
    const secondDispose = mode === 'strict' ? h.start() : null;
    release(); await settle();
    assert.deepEqual(h.navigations, mode === 'strict' ? ['/dashboard'] : []);
    assert.equal(f.calls.filter(call => call === 'initialize').length, 1);
    if (mode === 'timeout') { assert.equal(h.states[4], false); assert.equal(h.states[2], sessionFailure); }
    secondDispose?.(); dispose();
  }
});
