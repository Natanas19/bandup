/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function load(file, overrides, enabled = true, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, AbortController,
    process: { env: enabled ? { NEXT_PUBLIC_BANDUP_MUSICIAN_AVAILABILITY_ENABLED: 'true' } : {} },
    ...globals, require(name) { return name in overrides ? overrides[name] : require(name); },
  });
  return mod.exports;
}
function fixture(options = {}) {
  const state = { identity: 'a', row: null, queries: [], bindings: 0, ...options };
  const scoped = { from(table) {
    assert.equal(table, 'musician_availability');
    const q = { table, filters: [] }; state.queries.push(q);
    return {
      select(fields) { q.select = fields; return this; },
      eq(...args) { q.filters.push(args); return this; },
      insert(value) { q.insert = value; return this; },
      update(value) { q.update = value; return this; },
      async maybeSingle() { return { data: state.row, error: state.readError }; },
      then(resolve, reject) {
        const write = async () => {
          if (!state.denied) state.row = { available: (q.insert ?? q.update).available };
          state.onWrite?.();
          if (state.lostReply) throw Error('Lost response');
          return { error: state.denied ? { code: '42501' } : null };
        };
        return write().then(resolve, reject);
      },
    };
  } };
  const api = load('src/lib/musician-availability.ts', { './band-logo-upload': {
    async bandPhotoSession(_client, userId, signal) {
      state.bindings++;
      const verify = async () => { if (state.identity !== userId || signal.aborted) throw Error('Session changed'); };
      await verify(); return { scoped, verify };
    },
  } }, options.enabled !== false);
  return { state, api,
    read: () => api.loadMusicianAvailability({}, 'a', new AbortController().signal),
    save: value => api.saveMusicianAvailability({}, 'a', value, new AbortController().signal),
  };
}

