/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function target() {
  const events = new Map();
  return {
    events,
    addEventListener(k, fn) { if (!events.has(k)) events.set(k, new Set()); events.get(k).add(fn); },
    removeEventListener(k, fn) { events.get(k)?.delete(fn); },
    fire(k, value = {}) { for (const fn of [...(events.get(k) ?? [])]) fn(value); },
  };
}
function environment() {
  let now = 1000000, id = 0;
  const timeouts = new Map(), intervals = new Map();
  const browser = Object.assign(target(), {
    setTimeout(fn, delay) { const key = ++id; timeouts.set(key, { fn, at: now + delay }); return key; },
    clearTimeout(key) { timeouts.delete(key); },
    setInterval(fn, delay) { const key = ++id; intervals.set(key, { fn, delay }); return key; },
    clearInterval(key) { intervals.delete(key); },
  });
  const doc = Object.assign(target(), { visibilityState: 'visible' });
  return { browser, doc, timeouts, intervals, Date: { now: () => now },
    now: () => now,
    async advance(ms) {
      now += ms;
      for (const [key, timer] of [...timeouts]) if (timer.at <= now) { timeouts.delete(key); timer.fn(); }
      await flush();
    },
    poll() { for (const timer of intervals.values()) timer.fn(); },
  };
}
function load(file, globals = {}, overrides = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, require: name => {
    if (name in overrides) return overrides[name];
    return require(name);
  }, ...globals }, { filename: file });
  return mod.exports;
}
function fixture() {
  const env = environment();
  const events = new Set();
  let session = { user: { id: 'user-a' }, expires_at: env.now() / 1000 + 3600 };
  let userError = null, accessError = null;
  let memberships = [{ band_id: 'band-a', role: 'admin' }];
  const calls = { session: 0, user: 0, memberships: [], signOut: 0, subscriptions: 0, unsubscribed: 0 };
  const client = {
    auth: {
      onAuthStateChange(fn) { calls.subscriptions++; events.add(fn); return { data: { subscription: { unsubscribe() { calls.unsubscribed++; events.delete(fn); } } } }; },
      async getSession() { calls.session++; return { data: { session }, error: null }; },
      async getUser() { calls.user++; return { data: { user: session?.user ?? null }, error: userError }; },
      async signOut(options) { assert.equal(options.scope, 'local'); calls.signOut++; session = null; emit('SIGNED_OUT', null); return { error: null }; },
    },
    from(name) {
      assert.equal(name, 'band_members');
      const filters = {};
      const query = {
        select(columns) { assert.equal(columns, 'band_id, role'); return query; },
        eq(key, value) { filters[key] = value; return query; },
        then(resolve, reject) {
          calls.memberships.push({ ...filters });
          return Promise.resolve({ data: memberships.filter(m => !filters.band_id || m.band_id === filters.band_id), error: accessError }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  function emit(event, value = session) { for (const fn of [...events]) fn(event, value); }
  const api = load('src/lib/private-session.ts', { Date: env.Date });
  const start = band => api.createPrivateSessionController(client, env.browser, env.doc, 'sb-fixture-auth-token', band);
  return { env, client, calls, api, start, emit,
    setSession(value) { session = value; },
    setMemberships(value) { memberships = value; },
    setUserError(value) { userError = value; },
    setAccessError(value) { accessError = value; },
    getSession: () => session,
  };
}
test('public/login routes are unaffected and all private routes share a scope per band', () => {
  const { api } = fixture();
  for (const route of ['/', '/login', '/b/public-slug', '/dashboard-other', '/bandas']) assert.equal(api.getPrivateScope(route), null);
  assert.equal(api.getPrivateScope('/dashboard'), '/dashboard');
  for (const page of ['', '/tarefas', '/agenda', '/links', '/perfil-publico', '/configuracoes']) {
    assert.equal(api.getPrivateScope('/meu-perfil' + page), '/meu-perfil');
  }
  assert.equal(api.getPrivateScope('/meu-perfil-outro'), null);
  assert.equal(api.getPrivateScope('/bandas/nova'), '/bandas/nova');
  for (const page of ['', '/tarefas', '/agenda', '/membros', '/links', '/perfil-publico']) assert.equal(api.getPrivateScope('/bandas/band-a' + page), 'band:band-a');
});
test('one listener per private scope; membership query uses verified account and current band', async () => {
  const f = fixture(), c = f.start('band-a'); await c.check();
  assert.equal(c.getSnapshot().phase, 'ready');
  assert.equal(f.calls.subscriptions, 1);
  assert.deepEqual(f.calls.memberships, [{ user_id: 'user-a', band_id: 'band-a' }]);
  c.dispose(); assert.equal(f.calls.unsubscribed, 1);
});
test('SDK SIGNED_OUT immediately blocks already loaded private content', async () => {
  const f = fixture(), c = f.start('band-a'); await c.check();
  f.emit('SIGNED_OUT', null);
  assert.equal(c.getSnapshot().phase, 'signed-out');
  c.dispose();
});
test('logout between two tabs works through native storage without BroadcastChannel', async () => {
  const tabs = [fixture(), fixture()];
  const controllers = tabs.map(f => f.start('band-a')); await Promise.all(controllers.map(c => c.check()));
  tabs[0].setSession(null); tabs[0].emit('SIGNED_OUT', null);
  tabs[1].setSession(null); tabs[1].env.browser.fire('storage', { key: 'sb-fixture-auth-token', newValue: null });
  for (const c of controllers) assert.equal(c.getSnapshot().phase, 'signed-out');
  controllers.forEach(c => c.dispose());
});
test('unrelated storage updates do not invalidate the private UI', async () => {
  const f = fixture(), c = f.start(); await c.check();
  f.env.browser.fire('storage', { key: 'bandup.appearance', newValue: 'dark' });
  assert.equal(c.getSnapshot().phase, 'ready');
  f.setSession(null); f.env.browser.fire('storage', { key: null, newValue: null });
  assert.equal(c.getSnapshot().phase, 'signed-out'); c.dispose();
});
test('pending session response cannot restore private content after logout', async () => {
  const f = fixture(), pending = deferred(), c = f.start();
  const old = f.getSession(); f.client.auth.getSession = () => pending.promise;
  const checking = c.check(); f.emit('SIGNED_OUT', null);
  pending.resolve({ data: { session: old }, error: null }); await checking;
  assert.equal(c.getSnapshot().phase, 'signed-out'); assert.equal(f.calls.user, 0); c.dispose();
});
test('pending membership response cannot restore private content after logout', async () => {
  const f = fixture(), pending = deferred();
  f.client.from = () => ({ select() { return this; }, eq() { return this; }, then: (...args) => pending.promise.then(...args) });
  const c = f.start('band-a'), checking = c.check(); await flush();
  f.emit('SIGNED_OUT', null); pending.resolve({ data: [{ band_id: 'band-a', role: 'admin' }], error: null });
  await checking; assert.equal(c.getSnapshot().phase, 'signed-out'); c.dispose();
});
test('Auth callback schedules SDK work after returning to avoid Auth lock deadlocks', async () => {
  const f = fixture(), c = f.start(); await c.check(); const before = f.calls.session;
  f.emit('TOKEN_REFRESHED'); assert.equal(f.calls.session, before);
  await f.env.advance(0); assert.equal(f.calls.session, before + 1); assert.equal(c.getSnapshot().phase, 'ready'); c.dispose();
});
test('expiry deadline removes private UI even when browser focus does not change', async () => {
  const f = fixture(); f.setSession({ user: { id: 'user-a' }, expires_at: f.env.now() / 1000 + 1 });
  const c = f.start(); await c.check();
  await f.env.advance(1000); assert.equal(c.getSnapshot().phase, 'signed-out'); assert.equal(f.calls.signOut, 1); c.dispose();
});
test('a successful refresh extends expiry without resetting loaded page state', async () => {
  const f = fixture(), c = f.start(); await c.check(); const epoch = c.getSnapshot().epoch;
  f.setSession({ user: { id: 'user-a' }, expires_at: f.env.now() / 1000 + 7200 });
  f.emit('TOKEN_REFRESHED'); await f.env.advance(0);
  assert.equal(c.getSnapshot().phase, 'ready'); assert.equal(c.getSnapshot().epoch, epoch); c.dispose();
});
test('invalid remote account removes local credentials before login redirection', async () => {
  const f = fixture(); f.setUserError({ status: 401 }); const c = f.start(); await c.check();
  assert.equal(c.getSnapshot().phase, 'signed-out'); assert.equal(f.calls.signOut, 1); c.dispose();
});
test('temporary network failure blocks private content without forcing logout', async () => {
  const f = fixture(), c = f.start(); await c.check();
  f.setUserError({ status: 0, name: 'AuthRetryableFetchError' }); await c.check();
  assert.equal(c.getSnapshot().phase, 'error'); assert.equal(f.calls.signOut, 0);
  f.setUserError(null); await c.check(); assert.equal(c.getSnapshot().phase, 'ready'); c.dispose();
});
test('failed local session removal stays blocked instead of login/dashboard loop', async () => {
  const f = fixture(); f.setUserError({ status: 401 });
  f.client.auth.signOut = async () => ({ error: new Error('offline') });
  const c = f.start(); await c.check(); assert.equal(c.getSnapshot().phase, 'error'); c.dispose();
});
test('membership revocation redirects to dashboard without signing out a valid account', async () => {
  const f = fixture(), c = f.start('band-a'); await c.check();
  f.setMemberships([]); f.env.poll(); await flush();
  assert.equal(c.getSnapshot().phase, 'forbidden'); assert.equal(f.calls.signOut, 0); c.dispose();
});
test('role downgrade and dashboard membership changes remount private state', async () => {
  for (const scope of ['band-a', undefined]) {
    const f = fixture(), c = f.start(scope); await c.check(); const epoch = c.getSnapshot().epoch;
    f.setMemberships([{ band_id: 'band-a', role: 'member' }]); await c.check();
    assert.ok(c.getSnapshot().epoch > epoch); c.dispose();
  }
});
test('account switching hides old private state before verifying the new account', async () => {
  const f = fixture(), c = f.start(); await c.check(); const epoch = c.getSnapshot().epoch;
  f.setSession({ user: { id: 'user-b' }, expires_at: f.env.now() / 1000 + 3600 }); f.emit('SIGNED_IN');
  assert.equal(c.getSnapshot().phase, 'checking'); await f.env.advance(0);
  assert.equal(c.getSnapshot().phase, 'ready'); assert.ok(c.getSnapshot().epoch > epoch);
  assert.equal(f.calls.memberships.at(-1).user_id, 'user-b'); c.dispose();
});
test('focus checks current membership; hidden-tab polling waits until resume', async () => {
  const f = fixture(), c = f.start('band-a'); await c.check();
  f.env.doc.visibilityState = 'hidden'; const before = f.calls.session; f.env.poll(); await flush();
  assert.equal(f.calls.session, before);
  f.setMemberships([]); f.env.doc.visibilityState = 'visible'; f.env.doc.fire('visibilitychange');
  await flush(); assert.equal(c.getSnapshot().phase, 'forbidden'); c.dispose();
});
test('pagehide/pageshow block cached UI and revalidate after back-forward restoration', async () => {
  const f = fixture(), c = f.start(); await c.check(); f.env.browser.fire('pagehide');
  assert.equal(c.getSnapshot().phase, 'checking'); f.setSession(null); f.env.browser.fire('pageshow');
  await flush(); assert.equal(c.getSnapshot().phase, 'signed-out'); c.dispose();
});
test('hung validation and disposal cannot leave or resurrect a ready screen', async () => {
  const f = fixture(), c = f.start(); await c.check(); const pending = deferred();
  f.client.auth.getSession = () => pending.promise; const checking = c.check();
  await f.env.advance(10000); assert.equal(c.getSnapshot().phase, 'error');
  const last = c.getSnapshot(); c.dispose(); pending.resolve({ data: { session: f.getSession() }, error: null }); await checking;
  assert.equal(c.getSnapshot(), last); assert.equal(f.env.intervals.size, 0); assert.equal(f.env.timeouts.size, 0);
  for (const listeners of [...f.env.browser.events.values(), ...f.env.doc.events.values()]) assert.equal(listeners.size, 0);
});
function boundaryHarness(f) {
  const states = [], refs = [], effects = [];
  let stateIndex, refIndex, effectIndex;
  const redirects = [], router = { replace: path => redirects.push(path) };
  const hooks = { ...React,
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = v; }]; },
    useRef(initial) { const i = refIndex++; if (!(i in refs)) refs[i] = { current: initial }; return refs[i]; },
    useEffect(fn, deps) {
      const i = effectIndex++, previous = effects[i];
      if (!previous || deps.some((d, j) => !Object.is(d, previous.deps[j]))) effects[i] = { deps, fn, pending: true, cleanup: previous?.cleanup };
    },
  };
  const Boundary = load('src/components/private-session-boundary.tsx', { window: f.env.browser, document: f.env.doc }, {
    react: hooks, 'next/navigation': { usePathname: () => '/bandas/band-a', useRouter: () => router },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => f.client, getSupabaseAuthStorageKey: () => 'sb-fixture-auth-token' },
    '@/lib/private-session': f.api,
  }).default;
  const scoped = Boundary({ children: React.createElement('section', null, 'PRIVATE DATA') });
  return { redirects,
    render() { stateIndex = refIndex = effectIndex = 0; const tree = scoped.type(scoped.props);
      for (const e of effects) if (e.pending) { e.cleanup?.(); e.cleanup = e.fn(); e.pending = false; } return tree; },
    dispose() { for (const e of effects) e.cleanup?.(); },
  };
}
test('boundary unmounts private children on logout and redirects once, including late loading responses', async () => {
  const f = fixture(), h = boundaryHarness(f);
  assert.equal(h.render().type, 'main'); await flush();
  const ready = h.render(); assert.equal(ready.type, React.Fragment); assert.match(renderToStaticMarkup(ready), /PRIVATE DATA/);
  const pending = deferred(), original = f.getSession(); f.client.auth.getSession = () => pending.promise; f.env.poll();
  f.emit('SIGNED_OUT', null); assert.equal(h.render().type, 'main'); assert.deepEqual(h.redirects, ['/login']);
  pending.resolve({ data: { session: original }, error: null }); await flush(); h.render();
  assert.deepEqual(h.redirects, ['/login']); h.dispose();
});
test('boundary treats band access loss separately from invalid authentication', async () => {
  const f = fixture(), h = boundaryHarness(f); h.render(); await flush(); h.render();
  f.setMemberships([]); f.env.poll(); await flush(); assert.equal(h.render().type, 'main');
  assert.deepEqual(h.redirects, ['/dashboard']); assert.equal(f.calls.signOut, 0); h.dispose();
});

test('same-account storage refresh and focus preserve form state while access remains valid', async () => {
  const f = fixture(), c = f.start('band-a'); await c.check(); const epoch = c.getSnapshot().epoch;
  f.env.browser.fire('storage', { key: 'sb-fixture-auth-token', newValue: JSON.stringify(f.getSession()) });
  assert.equal(c.getSnapshot().phase, 'ready'); await f.env.advance(0);
  f.env.browser.fire('focus'); assert.equal(c.getSnapshot().phase, 'ready'); await flush();
  assert.equal(c.getSnapshot().epoch, epoch); c.dispose();
});
test('storage account switch blocks old data even without an SDK BroadcastChannel event', async () => {
  const f = fixture(), c = f.start(); await c.check();
  f.setSession({ user: { id: 'user-b' }, expires_at: f.env.now() / 1000 + 3600 });
  f.env.browser.fire('storage', { key: 'sb-fixture-auth-token', newValue: JSON.stringify(f.getSession()) });
  assert.equal(c.getSnapshot().phase, 'checking'); await f.env.advance(0);
  assert.equal(c.getSnapshot().phase, 'ready'); assert.equal(f.calls.memberships.at(-1).user_id, 'user-b'); c.dispose();
});
test('expired refresh credentials with HTTP 400 are invalidated without a redirect loop', async () => {
  const f = fixture(); f.client.auth.getSession = async () => ({ data: { session: null }, error: { status: 400, code: 'refresh_token_not_found' } });
  const c = f.start(); await c.check(); assert.equal(c.getSnapshot().phase, 'signed-out'); assert.equal(f.calls.signOut, 1); c.dispose();
});

test('navigating to a new private route after logout cannot reveal a cached page', async () => {
  const f = fixture(), old = f.start('band-a'); await old.check();
  f.setSession(null); f.emit('SIGNED_OUT', null); old.dispose();
  for (const band of [undefined, 'band-a', 'band-b']) {
    const next = f.start(band); assert.equal(next.getSnapshot().phase, 'checking');
    await next.check(); assert.equal(next.getSnapshot().phase, 'signed-out'); next.dispose();
  }
});
test('Safari storage fallback uses the same default project namespace as the installed SDK', () => {
  for (const [url, expected] of [['https://fixture.supabase.co', 'sb-fixture-auth-token'], ['http://127.0.0.1:55321', 'sb-127-auth-token']]) {
    const api = load('src/lib/supabase/client.ts', { URL, process: { env: { NEXT_PUBLIC_SUPABASE_URL: url } } }, {
      '@supabase/supabase-js': { createClient() { throw new Error('No backend initialization permitted in this test'); } },
    });
    assert.equal(api.getSupabaseAuthStorageKey(), expected);
  }
});
