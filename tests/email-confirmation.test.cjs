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
    async getSession() { calls.push('session'); if (state.throws) throw Error('secret'); return { data: { session: state.session }, error: state.sessionError }; },
    async getUser() { calls.push('user'); return { data: { user: state.user }, error: state.userError }; },
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
