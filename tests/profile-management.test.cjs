/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const ts = require('typescript');
const { test } = require('node:test');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
function load(file, overrides = {}, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, AbortController, URL, Event,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' } },
    ...globals, require(name) {
      if (name in overrides) return overrides[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'), overrides, globals);
      if (name.startsWith('@/lib/')) return load('src/' + name.slice(2) + '.ts', overrides, globals);
      return require(name);
    } });
  return mod.exports;
}
function account(id = 'a') { return { id, email: `${id}@example.com`, user_metadata: { display_name: 'Ana', bio: '', avatar_url: 'https://project.supabase.co/photo.png', keep: 'preserved' } }; }
function serviceFixture(options = {}) {
  const user = account(), calls = [], listeners = new Set();
  const state = { identity: 'a', user, calls, ...options };
  const client = { auth: {
    async getSession() { return { data: { session: { user: { id: state.identity }, access_token: 'fixed-a', refresh_token: 'refresh-a', expires_at: Date.now() / 1000 + (state.nearExpiry ? 60 : 3600) } } }; },
    onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
    updateUser() { throw Error('Shared session must never write'); },
  } };
  const api = load('src/lib/personal-profile-edit.ts', { '@supabase/supabase-js': { createClient(_url, _key, config) {
    assert.equal(config.auth.persistSession, false); assert.equal(config.auth.autoRefreshToken, false);
    return { auth: {
      async setSession(session) { assert.equal(session.access_token, 'fixed-a'); return { data: { user } }; },
      async getUser() { if (state.beforeVerify) state.beforeVerify(); return { data: { user } }; },
      async updateUser(args) {
        calls.push(JSON.parse(JSON.stringify(args)));
        if (state.beforeWrite) state.beforeWrite();
        if (state.wait) await state.wait;
        if (!state.fail?.includes(Object.keys(args.data)[0])) Object.assign(user.user_metadata, args.data);
        if (state.lostResponse) throw Error('network');
        return { data: { user }, error: state.fail ? { message: 'error' } : null };
      },
    } };
  } } });
  return { state, api, client, changeIdentity(id) { state.identity = id; listeners.forEach(fn => fn('SIGNED_IN', { user: { id } })); },
    save: edits => api.savePersonalMetadata(client, 'a', edits, new AbortController().signal) };
}

