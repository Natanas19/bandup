/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { test } = require('node:test');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const origin = 'https://project.supabase.co';
const photo = n => `${origin}/storage/v1/object/public/avatars/owner/${n}.png`;
const request = (id, band_id = 'band-a') => ({ id, band_id, requester_id: 'owner', applicant_name: `Name ${id}`,
  status: 'pending', requested_at: '2026-01-01T00:00:00Z' });
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
function fixture(api, initialBand = 'band-a') {
  const slots = [], effects = [], scheduled = []; let cursor = 0, mountedKey;
  function Avatar() {}
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++, old = slots[i];
      if (!old || deps.some((d,j) => d !== old.deps[j])) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++, old = effects[i];
      if (!old || deps.some((d,j) => d !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  function load(file) {
    const mod = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, URL, process: { env: { NEXT_PUBLIC_SUPABASE_URL: origin, NODE_ENV: 'test' } }, require(name) {
      if (name === 'react') return hooks;
      if (name === 'next/navigation') return { useSearchParams: () => new URLSearchParams() };
      if (name === '@/components/notification-target') return { NotificationTargetStatus: () => null };
      if (name === 'next/link' || name === '@/components/band-entry-panel') return { __esModule: true, default: () => null };
      if (name === '@/components/profile-avatar') return { __esModule: true, default: Avatar };
      if (name === '@/lib/band-entry') return { BAND_ENTRY_BACKEND_VALIDATED: true, createBandEntryService: () => api,
        entryError: error => ({ code: error?.code ?? 'unknown', message: 'Operation unavailable' }) };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => ({}) };
      if (name.startsWith('@/lib/')) return load('src/' + name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
      return require(name);
    } });
    return mod.exports;
  }
  const Flow = load('src/components/band-entry-flow.tsx').default;
  const cleanup = () => effects.forEach(e => e?.cleanup?.());
  return { Avatar, cleanup, render(bandId = initialBand) {
    const wrapper = Flow({ bandId }).props.children;
    if (mountedKey !== wrapper.key) { cleanup(); slots.length = effects.length = scheduled.length = 0; mountedKey = wrapper.key; }
    cursor = 0; const tree = nodes(wrapper.type(wrapper.props)); while (scheduled.length) scheduled.shift()(); return tree;
  } };
}
const control = (tree, label) => tree.find(n => n.type === 'button' && n.props.children === label);

test('avatars follow request IDs, with initials for absent, invalid or untrusted URLs', async () => {
  const rows = ['a','b','c','d','e'].map(id => request(id)), calls = [];
  const f = fixture({ adminRequests: async () => rows, async pendingRequestAvatars(band, ids) {
    calls.push({ band, ids }); return new Map([['e', photo('e')], ['d', 'https://evil.example/photo.png'],
      ['c', 'not-a-url'], ['b', null], ['a', photo('a')]]);
  } });
  f.render(); await settle(); const tree = f.render();
  const avatars = tree.filter(n => n.type === f.Avatar);
  assert.deepEqual(avatars.map(n => n.props.name), ['Name a','Name b','Name c','Name d','Name e']);
  assert.deepEqual(avatars.map(n => n.props.imageUrl), [photo('a'),null,null,null,photo('e')]);
  assert.deepEqual(calls, [{ band: 'band-a', ids: ['a','b','c','d','e'] }]);
  assert.ok(control(tree, 'Aprovar entrada')); assert.ok(control(tree, 'Recusar pedido')); f.cleanup();
});

test('failed or hanging avatar reads never block approval/refusal or the loaded list', async () => {
  for (const kind of ['error','hanging']) for (const decision of ['approved','rejected']) {
    let status = 'pending'; const writes = [];
    const f = fixture({ adminRequests: async () => [{ ...request('a'), status }],
      pendingRequestAvatars: () => kind === 'error' ? Promise.reject(Error('photo failed')) : new Promise(() => {}),
      async decide(...args) { writes.push(args); status = decision; }, getRequest: async () => ({ status }),
    });
    f.render(); await settle(); let tree = f.render();
    assert.ok(tree.some(n => n.type === f.Avatar && n.props.imageUrl === null));
    assert.equal(control(tree, 'Aprovar entrada').props.disabled, false);
    control(tree, decision === 'approved' ? 'Aprovar entrada' : 'Recusar pedido').props.onClick();
    tree = f.render(); control(tree, decision === 'approved' ? 'Confirmar aprovação' : 'Confirmar recusa').props.onClick();
    await settle(); tree = f.render();
    assert.deepEqual(writes, [['band-a','a',decision]]);
    assert.ok(tree.some(n => n.props.role === 'status' && typeof n.props.children === 'string'
      && n.props.children.includes(decision === 'approved' ? 'Entrada aprovada' : 'Pedido recusado')));
    f.cleanup();
  }
});

test('pagination requests only the current 20 IDs and discards late photo responses from previous pages', async () => {
  let resolveFirst; const calls = [];
  const f = fixture({ adminRequests: async (_band, offset) => offset === 0
    ? Array.from({ length: 20 }, (_, i) => request(String(i))) : [request('next')],
    pendingRequestAvatars(_band, ids) { calls.push(ids);
      return ids[0] === '0' ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(new Map([['next', photo('next')]])); },
  });
  f.render(); await settle(); let tree = f.render();
  assert.equal(calls.length, 1); assert.equal(calls[0].length, 20);
  control(tree, 'Próximos pedidos').props.onClick(); f.render(); await settle(); tree = f.render();
  assert.deepEqual(calls[1], ['next']);
  resolveFirst(new Map([['next', photo('stale')]])); await settle(); tree = f.render();
  assert.equal(tree.find(n => n.type === f.Avatar).props.imageUrl, photo('next'));
  assert.equal(control(tree, 'Pedidos anteriores').props.disabled, false); f.cleanup();
});

test('own requests and empty received pages never load applicant photos', async () => {
  for (const bandId of [undefined, 'band-a']) {
    let photos = 0;
    const f = fixture({ ownRequests: async () => [request('own')], adminRequests: async () => [],
      pendingRequestAvatars: async () => { photos++; return new Map(); } }, bandId);
    f.render(); await settle(); assert.equal(f.render().some(n => n.type === f.Avatar), false);
    assert.equal(photos, 0); f.cleanup();
  }
});

test('late avatars from a previous band cannot replace the current band images', async () => {
  let finishPrevious;
  const f = fixture({ adminRequests: async band => [request('same-id', band)],
    pendingRequestAvatars: band => band === 'band-a'
      ? new Promise(resolve => { finishPrevious = resolve; })
      : Promise.resolve(new Map([['same-id', photo('band-b')]])),
  });
  f.render(); await settle();
  f.render('band-b'); await settle();
  assert.equal(f.render('band-b').find(n => n.type === f.Avatar).props.imageUrl, photo('band-b'));
  finishPrevious(new Map([['same-id', photo('band-a')]])); await settle();
  assert.equal(f.render('band-b').find(n => n.type === f.Avatar).props.imageUrl, photo('band-b'));
  f.cleanup();
});
