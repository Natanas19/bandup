/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');

const Flow = () => null, Settings = () => null, Search = () => null;
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function fixture({ role = 'admin', enabled = true, signedIn = true } = {}) {
  const state = { role, signedIn, members: [{ user_id: 'user', role }], reads: [] };
  const slots = [], effects = [], scheduled = []; let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect(fn, deps) {
      const i = cursor++, old = effects[i];
      if (!old || deps.some((value, j) => value !== old.deps[j])) {
        scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const client = { auth: { getSession: async () => ({ data: { session: state.signedIn ? { user: { id: 'user' } } : null }, error: null }) },
    from(table) {
      const q = { table, filters: [] }; state.reads.push(q);
      return {
        select(fields) { q.fields = fields; return this; },
        eq(...args) { q.filters.push(args); return this; },
        maybeSingle: async () => ({ data: table === 'bands' ? { name: 'Band A' } : { user_id: 'user', role: state.role }, error: null }),
        order: async () => ({ data: state.members, error: null }),
      };
    },
  };
  function load(file) {
    const mod = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, require(name) {
      if (name === 'react') return hooks;
      if (name === 'next/navigation') return { useParams: () => ({ bandId: 'band-a' }) };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
      if (name === '@/lib/band-entry') return { BAND_ENTRY_BACKEND_VALIDATED: enabled };
      if (name === '@/components/band-entry-flow') return { __esModule: true, default: Flow };
      if (name === '@/components/band-discovery-settings') return { __esModule: true, default: Settings };
      if (name === '@/components/band-search') return { __esModule: true, default: Search };
      if (name === '@/components/band-workspace') return { BandWorkspaceInfo: () => null };
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null };
      return require(name);
    } });
    return mod.exports.default;
  }
  function mount(file) {
    const Component = load(file);
    const render = () => {
      cursor = 0;
      const tree = Component();
      while (scheduled.length) scheduled.shift()();
      return tree;
    };
    return { render, dispose() { effects.forEach(e => e?.cleanup?.()); } };
  }
  return { state, mount };
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

for (const role of ['admin', 'member']) for (const enabled of [true, false]) {
  test(`member page admin panels: role=${role}, local gate=${enabled}`, async () => {
    const f = fixture({ role, enabled });
    const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
    h.render(); await settle();
    const tree = nodes(h.render());
    const expected = role === 'admin' && enabled;
    assert.equal(tree.some(n => n.type === Flow), expected);
    assert.equal(tree.some(n => n.type === Settings), false);
    assert.ok(tree.some(n => n.props?.['aria-label'] === 'Lista de integrantes'));
    for (const q of f.state.reads.filter(q => q.table === 'band_members')) {
      assert.ok(q.filters.some(([key, value]) => key === 'band_id' && value === 'band-a'));
    }
    if (expected) {
      assert.equal(tree.find(n => n.type === Flow).props.bandId, 'band-a');
    }
    h.dispose();
  });
}

test('approval callback reloads real member list without unmounting panels; role loss hides panels', async () => {
  const f = fixture(), h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  let tree = nodes(h.render());
  const panel = tree.find(n => n.type === Flow);
  f.state.members.push({ user_id: 'new-member', role: 'member' });
  panel.props.onMembersChanged();
  assert.ok(nodes(h.render()).some(n => n.type === Flow), 'keep panel mounted during member refresh');
  await settle(); tree = nodes(h.render());
  const list = tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  assert.equal(nodes(list).filter(n => n.type === 'article').length, 2);
  f.state.role = 'member';
  tree.find(n => n.type === Flow).props.onMembersChanged();
  h.render(); await settle(); tree = nodes(h.render());
  assert.equal(tree.some(n => n.type === Flow || n.type === Settings), false);
  h.dispose();
});

test('signed-out members page never loads band data or mounts admin panels', async () => {
  const f = fixture({ signedIn: false }), h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  assert.equal(f.state.reads.length, 0);
  assert.equal(nodes(h.render()).some(n => n.type === Flow || n.type === Settings), false);
  h.dispose();
});

test('request completion refreshes history while preserving the search component', () => {
  const h = fixture().mount('src/components/band-discovery.tsx');
  let tree = nodes(h.render());
  const search = tree.find(n => n.type === Search), oldHistory = tree.find(n => n.type === Flow);
  search.props.onRequestsChanged(); tree = nodes(h.render());
  assert.notEqual(tree.find(n => n.type === Flow).key, oldHistory.key);
  assert.equal(tree.find(n => n.type === Search).type, search.type);
  h.dispose();
});
