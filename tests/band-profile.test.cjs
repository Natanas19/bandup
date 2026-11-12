/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { test } = require('node:test');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const band = id => ({ id, name: `Name ${id}`, description: 'Private description', logo_url: null });
function load(file, overrides = {}, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, AbortController, Event, ...globals, require(name) {
    if (name in overrides) return overrides[name];
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'), overrides, globals);
    return require(name);
  } });
  return mod.exports;
}
function serviceFixture(options = {}) {
  const state = { role: 'admin', identity: 'a', band: band('band-a'), queries: [], writes: [], ...options };
  const verify = async () => { if (state.identity !== 'a' || state.signal.aborted) throw Error('Changed session'); };
  const scoped = { from(table) {
    const q = { table, filters: [] }; state.queries.push(q);
    return {
      select(columns) { q.columns = columns; return this; },
      eq(key, value) { q.filters.push([key, value]); return this; },
      update(values) { q.values = values; return this; },
      async maybeSingle() {
        if (table === 'band_members') return { data: state.role ? { role: state.role } : null };
        assert.equal(table, 'bands');
        assert.deepEqual(q.filters, [['id', 'band-a']]);
        if (q.values) {
          state.writes.push(JSON.parse(JSON.stringify(q.values)));
          state.beforeWrite?.();
          if (state.dbDeny) return { data: null, error: { code: '42501' } };
          if (state.zeroRows) return { data: null, error: null };
          if (!state.rejectWrite) Object.assign(state.band, q.values);
          if (state.lostResponse) throw Error('network');
          return { data: { id: 'band-a' }, error: state.rejectWrite ? { code: '23514' } : null };
        }
        return { data: state.role ? { ...state.band } : null };
      },
    };
  } };
  const api = load('src/lib/band-profile.ts', { './band-logo-upload': { async bandPhotoSession(_client, actor, signal) {
    assert.equal(actor, 'a'); state.signal = signal; await verify(); return { scoped, verify };
  } } });
  return { state, api, read: () => api.loadBandProfile({}, 'a', 'band-a', new AbortController().signal),
    save: (name = 'New Name', description = 'New description') => api.saveBandProfile({}, 'a', 'band-a', name, description, new AbortController().signal) };
}
test('private load allows administrators/members and rejects external users without discovery calls', async () => {
  for (const role of ['admin', 'member', null]) {
    const f = serviceFixture({ role });
    if (role) { const result = await f.read(); assert.equal(result.role, role); assert.equal(result.band.description, 'Private description'); }
    else { await assert.rejects(f.read()); assert.equal(f.state.queries.some(q => q.table === 'bands'), false); }
    assert.equal(f.state.writes.length, 0);
  }
});
test('text save patches only name/description, preserves photo, and reconciles lost responses', async () => {
  for (const lostResponse of [false, true]) {
    const f = serviceFixture({ lostResponse }); f.state.band.logo_url = 'existing-photo';
    const result = await f.save('  New Name  ', '  New description  ');
    assert.deepEqual(f.state.writes, [{ name: 'New Name', description: 'New description' }]);
    assert.equal(result.band.logo_url, 'existing-photo'); assert.equal(result.band.name, 'New Name');
    assert.equal(f.state.queries.some(q => q.table === 'storage.objects'), false);
  }
});
test('member, external, invalid text and server RLS refusals never claim saved', async () => {
  for (const role of ['member', null]) { const f = serviceFixture({ role }); await assert.rejects(f.save()); assert.equal(f.state.writes.length, 0); }
  for (const args of [['', 'ok'], ['a'.repeat(101), 'ok'], ['ok', 'a'.repeat(501)]]) {
    const f = serviceFixture(); await assert.rejects(f.save(...args)); assert.equal(f.state.writes.length, 0);
  }
  for (const flag of ['dbDeny', 'zeroRows', 'rejectWrite']) {
    const f = serviceFixture({ [flag]: true }); await assert.rejects(f.save());
  }
});
test('demotion or identity change during update suppresses success and never targets another band', async () => {
  for (const field of ['role', 'identity']) {
    const f = serviceFixture(); f.state.beforeWrite = () => { f.state[field] = field === 'role' ? 'member' : 'b'; };
    await assert.rejects(f.save());
    assert.equal(f.state.writes.length, 1);
    assert.ok(f.state.queries.filter(q => q.table === 'bands').every(q => q.filters[0][1] === 'band-a'));
  }
});
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
function pageFixture(options = {}) {
  const state = { identity: 'a', bandId: 'band-a', role: 'admin', bands: { 'band-a': band('band-a'), 'band-b': band('band-b') }, reads: [], writes: [], photos: [], events: [], ...options };
  const slots = [], effects = [], pending = [], listeners = new Set(); let cursor = 0, key;
  function PhotoPicker() {} function Avatar() {} function Navigation() {}
  const Page = load('src/app/bandas/[bandId]/perfil/page.tsx', {
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useEffect(fn, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((d,j) => d !== old.deps[j])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
    },
    'next/navigation': { useParams: () => ({ bandId: state.bandId }) },
    '@/components/band-workspace': { BandWorkspaceInfo: () => null },
    '@/components/band-navigation': { __esModule: true, default: Navigation },
    '@/components/band-photo-picker': { __esModule: true, default: PhotoPicker },
    '@/components/profile-avatar': { __esModule: true, default: Avatar },
    '@/lib/public-band-data': { safeBandLogo: value => value },
    '@/lib/form-validation': { requiredTextError: value => value.trim() ? null : 'required' },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({ auth: {
      getUser: async () => ({ data: { user: state.identity ? { id: state.identity } : null } }),
      onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
    } }) },
    '@/lib/band-profile': {
      async loadBandProfile(_client, actor, id, signal) {
        state.reads.push(id); if (!state.role || signal.aborted || actor !== state.identity) throw Error('denied');
        return { band: { ...state.bands[id] }, role: state.role };
      },
      async saveBandProfile(_client, actor, id, name, description, signal) {
        state.writes.push({ actor, id, name, description }); state.signal = signal;
        if (state.wait) await state.wait;
        if (state.textFail || state.role !== 'admin' || signal.aborted || actor !== state.identity) throw Error('denied');
        Object.assign(state.bands[id], { name, description });
        return { band: { ...state.bands[id] }, role: state.role };
      },
    },
    '@/lib/band-logo-upload': { async uploadBandLogo(_client, actor, id, file, attempt, signal) {
      state.photos.push({ actor, id, file, attempt }); state.signal = signal;
      if (state.photoFail) throw Error('photo failed');
      return state.bands[id].logo_url = `https://project.supabase.co/storage/v1/object/public/band-logos/${id}/${attempt}.png`;
    } },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' } },
    crypto: { randomUUID: () => 'attempt' }, window: { setTimeout, clearTimeout, dispatchEvent: event => state.events.push(event.type) } }).default;
  const dispose = () => effects.forEach(e => e?.cleanup?.());
  return { state, PhotoPicker, Avatar, Navigation, dispose,
    render() {
      const wrapper = Page();
      if (key !== wrapper.key) { dispose(); slots.length = effects.length = pending.length = 0; key = wrapper.key; }
      cursor = 0; const tree = nodes(wrapper.type(wrapper.props));
      while (pending.length) pending.shift()(); return tree;
    },
    changeAccount(id) { state.identity = id; listeners.forEach(fn => fn('SIGNED_IN', id ? { user: { id } } : null)); },
  };
}
const submit = tree => tree.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
test('private page exposes edits to admin, readonly fields to member, and no data to external/signed-out users', async () => {
  for (const options of [{ role: 'admin' }, { role: 'member' }, { role: null }, { identity: null }]) {
    const f = pageFixture(options); f.render(); await settle(); const tree = f.render();
    if (options.role === 'admin') assert.ok(tree.some(n => n.type === 'form') && tree.some(n => n.type === f.PhotoPicker));
    else if (options.role === 'member') {
      assert.equal(tree.some(n => n.type === 'form' || n.type === 'input' || n.type === f.PhotoPicker), false);
      assert.ok(tree.some(n => n.props.children === 'Private description'));
    } else { assert.equal(tree.some(n => n.type === f.Avatar || n.type === 'form'), false); assert.ok(tree.some(n => n.props.role === 'alert')); }
    f.dispose();
  }
});
test('text/photo saves remain independent and report partial failures without losing drafts', async () => {
  const f = pageFixture({ photoFail: true }); f.render(); await settle(); let tree = f.render();
  tree.find(n => n.props.id === 'band-profile-name').props.onChange({ target: { value: 'Updated Band' } });
  tree = f.render(); submit(tree); await settle(); tree = f.render();
  assert.equal(f.state.photos.length, 0); assert.ok(tree.some(n => n.props.role === 'status' && n.props.children.includes('Nome e descrição salvos')));
  tree.find(n => n.type === f.PhotoPicker).props.onChange({ type: 'image/png', size: 1 });
  tree = f.render(); tree.find(n => n.type === 'button' && n.props.children === 'Salvar foto').props.onClick();
  await settle(); tree = f.render();
  assert.equal(f.state.writes.length, 1); assert.equal(f.state.photos.length, 1);
  assert.ok(tree.some(n => n.props.role === 'alert')); assert.ok(tree.find(n => n.type === f.PhotoPicker).props.file);
  assert.ok(f.state.events.includes('bandup:band-profile-updated')); f.dispose();
});
test('demoted admin loses controls after refusal and refreshed private read', async () => {
  const f = pageFixture(); f.render(); await settle(); let tree = f.render();
  f.state.role = 'member'; submit(tree); await settle(); tree = f.render();
  assert.equal(tree.some(n => n.type === 'form' || n.type === f.PhotoPicker), false);
  assert.ok(tree.some(n => n.props.role === 'alert')); f.dispose();
});

