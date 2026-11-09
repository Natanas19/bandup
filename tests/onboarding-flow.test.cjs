/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { test } = require('node:test');

function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, ...globals, require(name) {
      if (name in overrides) return overrides[name];
      if (name === 'next/link' || name === '@/components/theme-selector' || name === '@/components/display-name-settings') return { __esModule: true, default: () => null };
      if (name.startsWith('@/')) {
        const base = path.join('src', name.slice(2));
        return load([base + '.ts', base + '.tsx'].find(file => fs.existsSync(file)));
      }
      return require(name);
    } });
    return mod.exports;
  }
  return load;
}
const { prepareOnboarding, onboardingKey } = loader()('src/lib/onboarding.ts');
const searchLib = loader()('src/lib/band-search.ts');

function authFixture(id = 'a', metadata = {}) {
  const user = { id, email_confirmed_at: 'date', user_metadata: { display_name: 'Ana Silva', ...metadata } };
  const writes = [];
  return { user, writes, client: { auth: {
    getUser: async () => ({ data: { user }, error: null }),
    updateUser: async args => { writes.push(args); Object.assign(user.user_metadata, args.data); return { data: { user }, error: null }; },
  } } };
}

test('onboarding persists for the current confirmed account and preserves metadata across accesses', async () => {
  const f = authFixture();
  assert.equal(await prepareOnboarding(f.client, 'a'), true);
  assert.equal(await prepareOnboarding(f.client, 'a'), false);
  assert.equal(f.writes.length, 1);
  assert.equal(JSON.stringify(f.writes[0]), JSON.stringify({ data: { [onboardingKey]: true } }));
  assert.equal(f.user.user_metadata.display_name, 'Ana Silva');
  const other = authFixture('b');
  assert.equal(await prepareOnboarding(other.client, 'b'), true);
  assert.equal(other.writes.length, 1);
});

test('wrong account, unconfirmed email, denied and unconfirmed persistence never complete onboarding', async () => {
  const f = authFixture();
  await assert.rejects(prepareOnboarding(f.client, 'other'));
  f.user.email_confirmed_at = null;
  await assert.rejects(prepareOnboarding(f.client, 'a'));
  assert.equal(f.writes.length, 0);
  f.user.email_confirmed_at = 'date';
  for (const result of [{ error: { message: 'secret' } }, { data: { user: f.user } }]) {
    f.client.auth.updateUser = async () => result;
    await assert.rejects(prepareOnboarding(f.client, 'a'));
  }
});

test('empty search makes no directory calls and name search filters authorized pages with accent handling', async () => {
  const calls = [];
  const api = { discover: async after => { calls.push(after); return [{ band_id: '1', name: 'São João' }, { band_id: '2', name: 'Outra' }]; } };
  await assert.rejects(searchLib.searchBandNames(api, '   ')); assert.equal(calls.length, 0);
  const result = await searchLib.searchBandNames(api, 'sao joao');
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].band_id, '1'); assert.equal(result.next, null);
  assert.deepEqual(calls, [null]);
});

test('large directories are searched in bounded batches with a continuation cursor', async () => {
  let calls = 0;
  const api = { discover: async () => Array.from({ length: 20 }, (_, i) => ({ band_id: `${++calls}-${i}`, name: 'Other' })) };
  const result = await searchLib.searchBandNames(api, 'missing');
  assert.equal(calls, 100); assert.equal(result.matches.length, 0); assert.ok(result.next);
});

