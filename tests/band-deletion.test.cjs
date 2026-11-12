/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const O = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const attempt = (extra = {}) => ({ version: 1, actorId: A, bandId: B, operationId: O, confirmation: 'Aurora é  ', ...extra });
const receipt = (extra = {}) => ({ status: 'deleted', operation_id: O, cleanup_status: 'pending', ...extra });
const settle = async () => { for (let n = 0; n < 12; n++) await new Promise(setImmediate); };
function load(file, overrides = {}, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, AbortController, URL, Event, setTimeout, clearTimeout,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test' } },
    ...globals, require(name) {
      if (name in overrides) return overrides[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'), overrides, globals);
      return require(name);
    } });
  return mod.exports;
}
function serviceFixture(options = {}) {
  const calls = [], state = { actor: A, saved: null, ...options };
  const store = {
    async read() { return state.saved; },
    async getOrCreate(actorId, bandId, confirmation) {
      calls.push({ type: 'persist', actorId, bandId, confirmation });
      if (state.storageFailure) throw Error('storage unavailable');
      if (state.waitPersist) await state.waitPersist;
      state.saved ??= attempt({ actorId, bandId, confirmation });
      return state.saved;
    },
  };
  const client = { auth: { async getSession() {
    return { data: { session: state.actor ? { user: { id: state.actor }, access_token: 'fixed-token' } : null }, error: null };
  } } };
  const scoped = { async rpc(name, args) {
    calls.push({ type: 'rpc', name, args });
    if (state.beforeRpc) state.beforeRpc(name);
    if (name === 'bandup_get_band_deletion') {
      if (state.recoveryThrow) throw Error('lost read');
      return { data: state.recovery ?? null, error: state.recoveryError ?? null };
    }
    assert.ok(state.saved, 'persist before mutation');
    if (state.throwDelete) throw Error('lost response');
    return state.response ?? { data: receipt(), error: null };
  } };
  const api = load('src/lib/band-deletion.ts', { '@supabase/supabase-js': { createClient(url, key, config) {
    assert.equal(url, 'https://project.supabase.co'); assert.equal(key, 'public-test');
    assert.equal(typeof config.accessToken, 'function');
    calls.push({ type: 'scoped' });
    return scoped;
  } } }, { fetch: async (_url, config) => {
    assert.equal(config.headers.Authorization, 'Bearer fixed-token');
    return { ok: true, json: async () => ({ id: A, is_anonymous: !!state.anonymous }) };
  } });
  return { api, state, calls, store, client,
    submit: (confirmation = attempt().confirmation, expected = attempt().confirmation) => api.submitBandDeletion(
      client, store, A, B, confirmation, expected, new AbortController().signal),
    recover: (saved = attempt()) => api.recoverBandDeletion(client, saved, new AbortController().signal) };
}