test('saved photo remains visible when a later text save fails, and upload retries reuse the attempt', async () => {
  const f = pageFixture({ photoFail: true, textFail: true }); f.render(); await settle(); let tree = f.render();
  tree.find(n => n.type === f.PhotoPicker).props.onChange({ type: 'image/png', size: 1 });
  tree = f.render(); tree.find(n => n.type === 'button' && n.props.children === 'Salvar foto').props.onClick();
  await settle(); f.state.photoFail = false; tree = f.render();
  tree.find(n => n.type === 'button' && n.props.children === 'Salvar foto').props.onClick();
  await settle(); tree = f.render();
  assert.equal(f.state.photos[0].attempt, f.state.photos[1].attempt);
  const url = f.state.bands['band-a'].logo_url;
  assert.equal(tree.find(n => n.type === f.PhotoPicker).props.currentImageUrl, url);
  assert.equal(tree.find(n => n.type === f.PhotoPicker).props.file, null);
  submit(tree); await settle(); tree = f.render();
  assert.equal(f.state.bands['band-a'].logo_url, url);
  assert.ok(tree.some(n => n.props.role === 'status' && n.props.children.includes('Foto salva')));
  assert.ok(tree.some(n => n.props.role === 'alert')); f.dispose();
});
test('account and band switches abort pending work and suppress stale success', async () => {
  for (const change of ['account', 'band']) {
    let release; const f = pageFixture({ wait: new Promise(resolve => { release = resolve; }) });
    f.render(); await settle(); submit(f.render()); await settle();
    if (change === 'account') f.changeAccount('b');
    else { f.state.bandId = 'band-b'; f.render(); }
    assert.equal(f.state.signal.aborted, true); release(); await settle(); const tree = f.render();
    assert.equal(f.state.writes[0].id, 'band-a'); assert.equal(f.state.bands['band-b'].name, 'Name band-b');
    assert.equal(tree.some(n => n.props.role === 'status' && typeof n.props.children === 'string' && n.props.children.includes('salvos')), false);
    assert.equal(f.state.events.length, 0); f.dispose();
  }
});
