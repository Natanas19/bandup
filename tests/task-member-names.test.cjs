/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { test } = require('node:test');
const task = { id: 'task', title: 'Ensaio', description: null, status: 'todo', priority: 'medium',
  due_date: null, assigned_to: 'other', created_by: 'self', event_id: null, created_at: '2026-01-01T12:00:00Z' };
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function fixture(options = {}) {
  const slots = [], effects = [], cache = new Map(), calls = [], timers = new Map(), refs = [];
  const focus = new Map(), visibility = new Map();
  let cursor = 0, effectCursor = 0, refCursor = 0, timerId = 0, callback, inCallback = false;
  const state = { userId: 'self', rpc: async () => ({ data: options.names ?? [
    { user_id: 'other', display_name: '👩‍🎤' }, { user_id: 'self', display_name: 'Ana' },
    { user_id: 'outside', display_name: 'Must not render' },
  ], error: options.rpcError }) };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: options.signedOut ? null : { user: { id: 'self' } } }, error: null }),
      getUser: async () => { assert.equal(inCallback, false); return { data: { user: state.userId ? { id: state.userId } : null }, error: null }; },
      onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { callback = null; } } } }; },
    },
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const result = single => ({ error: null, data: table === 'bands' ? { name: 'Banda' }
        : table === 'band_members' ? single ? options.nonMember ? null : { role: 'admin' }
          : [{ user_id: 'self' }, { user_id: 'other' }]
          : table === 'tasks' ? [task] : [] });
      return {
        select(columns) { call.columns = columns; return this; }, eq(...args) { call.filters.push(args); return this; },
        order() { return this; }, maybeSingle: async () => result(true),
        then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
      };
    },
    rpc(name, args) { assert.equal(name, "bandup_member_display_names"); assert.equal(inCallback, false); calls.push({ rpc: name, args }); return state.rpc(); },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, Date, Intl,
      window: { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
        addEventListener: (name, fn) => focus.set(name, fn), removeEventListener: name => focus.delete(name) },
      document: { visibilityState: 'visible', addEventListener: (name, fn) => visibility.set(name, fn), removeEventListener: name => visibility.delete(name) },
      require(name) {
        if (name === 'react') return { ...React,
          useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
            return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
          useEffect(fn, deps) { const i = effectCursor++, old = effects[i];
            if (!old || deps.some((dep, index) => dep !== old.deps[index])) effects[i] = { deps, fn, pending: true, cleanup: old?.cleanup }; },
          useRef(initial) { const i = refCursor++; return refs[i] ??= { current: initial }; },
        };
        if (name === 'next/navigation') return { useParams: () => ({ bandId: 'band-a' }) };
        if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
        if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null, BandWorkspaceInfo: () => null };
        if (name.startsWith('@/lib/')) return load('src/' + name.slice(2) + '.ts');
        return require(name);
      },
    });
    return mod.exports;
  }
  const Component = load('src/app/bandas/[bandId]/tarefas/page.tsx').default;
  const render = () => {
    cursor = effectCursor = refCursor = 0; const tree = Component();
    for (const effect of effects) if (effect.pending) { effect.cleanup?.(); effect.pending = false; effect.cleanup = effect.fn(); }
    return nodes(tree);
  };
  render();
  return { state, calls, slots, render,
    async settle() { for (let i = 0; i < 10; i++) { await new Promise(setImmediate); const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); render(); } },
    emit(event, id) { inCallback = true; try { callback?.(event, id ? { user: { id } } : null); } finally { inCallback = false; } },
    focus() { focus.get('focus')?.(); },
    cleanup() { effects.forEach(effect => effect.cleanup?.()); },
  };
}
test('task options and task details use RPC names joined by UUID, retaining a single assignment', async () => {
  const f = fixture(); await f.settle();
  f.slots[6] = true;
  const tree = f.render();
  const options = tree.filter(n => n.type === 'option');
  assert.equal(options.find(n => n.props.value === 'self').props.children, 'Ana');
  assert.equal(options.find(n => n.props.value === 'other').props.children, '👩‍🎤');
  assert.equal(options.some(n => n.props.value === 'outside'), false);
  assert.ok(tree.some(n => n.type === 'span' && n.props.children === '👩‍🎤'));
  const select = tree.find(n => n.props?.id === 'task-assignee');
  assert.match(select.props.className, /min-w-0 max-w-full/);
  assert.ok(tree.some(n => n.type === 'p' && n.props.className?.includes('overflow-wrap:anywhere')));
  assert.equal(select.props.multiple, undefined);
  assert.equal(tree.some(n => n.type === "input" && n.props.type === "checkbox"), false);
  select.props.onChange({ target: { value: 'other' } }); assert.equal(f.slots[19], 'other');
  const rpc = f.calls.find(c => c.rpc);
  assert.equal(rpc.rpc, 'bandup_member_display_names'); assert.equal(rpc.args.p_band_id, 'band-a');
  assert.ok(f.calls.findIndex(c => c.table === 'band_members') < f.calls.indexOf(rpc)); f.cleanup();
});
test('missing, invalid or denied names fall back without preventing authorized task loading', async () => {
  for (const config of [{ rpcError: { code: '42501' } }, { names: [{ user_id: 'other', email: 'private@example.com' }] },
    { names: [{ user_id: 'other', display_name: '<script>' }] }]) {
    const f = fixture(config); await f.settle();
    assert.equal(f.slots[0], 'ready');
    assert.equal(f.slots[5].find(member => member.userId === 'other').label, 'Integrante');
    assert.equal(JSON.stringify(f.render()).includes('private@example.com'), false); f.cleanup();
  }
});
test('no session or membership prevents name RPC calls', async () => {
  for (const options of [{ signedOut: true }, { nonMember: true }]) {
    const f = fixture(options); await f.settle(); assert.equal(f.calls.some(c => c.rpc), false); f.cleanup();
  }
});
test('focus and account metadata updates refresh names without reloading the task form', async () => {
  const f = fixture(); await f.settle(); f.slots[6] = true; f.slots[14] = 'Unsaved title';
  f.state.rpc = async () => ({ data: [{ user_id: 'other', display_name: 'Novo Nome' }], error: null });
  f.focus(); await f.settle();
  assert.equal(f.slots[5].find(member => member.userId === 'other').label, 'Novo Nome');
  assert.equal(f.slots[14], 'Unsaved title'); assert.equal(f.slots[6], true);
  f.state.rpc = async () => ({ data: [{ user_id: 'other', display_name: 'Outro Nome' }], error: null });
  f.emit('USER_UPDATED', 'self'); await f.settle();
  assert.equal(f.slots[5].find(member => member.userId === 'other').label, 'Outro Nome'); f.cleanup();
});
test('switching user or leaving discards late name responses', async () => {
  for (const mode of ['switch', 'unmount']) {
    const f = fixture(); await f.settle(); let finish;
    f.state.rpc = () => new Promise(resolve => { finish = resolve; });
    f.focus(); await f.settle();
    if (mode === 'switch') { f.state.userId = 'new-user'; f.emit('SIGNED_IN', 'new-user'); }
    else f.cleanup();
    const snapshot = JSON.stringify(f.slots[5]);
    finish({ data: [{ user_id: 'other', display_name: 'Stale Name' }], error: null });
    await new Promise(setImmediate);
    assert.equal(JSON.stringify(f.slots[5]), snapshot);
    if (mode === 'switch') { assert.ok(f.slots[5].every(member => member.label === 'Integrante')); f.cleanup(); }
  }
});
