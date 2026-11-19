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
      getSession: async () => ({ data: { session: options.signedOut ? null : { user: { id: 'self' }, access_token: 'fixture-token' } }, error: null }),
      getUser: async () => { assert.equal(inCallback, false); return { data: { user: state.userId ? { id: state.userId } : null }, error: null }; },
      onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { callback = null; } } } }; },
    },
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const result = single => ({ error: null, data: table === 'bands' ? { name: 'Banda' }
        : table === 'band_members' ? single ? options.nonMember ? null : { role: options.role ?? 'admin' }
          : [{ user_id: 'self' }, { user_id: 'other' }]
          : table === 'tasks' ? single ? options.task ?? task : [options.task ?? task] : [] });
      return {
        select(columns) { call.columns = columns; return this; }, eq(...args) { call.filters.push(args); return this; },
        order() { return this; }, maybeSingle: async () => result(true),
        limit: async () => ({ error: options.probeError ?? (options.v2 ? null : { code: '42703', message: 'column tasks.task_revision does not exist' }) }),
        range: async () => result(false),
        setHeader() { return this; },
        then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); },
      };
    },
    rpc(name, args) {
      assert.equal(inCallback, false);
      const call = { rpc: name, args };
      calls.push(call);
      if (name === 'bandup_save_task_v2') return {
        setHeader(key, value) { call.header = [key, value]; return this; },
        retry(enabled) { call.retry = enabled; return options.save?.(args) ?? { error: { code: '40001' } }; },
      };
      assert.equal(name, "bandup_member_display_names");
      return state.rpc();
    },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, Date, Intl,
      process: { env: { NEXT_PUBLIC_BANDUP_MULTI_ASSIGNEES_ENABLED: options.enabled ? 'true' : '' } },
      crypto: { randomUUID: () => '10000000-0000-4000-8000-000000000001' },
      window: { scrollTo() {}, setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
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
        if (name === '@/components/notification-target') return { useNotificationTarget: () => null, NotificationTargetStatus: () => null };
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
    cursor = effectCursor = refCursor = 0;
    const boundary = Component();
    const child = boundary.props.children;
    const tree = child.type(child.props);
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
  const f = fixture({ enabled: true }); await f.settle();
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

test('V2 writes through the RPC with the edit revision and keeps multiple links when selection is off', async () => {
  const existing = { ...task, task_revision: 4, assigned_to: null,
    task_assignees: [{ user_id: 'self' }, { user_id: 'other' }] };
  const f = fixture({ v2: true, task: existing, save(args) {
    existing.task_revision = 5;
    return { data: { id: args.p_task_id, revision: 5, status: 'saved' } };
  } });
  await f.settle();
  assert.ok(f.render().some(node => node.type === 'span' && node.props.children === 'Ana, 👩‍🎤'));
  f.render().find(node => node.type === 'button' && node.props.children === 'Editar').props.onClick();
  assert.equal(f.render().some(node => node.props.type === 'checkbox'), false);
  await f.render().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  const call = f.calls.find(call => call.rpc === 'bandup_save_task_v2');
  assert.equal(call.args.p_expected_revision, 4);
  assert.equal(call.args.p_task_id, existing.id);
  assert.equal(call.args.p_assignee_ids, null);
  assert.equal(call.args.p_event_id, null);
  assert.deepEqual(call.header, ['Authorization', 'Bearer fixture-token']);
  assert.equal(call.retry, false);
  assert.ok(f.render().some(node => node.props.role === 'status' && node.props.children === 'Tarefa atualizada com sucesso.'));
  f.cleanup();
});

test('V2 new task keeps its UUID on retry and sends an empty selection without scalar writes', async () => {
  const f = fixture({ v2: true, task: { ...task, task_revision: 0, task_assignees: [] } });
  await f.settle();
  f.slots[6] = true;
  f.render().find(node => node.props.id === 'task-title').props.onChange({ target: { value: 'Nova tarefa' } });
  for (let attempt = 0; attempt < 2; attempt++) {
    await f.render().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  }
  const writes = f.calls.filter(call => call.rpc === 'bandup_save_task_v2');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].args.p_task_id, writes[1].args.p_task_id);
  assert.equal(writes[0].args.p_expected_revision, null);
  assert.deepEqual(Array.from(writes[0].args.p_assignee_ids), []);
  assert.equal(writes[0].args.p_title, 'Nova tarefa');
  f.cleanup();
});

test('V2 selection snapshots all members and supports removing an assignee', async () => {
  const f = fixture({ v2: true, enabled: true, task: { ...task, task_revision: 0, task_assignees: [] } });
  await f.settle();
  f.render().find(node => node.type === 'button' && node.props.children === 'Editar').props.onClick();
  f.render().find(node => node.type === 'button' && node.props.children === 'Selecionar todos').props.onClick();
  const selected = f.render().filter(node => node.props.type === 'checkbox');
  assert.equal(selected.filter(node => node.props.checked).length, 2);
  selected[0].props.onChange({ target: { checked: false } });
  const taskReadsBeforeSave = f.calls.filter(call => call.table === 'tasks').length;
  await f.render().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  const writes = f.calls.filter(call => call.rpc === 'bandup_save_task_v2');
  assert.equal(writes.length, 1);
  assert.deepEqual(Array.from(writes[0].args.p_assignee_ids), ['other']);
  assert.equal(f.calls.filter(call => call.table === 'tasks').length, taskReadsBeforeSave,
    'an RPC rejection does not attempt the legacy task-table path');
  assert.ok(f.render().some(node => node.props.role === 'alert'));
  f.cleanup();
});

test('the default flag on the legacy database keeps only the single-assignee input', async () => {
  const f = fixture();
  await f.settle();
  f.slots[6] = true;
  const tree = f.render();
  assert.ok(tree.some(node => node.props.id === 'task-assignee'));
  assert.equal(tree.some(node => node.props.type === 'checkbox'), false);
  assert.equal(f.calls.some(call => call.rpc === 'bandup_save_task_v2'), false);
  f.cleanup();
});

test('permission errors on the V2 probe fail closed instead of using legacy writes', async () => {
  const f = fixture({ probeError: { code: '42501', message: 'denied' } });
  await f.settle();
  assert.equal(f.slots[0], 'error');
  assert.equal(f.calls.filter(call => call.table === 'tasks').length, 1);
  f.cleanup();
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