test('bio counts Unicode code points, accepts 300 and rejects 301 without truncating', () => {
  const { api } = serviceFixture();
  for (const unit of ['a', '😀', '界']) {
    assert.equal(api.bioLength(unit.repeat(300)), 300);
    assert.equal(api.validBio(unit.repeat(300)), true);
    assert.equal(api.validBio(unit.repeat(301)), false);
  }
  assert.equal(api.bioLength('e\u0301'), 2);
  assert.equal(api.validBio(''), true);
  assert.equal(api.validBio('line one\nline two'), true);
  assert.equal(api.validBio('bad\u0000'), false);
  assert.equal(api.validBio({}), false);
});
test('explicit metadata patches preserve avatar and unknown metadata and never send email', async () => {
  const f = serviceFixture();
  const result = await f.save({ display_name: '  Ana   Silva ', bio: '<plain text>' });
  assert.deepEqual(f.state.calls, [{ data: { display_name: 'Ana Silva' } }, { data: { bio: '<plain text>' } }]);
  assert.equal(result.fields.display_name, 'saved'); assert.equal(result.fields.bio, 'saved');
  assert.equal(result.user.user_metadata.keep, 'preserved');
  assert.equal(result.user.user_metadata.avatar_url, 'https://project.supabase.co/photo.png');
  assert.equal(result.user.email, 'a@example.com');
  const onlyBio = serviceFixture(); await onlyBio.save({ bio: '' });
  assert.deepEqual(onlyBio.state.calls, [{ data: { bio: '' } }]);
});
test('invalid inputs and wrong starting account never write', async () => {
  for (const edits of [{ display_name: 'email@example.com' }, { display_name: '' }, { display_name: 'x'.repeat(81) }, { bio: '😀'.repeat(301) }]) {
    const f = serviceFixture(); await assert.rejects(f.save(edits)); assert.equal(f.state.calls.length, 0);
  }
  const f = serviceFixture({ identity: 'b' }); await assert.rejects(f.save({ bio: 'text' })); assert.equal(f.state.calls.length, 0);
  const expiring = serviceFixture({ nearExpiry: true });
  await assert.rejects(expiring.save({ bio: 'text' })); assert.equal(expiring.state.calls.length, 0);
});
test('partial failure is reported by field and lost responses require persisted confirmation', async () => {
  for (const fail of [['bio'], ['display_name']]) {
    const f = serviceFixture({ fail }); const result = await f.save({ display_name: 'New name', bio: 'New bio' });
    for (const field of ['bio', 'display_name']) assert.equal(result.fields[field], fail.includes(field) ? 'error' : 'saved');
  }
  const f = serviceFixture({ lostResponse: true });
  assert.equal((await f.save({ bio: 'persisted' })).fields.bio, 'saved');
});
test('account change during verification or a write blocks subsequent fields and never writes to the new account', async () => {
  const before = serviceFixture(); before.state.beforeVerify = () => before.changeIdentity('b');
  await assert.rejects(before.save({ bio: 'blocked' })); assert.equal(before.state.calls.length, 0);
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = serviceFixture({ wait });
  const saving = f.save({ display_name: 'Changed', bio: 'Must not follow' });
  await settle(); f.changeIdentity('b'); release();
  await assert.rejects(saving); assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.user.id, 'a'); assert.equal(f.state.user.user_metadata.bio, '');
});
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function pageFixture(options = {}, file = 'src/app/dashboard/perfil/page.tsx') {
  const slots = [], effects = [], pending = [], events = [], writes = [];
  let cursor = 0, listener;
  const state = { user: account(), ...options }, handlers = new Map();
  const service = serviceFixture().api;
  const client = { auth: {
    getUser: async () => ({ data: { user: state.user } }),
    getSession: async () => ({ data: { session: state.user ? { user: { id: state.sessionUserId ?? state.user.id } } : null } }),
    onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
  }, from() { return { select() { return this; }, eq() { return this; }, order: async () => ({ data: state.bands ?? [], error: null }) }; } };
  const Page = load(file, {
    react: { ...React,
      useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
      useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
      useEffect(fn, deps) { const i = cursor++, old = effects[i];
        if (!old || deps.some((d, j) => d !== old.deps[j])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
    },
    'next/link': { __esModule: true, default: () => null },
    '@/components/avatar-completion': { __esModule: true, default: function AvatarEditor() {} },
    '@/components/profile-avatar': { __esModule: true, default: function Avatar() {} },
    '@/components/navigation-icon': { __esModule: true, default: () => null },
    '@/components/workspace-settings': { WorkspaceSettingsMenu: () => null },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => client },
    '@/lib/personal-profile-edit': { ...service, async savePersonalMetadata(_client, owner, edits, signal) {
      writes.push({ owner, edits }); state.signal = signal;
      if (state.wait) await state.wait;
      const fields = {};
      for (const [key, value] of Object.entries(edits)) { fields[key] = state.fail === key ? 'error' : 'saved'; if (fields[key] === 'saved') state.user.user_metadata[key] = value; }
      return { user: state.user, fields };
    } },
  }, { window: { setTimeout, clearTimeout,
    addEventListener(name, fn) { handlers.set(name, fn); }, removeEventListener(name) { handlers.delete(name); },
    dispatchEvent(event) { events.push(event.type); handlers.get(event.type)?.(event); },
  } }).default;
  return { state, writes, events,
    render(props = {}) { cursor = 0; const tree = nodes(Page(props)); while (pending.length) pending.shift()(); return tree; },
    change(value) { state.user = value; listener('SIGNED_IN', value ? { user: value } : null); },
    notify(event = 'bandup:personal-profile-updated') { handlers.get(event)?.(); },
    dispose() { effects.forEach(e => e?.cleanup?.()); },
  };
}
test('profile page loads verified data, exposes a readonly email, and hides fields without authentication', async () => {
  for (const user of [account(), null]) {
    const f = pageFixture({ user }); assert.ok(f.render().some(n => n.props.role === 'status'));
    await settle(); const tree = f.render();
    const email = tree.find(n => n.props.id === 'profile-email');
    if (user) { assert.equal(email.props.readOnly, true); assert.equal(email.props.onChange, undefined); assert.equal(email.props.value, user.email); }
    else { assert.equal(email, undefined); assert.ok(tree.some(n => n.props.href === '/login')); }
    f.dispose();
  }
});

test('mismatched account during page load never exposes readonly email or editable fields', async () => {
  const f = pageFixture({ sessionUserId: 'b' }); f.render(); await settle();
  assert.equal(f.render().some(n => n.props.id === 'profile-email'), false); f.dispose();
});

test('selector explicitly rereads personal metadata after profile save while retaining its layout', async () => {
  const f = pageFixture({}, 'src/components/space-switcher.tsx');
  f.render(); await settle(); let tree = f.render();
  assert.ok(tree.find(n => n.type === 'summary').props['aria-label'].includes('Ana'));
  f.state.user.user_metadata.display_name = 'Updated Profile';
  f.state.user.user_metadata.avatar_url = 'https://project.supabase.co/new.png';
  f.notify(); f.render(); await settle(); tree = f.render();
  const summary = tree.find(n => n.type === 'summary');
  assert.ok(summary.props['aria-label'].includes('Updated Profile'));
  assert.ok(nodes(summary).some(n => n.props.imageUrl === 'https://project.supabase.co/new.png'));
  assert.ok(tree.some(n => n.props.href === '/dashboard/perfil'));
  assert.ok(tree[0].props.className.includes('sm:min-w-72'));
  f.dispose();
});

test('band save event reloads the active selector name and photo and enables its profile link', async () => {
  const band = { id: 'band-a', name: 'Before', logo_url: null };
  const f = pageFixture({ bands: [{ band_id: band.id, band }] }, 'src/components/space-switcher.tsx');
  const props = { bandId: band.id };
  f.render(props); await settle(); let tree = f.render(props);
  assert.ok(tree.find(n => n.type === 'summary').props['aria-label'].includes('Before'));
  band.name = 'After'; band.logo_url = 'https://project.supabase.co/storage/v1/object/public/band-logos/band-a/photo.png';
  f.notify('bandup:band-profile-updated'); f.render(props); await settle(); tree = f.render(props);
  assert.ok(tree.find(n => n.type === 'summary').props['aria-label'].includes('After'));
  assert.ok(nodes(tree.find(n => n.type === 'summary')).some(n => n.props.imageUrl === band.logo_url));
  const profile = tree.find(n => n.props.children === 'Perfil');
  assert.equal(profile.props.href, '/bandas/band-a/perfil'); assert.equal(profile.props.disabled, undefined);
  f.dispose();
});
test('profile form saves only edits, counts Unicode and announces partial failures and selector refresh', async () => {
  const f = pageFixture({ fail: 'bio' }); f.render(); await settle();
  let tree = f.render();
  tree.find(n => n.props.id === 'profile-bio').props.onChange({ target: { value: '😀'.repeat(301) } });
  tree = f.render(); assert.equal(tree.find(n => n.props.type === 'submit').props.disabled, true);
  await tree.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); assert.equal(f.writes.length, 0);
  tree.find(n => n.props.id === 'profile-bio').props.onChange({ target: { value: '😀'.repeat(300) } });
  tree.find(n => n.props.id === 'profile-name').props.onChange({ target: { value: 'New Name' } });
  tree = f.render(); assert.ok(tree.some(n => n.props.id === 'profile-bio-count' && n.props.children[0] === 300));
  await tree.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  tree = f.render(); assert.deepEqual(Object.keys(f.writes[0].edits).sort(), ['bio', 'display_name']);
  const feedback = tree.find(n => n.props.role === 'alert');
  assert.match(feedback.props.children, /Nome: salvo/); assert.match(feedback.props.children, /Descrição: não foi possível/);
  assert.deepEqual(f.events, ['bandup:personal-profile-updated']);
  await tree.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(Object.keys(f.writes[1].edits), ['bio'], 'retry sends only the field not confirmed saved');
  f.dispose();
});
test('page aborts and hides private fields when account changes during save', async () => {
  let release; const f = pageFixture({ wait: new Promise(resolve => { release = resolve; }) });
  f.render(); await settle(); let tree = f.render();
  tree.find(n => n.props.id === 'profile-bio').props.onChange({ target: { value: 'draft' } });
  tree = f.render(); const saving = tree.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle(); f.change(account('b')); assert.equal(f.state.signal.aborted, true);
  release(); await saving;
  tree = f.render(); assert.equal(tree.some(n => n.props.id === 'profile-email'), false);
  assert.equal(f.events.length, 0); f.dispose();
});