test('feature defaults off and rejects service calls before any session or database access', async () => {
  const f = fixture({ enabled: false });
  assert.equal(f.api.MUSICIAN_AVAILABILITY_ENABLED, false);
  await assert.rejects(f.read()); await assert.rejects(f.save(true));
  assert.equal(f.state.bindings, 0); assert.equal(f.state.queries.length, 0);
});
test('own read interprets no record as false and validates stored booleans', async () => {
  const f = fixture();
  assert.equal(await f.read(), false);
  f.state.row = { available: true }; assert.equal(await f.read(), true);
  for (const q of f.state.queries) {
    assert.equal(q.select, 'available'); assert.deepEqual(q.filters, [['user_id', 'a']]);
  }
  f.state.row = { available: 'false' }; await assert.rejects(f.read());
  f.state.readError = { code: '42P01' }; await assert.rejects(f.read());
});
test('first enable INSERTs own identity, while disable UPDATEs only available without upsert', async () => {
  const f = fixture();
  assert.equal(await f.save(false), false);
  assert.equal(f.state.queries.some(q => q.insert || q.update), false);
  assert.equal(await f.save(true), true); assert.equal(await f.save(false), false);
  const writes = f.state.queries.filter(q => q.insert || q.update);
  assert.deepEqual(JSON.parse(JSON.stringify(writes.map(q => q.insert ?? q.update))), [
    { user_id: 'a', available: true }, { available: false },
  ]);
  assert.deepEqual(writes[1].filters, [['user_id', 'a']]);
});
test('lost write reply is reconciled once; refused writes cannot report success or auto-retry', async () => {
  const lost = fixture({ lostReply: true }); assert.equal(await lost.save(true), true);
  assert.equal(lost.state.queries.filter(q => q.insert).length, 1);
  const denied = fixture({ denied: true }); await assert.rejects(denied.save(true));
  assert.equal(denied.state.queries.filter(q => q.insert).length, 1);
});
test('wrong account, abort and account switch cannot confirm a write or target another user', async () => {
  const wrong = fixture({ identity: 'b' }); await assert.rejects(wrong.save(true));
  assert.equal(wrong.state.queries.length, 0);
  const aborted = fixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(aborted.api.loadMusicianAvailability({}, 'a', controller.signal));
  assert.equal(aborted.state.bindings, 0);
  const changed = fixture(); changed.state.onWrite = () => { changed.state.identity = 'b'; };
  await assert.rejects(changed.save(true));
  assert.equal(changed.state.queries.find(q => q.insert).insert.user_id, 'a');
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function ui(options = {}) {
  const slots = [], effects = [], scheduled = [];
  let cursor = 0, listener, reads = 0, writes = 0, clientCalls = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((d,j) => d !== old.deps[j])) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((d,j) => d !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  const Component = load('src/components/musician-availability.tsx', {
    react: hooks,
    '@/lib/supabase/client': { getSupabaseBrowserClient() { clientCalls++; return { auth: {
      onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    } }; } },
    '@/lib/musician-availability': {
      MUSICIAN_AVAILABILITY_ENABLED: options.enabled !== false,
      async loadMusicianAvailability() { reads++; return options.read ? options.read() : false; },
      async saveMusicianAvailability(_client, id, value, signal) {
        assert.equal(id, 'a'); writes++; return options.save ? options.save(value, signal) : value;
      },
    },
  }, true, { window: { setTimeout, clearTimeout } }).default;
  return {
    render() { cursor = 0; const tree = nodes(Component({ userId: 'a' })); while (scheduled.length) scheduled.shift()(); return tree; },
    changeIdentity() { listener('SIGNED_IN', { user: { id: 'b' } }); },
    dispose() { effects.forEach(e => e?.cleanup?.()); },
    counts: () => ({ reads, writes, clientCalls }),
  };
}
test('disabled card shows an off accessible switch and never initializes the SDK', async () => {
  const h = ui({ enabled: false }); const tree = h.render(); await settle();
  const control = tree.find(n => n.props?.role === 'switch');
  assert.equal(control.props.checked, false); assert.equal(control.props.disabled, true);
  assert.ok(tree.some(n => n.type === 'label'));
  assert.deepEqual(h.counts(), { reads: 0, writes: 0, clientCalls: 0 }); h.dispose();
});
test('card loads independently, saves once on duplicate input, and confirms only after persistence', async () => {
  let finish;
  const h = ui({ save: value => new Promise(resolve => { finish = () => resolve(value); }) });
  assert.equal(h.render().find(n => n.props?.role === 'switch').props.disabled, true);
  await settle(); let tree = h.render();
  const control = tree.find(n => n.props?.role === 'switch');
  assert.equal(control.props.checked, false); assert.equal(control.props.disabled, false);
  control.props.onChange({ target: { checked: true } }); control.props.onChange({ target: { checked: true } });
  await settle(); tree = h.render();
  assert.equal(h.counts().writes, 1);
  assert.equal(tree.find(n => n.props?.role === 'switch').props.checked, false);
  assert.equal(tree.find(n => n.props?.role === 'switch').props.disabled, true);
  finish(); await settle(); tree = h.render();
  assert.equal(tree.find(n => n.props?.role === 'switch').props.checked, true);
  assert.ok(tree.some(n => n.props?.role === 'status' && n.props.children === 'Disponibilidade ativada.')); h.dispose();
});
test('missing table fails only the card; retry reads again instead of issuing a write', async () => {
  let fail = true;
  const h = ui({ read: async () => { if (fail) throw Error('private database diagnostic'); return false; } });
  h.render(); await settle(); let tree = h.render();
  assert.ok(tree.some(n => n.props?.role === 'alert'));
  assert.equal(JSON.stringify(tree).includes('private database diagnostic'), false);
  assert.equal(tree.find(n => n.props?.role === 'switch').props.disabled, true);
  fail = false; tree.find(n => n.type === 'button').props.onClick(); await settle(); tree = h.render();
  assert.equal(h.counts().reads, 2); assert.equal(h.counts().writes, 0);
  assert.equal(tree.find(n => n.props?.role === 'switch').props.disabled, false); h.dispose();
});
test('uncertain save requires read-only recovery; late results after an account switch stay hidden', async () => {
  const h = ui({ save: async () => { throw Error('Lost reply'); } });
  h.render(); await settle(); h.render().find(n => n.props?.role === 'switch').props.onChange({ target: { checked: true } });
  await settle(); let tree = h.render(); assert.ok(tree.some(n => n.props?.role === 'alert'));
  tree.find(n => n.type === 'button').props.onClick(); await settle(); h.render();
  assert.equal(h.counts().writes, 1); assert.equal(h.counts().reads, 2); h.dispose();
  let finish;
  const changed = ui({ save: () => new Promise(resolve => { finish = resolve; }) });
  changed.render(); await settle(); changed.render().find(n => n.props?.role === 'switch').props.onChange({ target: { checked: true } });
  await settle(); changed.changeIdentity(); finish(true); await settle(); tree = changed.render();
  assert.equal(tree.find(n => n.props?.role === 'switch').props.checked, false);
  assert.equal(tree.find(n => n.props?.role === 'switch').props.disabled, true);
  assert.equal(tree.some(n => n.props?.children === 'Disponibilidade ativada.'), false); changed.dispose();
});
