/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { test } = require('node:test');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
function harness(filename, extra = {}) {
  const slots = [], effects = [], pending = [], urls = []; let cursor = 0;
  const hooks = { ...React,
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(fn, deps) { const i = cursor++, old = effects[i];
      if (!old || deps.some((v, j) => v !== old.deps[j])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, AbortController, crypto: { randomUUID: () => 'attempt' },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' } },
    window: { setTimeout, clearTimeout },
    URL: { createObjectURL(file) { urls.push(['create', file.name]); return 'blob:' + file.name; }, revokeObjectURL(url) { urls.push(['revoke', url]); } },
    require(name) {
      if (name === 'react') return hooks;
      if (extra[name]) return extra[name];
      if (name === '@/lib/band-logo-upload') return { validateBandLogoFile: f => ['image/png', 'image/jpeg', 'image/webp'].includes(f.type) && f.size > 0 && f.size <= 2097152 ? null : 'invalid' };
      if (name === 'next/link' || name.startsWith('@/components/') || name === './profile-avatar') return { __esModule: true, default: () => null };
      return require(name);
    },
  });
  return { slots, urls, render(props) { cursor = 0; const tree = mod.exports.default(props); while (pending.length) pending.shift()(); return nodes(tree); },
    unmount() { effects.forEach(e => e?.cleanup?.()); } };
}

const photoUrl = 'https://project.supabase.co/storage/v1/object/public/band-logos/band/photo.png';
const longBandName = 'Banda'.repeat(50);
function photoPresentation() {
  function Avatar() { return null; }
  return {
    Avatar,
    modules: {
      '@/components/profile-avatar': { __esModule: true, default: Avatar },
      '@/lib/public-band-data': { safeBandLogo(value, origin) {
        assert.equal(origin, 'https://project.supabase.co');
        return value === photoUrl ? value : null;
      } },
    },
  };
}

test('personal bands render validated photos beside long names without per-band reads', async () => {
  const p = photoPresentation(); let reads = 0;
  const f = harness('src/app/dashboard/bandas/page.tsx', {
    ...p.modules,
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({}) },
    '@/lib/personal-profile': { async loadPersonalOverview() {
      reads++;
      return { bands: [photoUrl, null, 'https://untrusted.example/photo.png'].map((logo_url, i) => ({
        role: 'member', band: { id: String(i), name: longBandName, logo_url },
      })) };
    } },
  });
  f.render(); await settle();
  const tree = f.render();
  const avatars = tree.filter(n => n.type === p.Avatar);
  assert.deepEqual(avatars.map(n => n.props.imageUrl), [photoUrl, null, null]);
  assert.ok(avatars.every(n => n.props.name === longBandName));
  assert.ok(tree.some(n => n.type === 'span' && n.props.children === longBandName && n.props.className.includes('[overflow-wrap:anywhere]')));
  assert.ok(tree.some(n => n.props.href === '/bandas/0' && n.props.className.includes('sm:flex-row')));
  assert.equal(reads, 1);
  f.unmount();
});

test('members header uses its existing band read and preserves mobile counter placement', async () => {
  for (const logo_url of [photoUrl, null, 'https://untrusted.example/photo.png']) {
    const p = photoPresentation(), reads = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'self' } } } }) },
      from(table) {
        const call = { table }; reads.push(call);
        return {
          select(columns) { call.columns = columns; return this; }, eq() { return this; },
          async maybeSingle() { return { data: table === 'bands' ? { name: longBandName, logo_url } : { user_id: 'self', role: 'member' } }; },
          async order() { return { data: [{ user_id: 'self', role: 'member' }] }; },
        };
      },
    };
    const f = harness('src/app/bandas/[bandId]/membros/page.tsx', {
      ...p.modules,
      'next/navigation': { useParams: () => ({ bandId: 'band' }) },
      '@/lib/supabase/client': { getSupabaseBrowserClient: () => client },
      '@/lib/band-entry': { BAND_ENTRY_BACKEND_VALIDATED: false },
      '@/lib/display-name': { loadMemberNames: async () => new Map([['self', 'Você']]) },
      '@/lib/record-permissions': { recordWriteError: () => '' },
      '@/components/band-workspace': { BandWorkspaceInfo: () => null },
    });
    f.render(); await settle();
    const tree = f.render(), header = tree.find(n => n.type === 'header');
    const avatar = nodes(header).find(n => n.type === p.Avatar);
    assert.equal(avatar.props.imageUrl, logo_url === photoUrl ? photoUrl : null);
    assert.equal(avatar.props.name, longBandName);
    assert.match(header.props.className, /flex-col.*sm:flex-row/);
    assert.equal(header.props.children[1].type, 'span');
    assert.ok(nodes(header).find(n => n.type === 'h1').props.className.includes('[overflow-wrap:anywhere]'));
    assert.equal(reads.filter(r => r.table === 'bands').length, 1);
    assert.equal(reads.find(r => r.table === 'bands').columns, 'name, logo_url');
    f.unmount();
  }
});