test('request success needs real readback; existing pending requests and lost responses never repeat writes', async () => {
  let writes = 0, pending = null;
  const api = {
    pendingRequest: async () => pending,
    request: async (...args) => { writes++; assert.deepEqual(args, ['band', 'Ana Silva']); return 'r'; },
    getRequest: async () => ({ id: 'r', band_id: 'band', status: 'pending' }),
  };
  assert.equal(await searchLib.registerEntryRequest(api, 'band', ' Ana Silva '), 'created');
  pending = { id: 'r' };
  assert.equal(await searchLib.registerEntryRequest(api, 'band', 'Ana Silva'), 'pending'); assert.equal(writes, 1);
  pending = null; api.getRequest = async () => null;
  await assert.rejects(searchLib.registerEntryRequest(api, 'band', 'Ana Silva')); assert.equal(writes, 2);
  api.request = async () => { writes++; pending = { id: 'r' }; throw Error('response lost'); };
  assert.equal(await searchLib.registerEntryRequest(api, 'band', 'Ana Silva'), 'pending'); assert.equal(writes, 3);
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function componentHarness(file, overrides, props = {}) {
  const slots = [], refs = [], effects = [], timers = new Map();
  let cursor = 0, refCursor = 0, timerId = 0;
  const Component = loader({ ...overrides, react: { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = refCursor++; return refs[i] ??= { current: initial }; },
    useEffect(fn) { if (!effects.length) effects.push(fn); },
  } }, { window: { setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) } })(file).default;
  const render = () => { cursor = refCursor = 0; return Component({ userId: 'a', children: 'dashboard', ...props }); };
  render();
  return { render, start: () => effects[0](), timers };
}

test('welcome offers three paths once and StrictMode shares the same persistence attempt', async () => {
  const f = authFixture();
  const h = componentHarness('src/components/welcome-onboarding.tsx', { '@/lib/supabase/client': { getSupabaseBrowserClient: () => f.client } });
  const dispose = h.start(); dispose(); const secondDispose = h.start(); await settle();
  const tree = nodes(h.render());
  for (const [label, href] of [['Criar banda', '/bandas/nova'], ['Encontrar banda', '/descobrir'], ['Pular por enquanto', '/meu-perfil']]) {
    assert.ok(tree.some(n => n.props?.children === label && n.props.href === href));
  }
  assert.equal(f.writes.length, 1);
  tree.find(n => n.type === 'button' && n.props.children === 'Ver minhas bandas').props.onClick();
  assert.equal(h.render(), 'dashboard'); secondDispose();
  const returning = componentHarness('src/components/welcome-onboarding.tsx', { '@/lib/supabase/client': { getSupabaseBrowserClient: () => f.client } });
  const cleanup = returning.start(); await settle(); assert.equal(returning.render(), 'dashboard'); cleanup();
});