test('exact confirmation preserves spaces, case and Unicode bytes', async () => {
  for (const value of ['Aurora é', 'aurora é  ', 'Aurora e\u0301  ', '', ' Aurora é  ']) {
    const f = serviceFixture(); await assert.rejects(f.submit(value)); assert.equal(f.calls.length, 0);
  }
  const f = serviceFixture(); assert.equal((await f.submit()).result.status, 'deleted');
  const rpc = f.calls.find(c => c.name === 'bandup_delete_band');
  assert.deepEqual(JSON.parse(JSON.stringify(rpc.args)), { p_band_id: B, p_confirmation: 'Aurora é  ', p_operation_id: O });
  assert.ok(f.calls.findIndex(c => c.type === 'persist') < f.calls.indexOf(rpc));
});
test('mutation waits for persistence COMMIT and storage failure prevents any RPC', async () => {
  let commit; const f = serviceFixture({ waitPersist: new Promise(resolve => { commit = resolve; }) });
  const pending = f.submit(); await settle(); assert.equal(f.calls.filter(c => c.type === 'rpc').length, 0);
  commit(); await pending; assert.equal(f.calls.filter(c => c.name === 'bandup_delete_band').length, 1);
  const fail = serviceFixture({ storageFailure: true }); await assert.rejects(fail.submit());
  assert.equal(fail.calls.filter(c => c.type === 'rpc').length, 0);
});
test('missing, anonymous or changed account cannot mutate', async () => {
  for (const options of [{ actor: null }, { actor: OTHER }, { anonymous: true }]) {
    const f = serviceFixture(options); await assert.rejects(f.submit());
    assert.equal(f.calls.filter(c => c.type === 'rpc').length, 0);
  }
});
test('repeat reuses original operation and arguments without generating another ID', async () => {
  const f = serviceFixture({ response: { data: null, error: null } });
  assert.equal((await f.submit()).result.status, 'uncertain');
  f.state.response = { data: receipt(), error: null };
  assert.equal((await f.submit()).result.status, 'deleted');
  const writes = f.calls.filter(c => c.name === 'bandup_delete_band');
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].args, writes[1].args);
});
test('lost mutation response is recovered only through the actor receipt', async () => {
  const f = serviceFixture({ throwDelete: true, recovery: receipt() });
  assert.equal((await f.submit()).result.status, 'deleted');
  assert.deepEqual(f.calls.filter(c => c.type === 'rpc').map(c => c.name), ['bandup_delete_band', 'bandup_get_band_deletion']);
  assert.equal(f.calls.at(-1).args.p_operation_id, O);
});
for (const code of ['42501', '22023', '55P03', '40001', '40P01', '25000', 'PGRST202']) {
  test(`server error ${code} stays inconclusive and keeps the persisted attempt`, async () => {
    const f = serviceFixture({ response: { data: null, error: { code } } });
    assert.equal((await f.submit()).result.status, 'uncertain'); assert.equal(f.state.saved.operationId, O);
    assert.equal(f.calls.filter(c => c.name === 'bandup_delete_band').length, 1);
    assert.equal(f.calls.filter(c => c.name === 'bandup_get_band_deletion').length, 1);
  });
}
test('NULL, expired/malformed/wrong-operation/error receipts never establish success or trigger mutation', async () => {
  for (const options of [{}, { recovery: receipt({ operation_id: OTHER }) }, { recovery: receipt({ cleanup_status: 'bad' }) },
    { recovery: {} }, { recovery: receipt(), recoveryError: { code: 'network' } }, { recoveryThrow: true }]) {
    const f = serviceFixture(options); const result = await f.recover();
    assert.equal(result.status, 'uncertain'); assert.match(result.message, /ausência de recibo não confirma/);
    assert.deepEqual(f.calls.filter(c => c.type === 'rpc').map(c => c.name), ['bandup_get_band_deletion']);
  }
});
test('renamed band does not replace the saved confirmation or launch another deletion', async () => {
  const saved = attempt(), f = serviceFixture({ saved });
  const result = await f.submit('New name', 'New name');
  assert.equal(result.attempt, saved); assert.equal(result.result.status, 'uncertain');
  assert.equal(f.calls.some(c => c.name === 'bandup_delete_band'), false);
});
test('a stale tab cannot allocate another ID after another tab clears or replaces its attempt', async () => {
  for (const saved of [null, attempt({ operationId: OTHER })]) {
    const f = serviceFixture({ saved, recovery: receipt() });
    const response = await f.api.submitBandDeletion(f.client, f.store, A, B, attempt().confirmation,
      attempt().confirmation, new AbortController().signal, attempt());
    assert.equal(response.result.status, 'deleted'); assert.equal(response.attempt.operationId, O);
    assert.equal(f.calls.some(c => c.type === 'persist' || c.name === 'bandup_delete_band'), false);
  }
});
test('an account switch while the delete response is in flight cannot confirm success', async () => {
  const f = serviceFixture({ beforeRpc(name) { if (name === 'bandup_delete_band') f.state.actor = OTHER; } });
  await assert.rejects(f.submit()); assert.equal(f.state.saved.operationId, O);
});
test('corrupt or cross-band persisted attempts are rejected before any RPC', async () => {
  for (const saved of [attempt({ bandId: OTHER }), attempt({ actorId: OTHER }), attempt({ operationId: 'bad' })]) {
    const f = serviceFixture({ saved }); await assert.rejects(f.submit());
    assert.equal(f.calls.filter(c => c.type === 'rpc').length, 0);
  }
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function uiFixture(t, options = {}) {
  const states = [], refs = [], effects = [], pendingEffects = [], timers = new Map(), listeners = new Set();
  const state = { role: 'admin', saved: null, result: { status: 'uncertain', message: 'Resultado inconclusivo.' },
    submits: [], recoveries: [], removed: [], redirects: [], events: [], ...options };
  let cursor = 0, refCursor = 0, effectCursor = 0, timerId = 0;
  const store = { read: async () => { if (state.storageFailure) throw Error('disk'); return state.saved; },
    list: async () => { if (state.storageFailure) throw Error('disk'); return state.saved ? [state.saved] : []; },
    async remove(saved) { if (state.removeFailure) throw Error('disk'); state.removed.push(saved); state.saved = null; } };
  const client = { auth: { onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } }; } } };
  const api = {
    DELETION_UNCERTAIN: 'Resultado inconclusivo. A ausência de recibo não confirma que a banda existe.',
    async loadBandDeletionAccess() { return { actorId: A, verify: async () => {}, scoped: { from(table) {
      return { select() { return this; }, eq() { return this; }, async maybeSingle() {
        return { data: table === 'bands' ? { name: attempt().confirmation } : state.role ? { role: state.role } : null, error: null };
      } };
    } } }; },
    async recoverBandDeletion(_client, saved, signal) {
      state.recoveries.push(saved); if (state.recoveryWait) await state.recoveryWait;
      if (signal.aborted) throw Error('aborted');
      return state.recoveryResult ?? { status: 'uncertain', message: 'Resultado inconclusivo.' };
    },
    async submitBandDeletion(_client, _store, actor, band, value, expected, signal) {
      state.submits.push({ actor, band, value, expected }); state.saved ??= attempt();
      if (state.wait) await state.wait;
      if (signal.aborted || state.throwSubmit) throw Error('lost');
      return { attempt: state.saved, result: state.result };
    },
  };
  const exports = load('src/components/band-deletion-panel.tsx', {
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial;
        return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
      useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
      useEffect(fn, deps) {
        const i = effectCursor++, old = effects[i];
        if (!old || deps.some((v, n) => v !== old.deps[n])) pendingEffects.push(() => {
          old?.cleanup?.(); effects[i] = { deps, cleanup: fn() };
        });
      },
    },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => { if (state.configFailure) throw Error('private diagnostic'); return client; } },
    '@/lib/band-deletion-attempts': { browserBandDeletionAttempts: () => store },
    '@/lib/band-deletion': api,
  }, { window: { dispatchEvent: e => state.events.push(e.type), location: { replace: url => state.redirects.push(url) } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
  const render = () => {
    cursor = refCursor = effectCursor = 0;
    const tree = options.hub ? exports.BandDeletionRecovery() : exports.default({ bandId: B, recoveryOnly: !!options.recoveryOnly });
    while (pendingEffects.length) pendingEffects.shift()();
    return nodes(tree);
  };
  const changeIdentity = (id) => { listeners.forEach(fn => fn(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null)); };
  t.after(() => effects.forEach(e => e?.cleanup?.()));
  render();
  return { state, render, changeIdentity, timers,
    expand() { render().find(n => n.type === 'button' && n.props['aria-expanded'] === false)?.props.onClick(); render(); },
    type(value) { render().find(n => n.type === 'input').props.onChange({ target: { value } }); },
    submit() { render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); },
    query() { render().find(n => n.type === 'button' && ['Consultar resultado', 'Concluir'].includes(n.props.children)).props.onClick(); } };
}
test('member and non-member do not see any deletion action', async t => {
  for (const role of ['member', null]) { const f = uiFixture(t, { role }); await settle(); assert.equal(f.render().length, 0); }
});
test('administrator sees the irreversible warning, exact confirmation and accessible form', async t => {
  const f = uiFixture(t); await settle(); f.expand();
  let tree = f.render(); assert.ok(tree.some(n => n.type === 'label' && n.props.htmlFor));
  assert.ok(tree.some(n => n.type === 'input' && n.props['aria-describedby']));
  const text = JSON.stringify(tree); assert.match(text, /permanente/); assert.match(text, /outros administradores/);
  for (const value of ['', 'Aurora é', 'aurora é  ']) {
    f.type(value); tree = f.render(); assert.equal(tree.find(n => n.props?.type === 'submit').props.disabled, true);
    f.submit(); await settle(); assert.equal(f.state.submits.length, 0);
  }
  f.type(attempt().confirmation); assert.equal(f.render().find(n => n.props?.type === 'submit').props.disabled, false);
});
test('successful deletion clears the attempt, updates navigation and reloads personal dashboard', async t => {
  const f = uiFixture(t, { result: { status: 'deleted' } }); await settle(); f.expand(); f.type(attempt().confirmation); f.submit(); await settle();
  assert.equal(f.state.removed.length, 1); assert.deepEqual(f.state.redirects, ['/dashboard']);
  assert.deepEqual(f.state.events, ['bandup:band-profile-updated']); assert.equal(f.state.saved, null);
});
test('cancel before submission discards typed confirmation and never starts an operation', async t => {
  const f = uiFixture(t); await settle(); f.expand(); f.type(attempt().confirmation);
  f.render().find(n => n.type === 'button' && n.props.children === 'Cancelar').props.onClick();
  assert.equal(f.render().some(n => n.type === 'input'), false);
  assert.equal(f.state.submits.length, 0); assert.equal(f.state.saved, null);
  f.expand(); assert.equal(f.render().find(n => n.type === 'input').props.value, '');
});
test('same-tick duplicate submits are blocked and all mutation controls are disabled in flight', async t => {
  let resolve; const f = uiFixture(t, { wait: new Promise(r => { resolve = r; }) });
  await settle(); f.expand(); f.type(attempt().confirmation); f.submit(); f.submit(); await settle();
  assert.equal(f.state.submits.length, 1); assert.equal(f.render().find(n => n.props?.type === 'submit').props.disabled, true);
  resolve(); await settle(); assert.equal(f.state.redirects.length, 0); assert.equal(f.state.saved.operationId, O);
  f.submit(); await settle(); assert.equal(f.state.submits.length, 2);
});
test('reload recovers a pending receipt without deletion or current membership', async t => {
  const f = uiFixture(t, { role: null, saved: attempt(), recoveryResult: { status: 'deleted' } }); await settle();
  assert.equal(f.state.submits.length, 0); assert.equal(f.state.recoveries.length, 1);
  assert.deepEqual(f.state.redirects, ['/dashboard']);
});
test('NULL recovery keeps operation, offers read-only query and never infers a live band', async t => {
  const f = uiFixture(t, { saved: attempt() }); await settle();
  assert.equal(f.state.redirects.length, 0); assert.equal(f.state.removed.length, 0);
  assert.equal(f.render().find(n => n.props?.type === 'submit').props.disabled, true);
  f.query(); await settle(); assert.equal(f.state.recoveries.length, 2); assert.equal(f.state.submits.length, 0);
  assert.equal(f.state.saved.operationId, O);
});
test('dashboard recovery never renders mutation form, even for an administrator', async t => {
  const f = uiFixture(t, { recoveryOnly: true, saved: attempt() }); await settle();
  assert.equal(f.render().some(n => n.type === 'form' || n.type === 'input'), false);
  f.query(); await settle(); assert.equal(f.state.submits.length, 0);
});
test('lost/timeout response gets one bounded receipt recovery, without automatic mutation retry', async t => {
  const f = uiFixture(t, { throwSubmit: true, recoveryResult: { status: 'deleted' } });
  await settle(); f.expand(); f.type(attempt().confirmation); f.submit(); await settle();
  assert.equal(f.state.submits.length, 1); assert.equal(f.state.recoveries.length, 1); assert.deepEqual(f.state.redirects, ['/dashboard']);
});
test('mutation deadline aborts the old request and recovery uses a fresh non-aborted signal', async t => {
  let resolve; const f = uiFixture(t, { wait: new Promise(r => { resolve = r; }), recoveryResult: { status: 'deleted' } });
  await settle(); f.expand(); f.type(attempt().confirmation); f.submit(); await settle();
  const deadline = [...f.timers.values()].find(timer => timer.delay === 25000); assert.ok(deadline);
  deadline.fn(); await settle();
  assert.equal(f.state.submits.length, 1); assert.equal(f.state.recoveries.length, 1);
  assert.deepEqual(f.state.redirects, ['/dashboard']);
  resolve(); await settle(); assert.equal(f.state.redirects.length, 1);
});
test('account switch hides pending data and ignores previous in-flight success', async t => {
  let resolve; const f = uiFixture(t, { wait: new Promise(r => { resolve = r; }), result: { status: 'deleted' } });
  await settle(); f.expand(); f.type(attempt().confirmation); f.submit(); await settle();
  f.changeIdentity(OTHER); resolve(); await settle(); assert.equal(f.render().length, 0);
  assert.equal(f.state.removed.length, 0); assert.equal(f.state.redirects.length, 0); assert.equal(f.state.saved.operationId, O);
});
test('confirmed success with failed local cleanup cannot send another deletion', async t => {
  const f = uiFixture(t, { removeFailure: true, result: { status: 'deleted' } });
  await settle(); f.expand(); f.type(attempt().confirmation); f.submit(); await settle();
  assert.equal(f.state.redirects.length, 0); assert.equal(f.render().some(n => n.type === 'form'), false);
  assert.match(JSON.stringify(f.render()), /Exclusão confirmada/);
  f.state.removeFailure = false; f.query(); await settle();
  assert.equal(f.state.submits.length, 1); assert.deepEqual(f.state.redirects, ['/dashboard']);
});
test('dashboard discovery survives INITIAL_SESSION and token refresh but hides on account change', async t => {
  const f = uiFixture(t, { hub: true, saved: attempt() }); f.changeIdentity(A); await settle();
  assert.ok(f.render().some(n => n.props?.bandId === B && n.props.recoveryOnly));
  f.changeIdentity(A); await settle(); assert.ok(f.render().some(n => n.props?.bandId === B));
  f.changeIdentity(OTHER); await settle(); assert.equal(f.render().some(n => n.props?.bandId), false);
});
test('dashboard recovery handles unavailable configuration/storage with a safe retry and no mutation', async t => {
  for (const option of ['configFailure', 'storageFailure']) {
    const f = uiFixture(t, { hub: true, saved: attempt(), [option]: true }); await settle();
    assert.ok(f.render().some(n => n.props?.role === 'alert'));
    assert.doesNotMatch(JSON.stringify(f.render()), /private diagnostic/);
    f.state[option] = false;
    f.render().find(n => n.type === 'button').props.onClick(); f.render(); await settle();
    assert.ok(f.render().some(n => n.props?.bandId === B)); assert.equal(f.state.submits.length, 0);
  }
});

test('integration uses settings independently of publication and dashboard recovery only', () => {
  const settings = fs.readFileSync('src/app/bandas/[bandId]/perfil-publico/page.tsx', 'utf8');
  const dashboard = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');
  assert.match(settings, /<BandDeletionPanel key=\{bandId\} bandId=\{bandId\}/);
  assert.match(dashboard, /<BandDeletionRecovery \/>/);
  for (const file of ['src/lib/band-deletion.ts', 'src/lib/band-deletion-attempts.ts', 'src/components/band-deletion-panel.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /SERVICE_ROLE|service_role|storage\.from|from\("bands"\)\.delete/);
  }
});
