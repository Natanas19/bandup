/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');

const Avatar = () => null;
const Flow = () => null, Settings = () => null, Search = () => null;
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function fixture({ role = 'admin', enabled = true, signedIn = true, nameError = null } = {}) {
  const state = { role, signedIn, members: [{ user_id: 'user', role }], reads: [],
    names: [{ user_id: 'user', display_name: 'Band Admin' }], otherBandMembers: [],
    bandId: 'band-a', avatars: new Map(), avatarLoad: null, avatarReads: [], deletions: [], confirmations: [], confirm: true, beforeDelete: null };
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
    rpc(name, args) { state.reads.push({ rpc: name, args }); return Promise.resolve({ data: state.names, error: nameError }); },
    from(table) {
      const q = { table, filters: [] }; state.reads.push(q);
      return {
        select(fields) { q.fields = fields; return this; },
        delete() { q.operation = 'delete'; return this; },
        eq(...args) { q.filters.push(args); return this; },
        maybeSingle: async () => {
          if (table === 'bands') return { data: { name: 'Band A' }, error: null };
          if (q.operation !== 'delete') return { data: { user_id: 'user', role: state.role }, error: null };
          state.beforeDelete?.(q);
          state.deletions.push(q);
          const bandId = q.filters.find(([key]) => key === 'band_id')?.[1];
          const userId = q.filters.find(([key]) => key === 'user_id')?.[1];
          const roleFilter = q.filters.find(([key]) => key === 'role')?.[1];
          const candidates = bandId === 'band-a' ? state.members : state.otherBandMembers;
          const index = candidates.findIndex(member => member.user_id === userId);
          if (state.role !== 'admin') return { data: null, error: { code: '42501' } };
          if (index < 0 || roleFilter !== 'member' || candidates[index].role !== 'member') return { data: null, error: null };
          const [removed] = candidates.splice(index, 1);
          return { data: { id: `membership-${removed.user_id}` }, error: null };
        },
        order: async () => ({ data: state.members, error: null }),
      };
    },
  };
  function load(file) {
    const mod = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, process: { env: {} }, window: {
      confirm(message) { state.confirmations.push(message); return state.confirm; },
    }, require(name) {
      if (name === 'react') return hooks;
      if (name === '@/lib/public-band-data') return { safeBandLogo: () => null };
      if (name === 'next/navigation') return { useParams: () => ({ bandId: state.bandId }) };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
      if (name === '@/lib/band-entry') return { BAND_ENTRY_BACKEND_VALIDATED: enabled };
      if (name === '@/components/profile-avatar') return { __esModule: true, default: Avatar };
      if (name === '@/lib/member-avatars') return { loadMemberAvatars: async (_client, band, ids) => {
        state.avatarReads.push({ band, ids });
        return state.avatarLoad ? state.avatarLoad(band, ids) : state.avatars;
      } };
      if (name === '@/lib/display-name') return { loadMemberNames: async (supabase, bandId, validated) => {
        if (!validated) return new Map();
        const { data, error } = await supabase.rpc('bandup_member_display_names', { p_band_id: bandId });
        if (error || !Array.isArray(data)) return new Map();
        return new Map(data.filter(row => typeof row.display_name === 'string')
          .map(row => [row.user_id, row.display_name]));
      } };
      if (name === '@/lib/record-permissions') return { recordWriteError: error => error?.code === '42501'
        ? 'Sem permissão para remover o integrante.' : 'Não foi possível remover este integrante.' };
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

test('member list prioritizes validated profile names and uses safe fallbacks without identifiers', async () => {
  const f = fixture();
  f.state.members = [
    { user_id: 'user', role: 'admin' },
    { user_id: 'member', role: 'member' },
    { user_id: 'missing', role: 'member' },
    { user_id: 'mail', role: 'member' },
  ];
  f.state.names = [
    { user_id: 'user', display_name: 'Nome do perfil' },
    { user_id: 'member', display_name: 'Nome de integrante' },
    { user_id: 'mail', email: 'private@example.com' },
    { user_id: 'outside', display_name: 'Nome fora da banda' },
  ];
  const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  const tree = nodes(h.render());
  const list = tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  const content = JSON.stringify(nodes(list).map(n => n.props?.children));
  assert.match(content, /Nome do perfil/);
  assert.match(content, /Nome de integrante/);
  assert.match(content, /Integrante 1/);
  assert.match(content, /Integrante 2/);
  assert.match(content, /Administrador/);
  assert.match(content, /Membro/);
  assert.doesNotMatch(content, /private@example\.com|Nome fora da banda|user_id|member_id/);
  assert.equal(f.state.reads.filter(read => read.rpc === 'bandup_member_display_names').length, 1);
  h.dispose();
});

test('member list remains usable with neutral names when the display-name RPC is unavailable', async () => {
  const f = fixture({ nameError: { code: '42883' } });
  f.state.members.push({ user_id: 'member', role: 'member' });
  // The RPC is optional at runtime until the migration is applied in an environment.
  const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  const tree = nodes(h.render());
  const list = tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  assert.ok(nodes(list).some(n => n.props?.children === 'Você'));
  assert.ok(nodes(list).some(n => n.props?.children === 'Integrante 1'));
  h.dispose();
});

test('only admins can remove ordinary members; confirmed success refreshes the list and count', async () => {
  const f = fixture();
  f.state.members.push(
    { user_id: 'member-a', role: 'member' },
    { user_id: 'admin-b', role: 'admin' },
  );
  f.state.names.push(
    { user_id: 'member-a', display_name: 'Integrante A' },
    { user_id: 'admin-b', display_name: 'Admin B' },
  );
  const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  let tree = nodes(h.render());
  const list = () => tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  const removeButtons = () => nodes(list()).filter(n => n.type === 'button' && n.props.children === 'Remover integrante');
  assert.equal(removeButtons().length, 1);
  assert.equal(removeButtons()[0].props['aria-label'], 'Remover Integrante A da banda');
  removeButtons()[0].props.onClick();
  await settle(); h.render(); await settle(); tree = nodes(h.render());
  assert.equal(f.state.members.some(member => member.user_id === 'member-a'), false);
  assert.equal(nodes(list()).filter(n => n.type === 'article').length, 2);
  assert.ok(tree.some(n => /2[\s\S]*integrantes/.test(JSON.stringify(n.props?.children))));
  assert.match(f.state.confirmations[0], /Integrante A.*perderá o acesso/);
  const deletion = f.state.deletions[0];
  assert.deepEqual(deletion.filters, [['band_id', 'band-a'], ['user_id', 'member-a'], ['role', 'member']]);
  h.dispose();
});

test('member role cannot invoke removal and cancelled confirmation performs no delete', async () => {
  const f = fixture({ role: 'member' });
  f.state.members.push({ user_id: 'member-a', role: 'member' });
  const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  let tree = nodes(h.render());
  let list = tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  assert.equal(nodes(list).some(n => n.type === 'button' && n.props.children === 'Remover integrante'), false);
  h.dispose();

  const cancelled = fixture();
  cancelled.state.confirm = false;
  cancelled.state.members.push({ user_id: 'member-a', role: 'member' });
  const cancelPage = cancelled.mount('src/app/bandas/[bandId]/membros/page.tsx');
  cancelPage.render(); await settle(); tree = nodes(cancelPage.render());
  list = tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  nodes(list).find(n => n.type === 'button' && n.props.children === 'Remover integrante').props.onClick();
  await settle();
  assert.equal(cancelled.state.deletions.length, 0);
  assert.equal(cancelled.state.members.some(member => member.user_id === 'member-a'), true);
  cancelPage.dispose();
});

test('a concurrent promotion to admin prevents deletion and refreshes the displayed role', async () => {
  const f = fixture();
  const target = { user_id: 'member-a', role: 'member' };
  f.state.members.push(target);
  f.state.names.push({ user_id: 'member-a', display_name: 'Integrante A' });
  f.state.beforeDelete = () => { target.role = 'admin'; };
  const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  let tree = nodes(h.render());
  let list = tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  nodes(list).find(n => n.type === 'button' && n.props.children === 'Remover integrante').props.onClick();
  await settle(); h.render(); await settle(); tree = nodes(h.render());
  list = tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  assert.equal(f.state.members.includes(target), true);
  assert.equal(nodes(list).some(n => n.type === 'button' && n.props.children === 'Remover integrante'
    && n.props['aria-label'] === 'Remover Integrante A da banda'), false);
  assert.ok(tree.some(n => n.props?.role === 'alert' && /papel mudou/.test(n.props.children)));
  h.dispose();
});

test('removal is scoped to the current band even when the same user is a member elsewhere', async () => {
  const f = fixture();
  f.state.members.push({ user_id: 'shared-user', role: 'member' });
  f.state.otherBandMembers.push({ user_id: 'shared-user', role: 'member' });
  f.state.names.push({ user_id: 'shared-user', display_name: 'Integrante compartilhado' });
  const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  const tree = nodes(h.render());
  const list = tree.find(n => n.props?.['aria-label'] === 'Lista de integrantes');
  nodes(list).find(n => n.type === 'button' && n.props.children === 'Remover integrante').props.onClick();
  await settle(); h.render(); await settle();
  assert.equal(f.state.members.some(member => member.user_id === 'shared-user'), false);
  assert.equal(f.state.otherBandMembers.some(member => member.user_id === 'shared-user'), true);
  assert.equal(f.state.deletions[0].filters.some(([key, value]) => key === 'band_id' && value === 'band-a'), true);
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


test('member avatars are mapped by user ID while names and admin removal remain available', async () => {
  const f = fixture();
  f.state.members.push({ user_id: 'other', role: 'member' });
  f.state.names.push({ user_id: 'other', display_name: 'Other Member' });
  f.state.avatars = new Map([['other', 'https://project.supabase.co/other.png'], ['user', 'https://project.supabase.co/user.png']]);
  const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  const tree = nodes(h.render());
  const avatars = tree.filter(n => n.type === Avatar && ['Band Admin','Other Member'].includes(n.props.name));
  assert.deepEqual(avatars.map(n => [n.props.name,n.props.imageUrl]), [
    ['Band Admin','https://project.supabase.co/user.png'],['Other Member','https://project.supabase.co/other.png']]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.avatarReads)), [{ band: 'band-a', ids: ['user','other'] }]);
  assert.ok(tree.some(n => n.type === 'button' && n.props.children === 'Remover integrante' && !n.props.disabled));
  h.dispose();
});

test('hanging photo reads keep members, initials and removal available; late band response is ignored', async () => {
  const f = fixture(); let resolveA;
  f.state.members.push({ user_id: 'other', role: 'member' });
  f.state.avatarLoad = band => band === 'band-a' ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(new Map());
  const h = f.mount('src/app/bandas/[bandId]/membros/page.tsx');
  h.render(); await settle();
  let tree = nodes(h.render());
  assert.ok(tree.some(n => n.type === Avatar && n.props.name === 'Band Admin' && n.props.imageUrl === null));
  assert.ok(tree.some(n => n.type === 'button' && n.props.children === 'Remover integrante' && !n.props.disabled));
  f.state.bandId = 'band-b'; h.render(); await settle(); h.render();
  resolveA(new Map([['user','https://project.supabase.co/stale.png']])); await settle();
  tree = nodes(h.render());
  assert.ok(tree.some(n => n.type === Avatar && n.props.name === 'Band Admin' && n.props.imageUrl === null));
  h.dispose();
});