test('shared avatar falls back after image failure and recovers when the URL changes', () => {
  const f = harness('src/components/profile-avatar.tsx', {
    'next/image': { __esModule: true, default: function Image() { return null; } },
  });
  let tree = f.render({ name: 'Banda Teste', imageUrl: photoUrl });
  tree.find(n => n.props.onError).props.onError();
  tree = f.render({ name: 'Banda Teste', imageUrl: photoUrl });
  assert.equal(tree.some(n => n.props.onError), false);
  assert.equal(tree[0].props.children, 'BT');
  tree = f.render({ name: 'Banda Teste', imageUrl: photoUrl + '2' });
  assert.ok(tree.some(n => n.props.onError));
  tree = f.render({ name: 'Banda Teste', imageUrl: null });
  assert.equal(tree[0].props.children, 'BT');
  f.unmount();
});

test('search results show validated logos with fallbacks and preserve selection actions', async () => {
  const p = photoPresentation(); let searches = 0, eligibilityChecks = 0;
  const f = harness('src/components/band-search.tsx', {
    ...p.modules,
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({ auth: {
      getUser: async () => ({ data: { user: { user_metadata: { display_name: 'Nome' } } } }),
    } }) },
    '@/lib/band-entry': { BAND_ENTRY_BACKEND_VALIDATED: true, entryError: () => ({ message: 'Error' }),
      createBandEntryService: () => ({ entryEligibility: async () => { eligibilityChecks++; return 'member'; } }) },
    '@/lib/band-search': { defaultEntryMessage: () => '',
      async searchBandNames() { searches++; return { matches: [photoUrl, null, 'https://evil.example/logo.png'].map((logo_url, i) => ({
        band_id: String(i), name: longBandName, logo_url,
      })), next: 'cursor' }; }, registerEntryRequest: () => { throw Error('No writes expected'); } },
    '@/lib/display-name': { normalizeDisplayName: value => value },
  });
  f.render(); await settle();
  let tree = f.render();
  tree.find(n => n.type === 'input').props.onChange({ target: { value: 'Band' } });
  tree = f.render(); tree.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle(); tree = f.render();
  assert.deepEqual(tree.filter(n => n.type === p.Avatar).map(n => n.props.imageUrl), [photoUrl, null, null]);
  assert.ok(tree.filter(n => n.type === 'h3').every(n => n.props.className.includes('[overflow-wrap:anywhere]')));
  assert.ok(tree.some(n => n.type === 'button' && n.props.children === 'Pesquisar mais bandas'));
  assert.equal(searches, 1);
  tree.find(n => n.type === 'button' && n.props.children === 'Selecionar banda').props.onClick();
  await settle(); tree = f.render();
  assert.equal(eligibilityChecks, 1);
  assert.ok(tree.some(n => n.props.href === '/bandas/0'));
  f.unmount();
});
test('picker validates, supports removal/replacement and revokes preview on change/unmount', () => {
  const f = harness('src/components/band-photo-picker.tsx'); let file = null;
  const render = disabled => f.render({ file, disabled: !!disabled, onChange: value => { file = value; } });
  function choose(value, disabled) { render(disabled).find(n => n.type === 'input').props.onChange({ currentTarget: { files: [value], value: 'selected' } }); }
  choose({ name: 'bad', type: 'image/gif', size: 2 }); assert.equal(file, null);
  choose({ name: 'big', type: 'image/png', size: 2097153 }); assert.equal(file, null);
  choose({ name: 'a', type: 'image/png', size: 100 }); render();
  choose({ name: 'b', type: 'image/webp', size: 100 }); render();
  assert.ok(f.urls.some(([op, url]) => op === 'revoke' && url === 'blob:a'));
  render().find(n => n.type === 'button').props.onClick(); render(); assert.equal(file, null);
  assert.ok(f.urls.some(([op, url]) => op === 'revoke' && url === 'blob:b'));
  choose({ name: 'disabled', type: 'image/png', size: 1 }, true); assert.equal(file, null);
  choose({ name: 'c', type: 'image/jpeg', size: 100 }); render(); f.unmount();
  assert.ok(f.urls.some(([op, url]) => op === 'revoke' && url === 'blob:c'));
});

