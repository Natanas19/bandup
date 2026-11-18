/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const origin = 'https://project.supabase.co';
const avatar = origin + '/storage/v1/object/public/avatars/a0000000-0000-0000-0000-000000000001/b0000000-0000-4000-8000-000000000001.webp';
function load(file, imports, enabled = true) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { module: mod, exports: mod.exports, AbortController, URL,
    process: { env: { NEXT_PUBLIC_BANDUP_MUSICIAN_DISCOVERY_ENABLED: String(enabled), NEXT_PUBLIC_SUPABASE_URL: origin } },
    require: name => name in imports ? imports[name] : require(name) });
  return mod.exports;
}
const service = enabled => load('src/lib/musician-discovery.ts', {
  './display-name': { normalizeMemberDisplayName: value => typeof value === 'string' && !value.includes('@') ? value : null },
  './public-band-data': load('src/lib/public-band-data.ts', {
    './social-links': load('src/lib/social-links.ts', {}),
    './development-lab': load('src/lib/development-lab.ts', {}),
  }),
}, enabled);
test('musician route uses existing private session boundary', () => {
  const { getPrivateScope } = load('src/lib/private-session.ts', {});
  assert.equal(getPrivateScope('/descobrir/musicos'), '/descobrir');
});
test('disabled service never calls RPC; search and offset validation fail closed', async () => {
  let calls = 0;
  const client = { rpc() { calls++; throw Error(); } };
  const signal = new AbortController().signal;
  await assert.rejects(service(false).discoverMusicians(client, '', 0, signal));
  for (const [query, offset] of [['x'.repeat(101), 0], ['Ana', -1], ['Ana', 0.5], ['', 0], ['   ', 0]]) {
    await assert.rejects(service(true).discoverMusicians(client, query, offset, signal));
  }
  assert.equal(calls, 0);
});
test('RPC searches on server, uses lookahead pagination and strips private fields/photos', async () => {
  const calls = [];
  let rows = Array.from({ length: 21 }, (_, i) => ({ display_name: 'Ana', available: i % 2 === 0,
    photo_ref: 'https://private.example/photo', user_id: 'private-id', email: 'private@example.com' }));
  const client = { rpc(name, args) { calls.push([name, args]); return { abortSignal: async () => ({ data: rows, error: null }) }; } };
  const api = service(true);
  const signal = new AbortController().signal;
  const first = await api.discoverMusicians(client, ' Ana%_ ', 20, signal);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['bandup_discover_musicians', { p_query: 'Ana%_', p_offset: 20, p_limit: 21 }]]);
  assert.equal(first.hasNext, true); assert.equal(first.musicians.length, 20);
  assert.deepEqual(Object.keys(first.musicians[0]), ['name', 'available', 'avatarUrl']);
  assert.equal(first.musicians[0].avatarUrl, null);
  assert.equal(first.musicians[1].available, false);
  rows = [
    ...[avatar, avatar + '?token=private', avatar.replace('/avatars/', '/band-logos/'), avatar.replace('.webp', '.svg'), null]
      .map(photo_ref => ({ display_name: 'Ana', available: true, photo_ref })),
    { display_name: 'Ana', available: false, photo_ref: avatar },
  ];
  assert.deepEqual(Array.from((await api.discoverMusicians(client, 'Ana', 0, signal)).musicians, item => item.avatarUrl),
    [avatar, null, null, null, null, null]);
  rows = []; assert.equal((await api.discoverMusicians(client, 'Ana', 40, signal)).hasNext, false);
  rows = [{ display_name: 'bad@example.com', available: false }];
  assert.equal((await api.discoverMusicians(client, 'Ana', 0, signal)).musicians[0].name, 'Músico');
  rows = [{ available: 'false' }]; await assert.rejects(api.discoverMusicians(client, 'Ana', 0, signal));
});
function fixture(enabled = true) {
  const slots = [], effects = [], scheduled = [], calls = [];
  let cursor = 0;
  const Component = load('src/components/musician-discovery.tsx', {
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useEffect(fn, deps) { const i = cursor++; const old = effects[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
    },
    '@/components/profile-avatar': { default: () => null, __esModule: true },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({}) },
    '@/lib/musician-discovery': { MUSICIAN_DISCOVERY_ENABLED: enabled, MUSICIAN_PAGE_SIZE: 20,
      discoverMusicians(client, query, offset, signal) { return new Promise((resolve, reject) => calls.push({ query, offset, signal, resolve, reject })); } },
  }).default;
  return { calls, render() { cursor = 0; const tree = Component(); while (scheduled.length) scheduled.shift()(); return tree; },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); } };
}
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)]; }
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
test('UI disabled makes no requests', () => { const h = fixture(false); assert.equal(h.render(), null); assert.equal(h.calls.length, 0); });
test('UI searches on submit, paginates, resets search, ignores stale replies and handles retry/empty/unmount', async () => {
  const h = fixture(); h.render();
  const type = value => nodes(h.render()).find(n => n.type === 'input').props.onChange({ target: { value } });
  const submit = () => nodes(h.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.ok(nodes(h.render()).some(n => n.props?.children === 'Digite um nome para buscar músicos.'));
  for (const value of ['', '   ']) { type(value); submit(); h.render(); }
  type(' Ana '); h.render();
  assert.equal(h.calls.length, 0);
  submit(); h.render();
  assert.equal(h.calls[0].query, 'Ana'); assert.equal(h.calls[0].offset, 0);
  h.calls[0].resolve({ musicians: [{ name: 'Ana', available: false }], hasNext: true }); await settle();
  let tree = nodes(h.render()); assert.ok(tree.some(n => n.props?.children === 'Indisponível para bandas'));
  tree.find(n => n.props?.children === 'Próxima').props.onClick(); h.render(); assert.equal(h.calls[1].offset, 20);
  type('Bia'); h.render(); assert.equal(h.calls.length, 2); submit(); h.render();
  assert.equal(h.calls[1].signal.aborted, true); assert.equal(h.calls[2].offset, 0); assert.equal(h.calls[2].query, 'Bia');
  h.calls[2].resolve({ musicians: [{ name: 'Bia', available: true, avatarUrl: avatar }], hasNext: false }); await settle();
  h.calls[1].resolve({ musicians: [{ name: 'Old', available: false }], hasNext: true }); await settle();
  tree = nodes(h.render()); assert.ok(tree.some(n => n.props?.children === 'Bia')); assert.ok(!tree.some(n => n.props?.children === 'Old'));
  assert.ok(tree.some(n => n.props?.name === 'Bia' && n.props.imageUrl === avatar));
  assert.equal(tree.find(n => n.props?.children === 'Próxima').props.disabled, true);
  tree.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.render();
  h.calls[3].reject(Error('private backend details')); await settle();
  tree = nodes(h.render()); assert.ok(tree.some(n => n.props?.role === 'alert'));
  tree.find(n => n.props?.children === 'Tentar novamente').props.onClick(); h.render();
  h.calls[4].resolve({ musicians: [], hasNext: false }); await settle();
  assert.ok(nodes(h.render()).some(n => n.props?.children === 'Nenhum músico encontrado.'));
  h.unmount(); assert.equal(h.calls[4].signal.aborted, true);
});