test('welcome failure shows retry; a timed out attempt never opens stale welcome content', async () => {
  const h = componentHarness('src/components/welcome-onboarding.tsx', { '@/lib/onboarding': { prepareOnboarding: async () => { throw Error('secret'); } }, '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({}) } });
  const dispose = h.start(); await settle();
  assert.ok(nodes(h.render()).some(n => n.props?.role === 'alert'));
  assert.ok(nodes(h.render()).some(n => n.props?.children === 'Tentar novamente'));
  nodes(h.render()).find(n => n.type === 'button' && n.props.children === 'Ver minhas bandas').props.onClick();
  assert.equal(h.render(), 'dashboard'); dispose();
  let finish;
  const delayed = componentHarness('src/components/welcome-onboarding.tsx', { '@/lib/onboarding': { prepareOnboarding: () => new Promise(resolve => { finish = resolve; }) }, '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({}) } });
  const cleanup = delayed.start(); [...delayed.timers.values()][0](); finish(true); await settle();
  assert.ok(nodes(delayed.render()).some(n => n.props?.role === 'alert')); cleanup();
});

function searchHarness(api, enabled = true, props = {}) {
  return componentHarness('src/components/band-search.tsx', {
    '@/lib/band-entry': { BAND_ENTRY_BACKEND_VALIDATED: enabled, createBandEntryService: () => api, entryError: () => ({ message: 'Falha. Atualize os dados antes de tentar novamente.' }) },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { user_metadata: { display_name: 'Ana Silva' } } } }) } }) },
  }, props);
}
test('search starts empty, edits a draft and requires confirmation before recording a real request', async () => {
  let searches = 0, writes = 0, refreshed = 0;
  const api = { discover: async () => { searches++; return [{ band_id: 'band', name: 'Minha banda' }]; },
    entryEligibility: async () => 'eligible',
    pendingRequest: async () => null, request: async () => { writes++; return 'r'; }, getRequest: async () => ({ id: 'r', band_id: 'band', status: 'pending' }) };
  const h = searchHarness(api, true, { onRequestsChanged: () => { refreshed++; } }); const cleanup = h.start(); await settle();
  assert.equal(searches, 0); assert.equal(nodes(h.render()).some(n => n.type === 'article'), false);
  nodes(h.render()).find(n => n.type === 'input').props.onChange({ target: { value: 'Minha' } });
  nodes(h.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await settle();
  nodes(h.render()).find(n => n.props?.children === 'Selecionar banda').props.onClick();
  await settle();
  let tree = nodes(h.render());
  assert.equal(tree.find(n => n.type === 'textarea').props.value, 'Olá! Me chamo Ana Silva e gostaria de participar da sua banda.');
  tree.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Meu rascunho' } });
  tree = nodes(h.render()); tree.filter(n => n.type === 'form')[1].props.onSubmit({ preventDefault() {} });
  assert.equal(writes, 0);
  const confirm = nodes(h.render()).find(n => n.props?.children === 'Confirmar pedido sem mensagem');
  confirm.props.onClick(); confirm.props.onClick(); await settle();
  assert.equal(writes, 1);
  assert.equal(refreshed, 1);
  tree = nodes(h.render());
  assert.ok(tree.some(n => n.props?.href === '/meu-perfil' && n.props.children === 'Ir para Meu Perfil'));
  assert.ok(tree.some(n => n.props?.role === 'status' && JSON.stringify(n.props.children).includes('não foi enviada')));
  cleanup();
});

test('missing Supabase configuration explains unavailability; delayed search responses are discarded on input change', async () => {
  const blocked = searchHarness({ discover: () => { throw Error('must not call'); } }, false);
  const dispose = blocked.start();
  const unavailable = nodes(blocked.render());
  assert.ok(unavailable.some(n => n.props?.role === 'status' && String(n.props.children).includes('NEXT_PUBLIC_SUPABASE_URL')));
  assert.equal(unavailable.some(n => n.type === 'form'), false);
  dispose();
  let finish;
  const h = searchHarness({ discover: () => new Promise(resolve => { finish = resolve; }) });
  const cleanup = h.start(); await settle();
  nodes(h.render()).find(n => n.type === 'input').props.onChange({ target: { value: 'Old' } });
  nodes(h.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  nodes(h.render()).find(n => n.type === 'input').props.onChange({ target: { value: 'New' } });
  finish([{ band_id: 'b', name: 'Old' }]); await settle();
  assert.equal(nodes(h.render()).some(n => n.type === 'article'), false); cleanup();
});


test('repeated band names retain distinct IDs across search batches', async () => {
  const ids = Array.from({ length: 103 }, (_, i) => String(i + 1).padStart(6, '0'));
  const api = { discover: async after => {
    const start = after === null ? 0 : ids.indexOf(after) + 1;
    return ids.slice(start, start + 20).map(band_id => ({ band_id, name: 'Same band name' }));
  } };
  const first = await searchLib.searchBandNames(api, 'same');
  const second = await searchLib.searchBandNames(api, 'same', first.next);
  assert.equal(first.matches.length, 100);
  assert.equal(second.matches.length, 3);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.matches, ...second.matches].map(b => b.band_id)).size, 103);
});


test('exact band ID search works independently of names, ignores case and paginates', async () => {
  const id = 'a0000000-0000-0000-0000-000000000103';
  const ids = Array.from({ length: 103 }, (_, i) => 'a0000000-0000-0000-0000-' + String(i + 1).padStart(12, '0'));
  const api = { discover: async after => {
    const start = after === null ? 0 : ids.indexOf(after) + 1;
    return ids.slice(start, start + 20).map(band_id => ({ band_id, name: 'Unrelated name' }));
  } };
  const first = await searchLib.searchBandNames(api, '  ' + id.toUpperCase() + '  ');
  assert.equal(first.matches.length, 0); assert.ok(first.next);
  const last = await searchLib.searchBandNames(api, id, first.next);
  assert.deepEqual(JSON.parse(JSON.stringify(last.matches)), [{ band_id: id, name: 'Unrelated name' }]);
  assert.equal(last.next, null);
});