test('band picker shows an existing photo when no replacement is selected', () => {
  const f = harness('src/components/band-photo-picker.tsx');
  const tree = f.render({ file: null, disabled: false, name: 'Current Band', currentImageUrl: photoUrl, onChange() {} });
  assert.ok(tree.some(n => n.props.name === 'Current Band' && n.props.imageUrl === photoUrl));
  f.unmount();
});
function pageFixture() {
  const state = { user: 'A', creates: 0, uploads: 0, failures: 0, signals: [], paths: [], routes: [], listeners: [] };
  class BandLogoError extends Error { constructor(stage) { super(stage); this.stage = stage; } }
  const f = harness('src/app/bandas/nova/page.tsx', {
    'next/navigation': { useRouter: () => ({ replace: route => state.routes.push(route), refresh() {} }) },
    '@/lib/form-validation': { requiredTextError: value => value.trim() ? null : 'name required' },
    '@/lib/band-slug': { createBandSlug: () => 'stable-slug' },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({ auth: {
      getUser: async () => ({ data: { user: { id: state.user } } }),
      onAuthStateChange(fn) { state.listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    } }) },
    '@/lib/band-creation': { async ensureCreatedBand() { state.creates++; return 'band-id'; } },
    '@/lib/band-logo-upload': { BandLogoError, bandPhotoSession: async () => ({ scoped: {}, verify: async () => {} }),
      async uploadBandLogo(client, user, band, file, attempt, signal) {
        state.uploads++; state.signals.push(signal); state.paths.push([user, band, attempt]);
        if (state.wait) await state.wait;
        if (state.failures-- > 0) throw Error('failed upload');
        if (state.deny) throw new BandLogoError('authorization');
      } },
  });
  const render = () => f.render();
  const submit = () => render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  return { f, state, render, submit, async ready() { render(); await settle(); render(); f.slots[3] = 'Band'; },
    choose() { render().find(n => n.props?.onChange && 'file' in n.props).props.onChange({ name: 'photo', type: 'image/png', size: 100 }); } };
}
test('band creation without photo continues normally', async () => {
  const f = pageFixture(); await f.ready(); await f.submit();
  assert.equal(f.state.creates, 1); assert.equal(f.state.uploads, 0); assert.deepEqual(f.state.routes, ['/dashboard']); f.f.unmount();
});
test('failed photo preserves created band; retry reuses attempt and never repeats creation', async () => {
  const f = pageFixture(); await f.ready(); f.choose(); f.state.failures = 1;
  await f.submit(); assert.equal(f.state.creates, 1); assert.equal(f.state.routes.length, 0);
  assert.match(f.f.slots[5], /Banda criada/);
  await f.submit(); assert.equal(f.state.creates, 1); assert.equal(f.state.uploads, 2);
  assert.deepEqual(f.state.paths[0], f.state.paths[1]); assert.deepEqual(f.state.routes, ['/dashboard']); f.f.unmount();
});
test('failed photo can be skipped without another upload or creation', async () => {
  const f = pageFixture(); await f.ready(); f.choose(); f.state.failures = 1; await f.submit();
  const button = f.render().find(n => n.type === 'button' && n.props.children === 'Continuar sem foto');
  button.props.onClick(); assert.equal(f.state.creates, 1); assert.equal(f.state.uploads, 1); assert.deepEqual(f.state.routes, ['/dashboard']); f.f.unmount();
});
test('double submission does not duplicate creation; account switch aborts and suppresses success', async () => {
  const f = pageFixture(); await f.ready(); f.choose(); let release;
  f.state.wait = new Promise(resolve => { release = resolve; });
  const first = f.submit(); await settle(); await f.submit();
  assert.equal(f.state.creates, 1);
  f.state.user = 'B'; f.state.listeners.forEach(fn => fn('SIGNED_IN', { user: { id: 'B' } }));
  assert.equal(f.state.signals[0].aborted, true); release(); await first;
  assert.equal(f.state.routes.length, 0); await f.submit(); assert.equal(f.state.creates, 1); f.f.unmount();
});
test('authorization failure blocks photo retries', async () => {
  const f = pageFixture(); await f.ready(); f.choose(); f.state.deny = true; await f.submit(); await f.submit();
  assert.equal(f.state.uploads, 1); assert.match(f.f.slots[5], /permissão/); f.f.unmount();
});
test('shared band logo loads legacy-compatible URL and clears it on account switch', async () => {
  let listener;
  const controllerSignals = [];
  const expected = 'https://project.supabase.co/storage/v1/object/public/band-logos/band/file.png';
  const f = harness('src/components/band-logo.tsx', {
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({ auth: {
      getUser: async () => ({ data: { user: { id: 'A' } } }),
      onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    } }) },
    '@/lib/band-logo-upload': { async bandPhotoSession(client, owner, signal) {
      assert.equal(owner, 'A'); controllerSignals.push(signal);
      return { verify: async () => {}, scoped: { from(table) {
        assert.equal(table, 'bands'); return { select(columns) { assert.equal(columns, 'logo_url'); return this; },
          eq(key, value) { assert.equal(key, 'id'); assert.equal(value, 'band'); return this; },
          maybeSingle: async () => ({ data: { logo_url: expected } }) };
      } } };
    } },
    '@/lib/public-band-data': { safeBandLogo: value => value },
  });
  f.render({ bandId: 'band', name: 'Band' }); await settle();
  assert.equal(f.render({ bandId: 'band', name: 'Band' })[0].props.imageUrl, expected);
  listener('SIGNED_IN', { user: { id: 'B' } });
  assert.equal(controllerSignals[0].aborted, true);
  assert.equal(f.render({ bandId: 'band', name: 'Band' })[0].props.imageUrl, null); f.unmount();
});
