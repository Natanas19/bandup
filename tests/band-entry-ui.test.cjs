/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

function load(file, overrides = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, require(name) {
    if (name in overrides) return overrides[name];
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (name === '@/components/band-entry-panel') return load('src/components/band-entry-panel.tsx');
    if (name === '@/components/band-search') return load('src/components/band-search.tsx', overrides);
    if (name === '@/lib/band-search') return load('src/lib/band-search.ts', overrides);
    if (name === '@/components/display-name-settings') return { __esModule: true, default: () => null };
    if (name === '@/components/band-entry-flow') return load('src/components/band-entry-flow.tsx', overrides);
    if (name === '@/lib/band-entry') return load('src/lib/band-entry.ts');
    if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient() { throw Error('Blocked UI must not initialize a client'); } };
    if (name === '@/components/theme-selector') return { __esModule: true, default: () => null };
    if (name === '@/lib/display-name') {
      const names = { exports: {} };
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/display-name.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText, { module: names, exports: names.exports });
      return names.exports;
    }
    return require(name);
  } });
  return mod.exports;
}

test('all discovery and administration states render with mutations disabled', () => {
  const Panel = load('src/components/band-entry-panel.tsx').default;
  for (const admin of [false, true]) for (const state of ['loading', 'empty', 'error', 'unavailable']) {
    const html = renderToStaticMarkup(React.createElement(Panel, { admin, state }));
    const buttons = html.match(/<button\b[^>]*>/g) || [];
    assert.equal(buttons.length, admin ? 2 : 1);
    assert.ok(buttons.every(button => button.includes('disabled=""') && button.includes('aria-describedby=')));
    assert.ok(html.includes('nenhuma solicitação pode ser enviada ou decidida'));
    assert.ok(html.includes(state === 'error' ? 'role="alert"' : 'role="status"'));
    assert.ok(html.includes(`aria-busy="${state === 'loading'}"`));
    if (!admin) assert.match(html, /<input[^>]*disabled=""/);
    if (state === 'empty') assert.ok(html.includes(admin ? 'Nenhuma solicitação pendente' : 'Nenhuma banda encontrada'));
  }
});

test('default route shows unavailability, never a fabricated list or success', () => {
  const Page = load('src/app/descobrir/page.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.ok(html.includes('A descoberta está chegando'));
  assert.ok(html.includes('href="/dashboard"'));
  assert.ok(html.includes('href="/bandas/nova"'));
  assert.equal(html.includes('Nenhuma banda encontrada'), false);
  assert.equal(html.includes('Solicitação enviada'), false);
});

test('feature UI has no backend reads, writes, persistence or mutation handlers', () => {
  for (const file of ['src/components/band-entry-panel.tsx', 'src/app/descobrir/page.tsx',
    'src/app/descobrir/loading.tsx', 'src/app/descobrir/error.tsx']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /supabase|fetch\(|\.rpc\(|localStorage|sessionStorage|onSubmit|"use server"/);
    if (!file.endsWith('error.tsx')) assert.doesNotMatch(source, /onClick/);
  }
});

test('discovery route uses existing private session boundary', () => {
  const { getPrivateScope } = load('src/lib/private-session.ts');
  assert.equal(getPrivateScope('/descobrir'), '/descobrir');
  assert.equal(getPrivateScope('/bandas/b/membros'), 'band:b');
});

const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
function flowHarness(api, bandId, extra = {}) {
  const slots = [], effects = []; let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const slot = cursor++; if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = cursor++; return slots[slot] ??= { current: initial }; },
    useCallback(fn) { return fn; }, useEffect(fn) { if (!effects.length) effects.push(fn); },
  };
  const contract = load('src/lib/band-entry.ts');
  const Flow = load('src/components/band-entry-flow.tsx', {
    react: hooks, '@/lib/band-entry': { ...contract, BAND_ENTRY_BACKEND_VALIDATED: true, createBandEntryService: () => api },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { user_metadata: { display_name: "Musician" } } } }) } }) },
  }).default;
  const wrapper = Flow({ bandId, ...extra });
  const render = () => { cursor = 0; return wrapper.type(wrapper.props); };
  render(); const cleanup = effects[0]();
  return { render, cleanup, html: () => renderToStaticMarkup(render()), key: wrapper.key };
}
function findElements(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => findElements(child, predicate));
  return [...(predicate(node) ? [node] : []), ...findElements(node.props?.children, predicate)];
}

test('history never discovers bands automatically, even after refresh', async () => {
  let reads = 0;
  const h = flowHarness({ ownRequests: async () => { reads++; return []; },
    discover: async () => { throw Error('Directory must require explicit search'); } });
  await settle();
  assert.match(h.html(), /Meus pedidos/);
  assert.equal(findElements(h.render(), n => n.type === 'form').length, 0);
  findElements(h.render(), n => n.type === 'button' && n.props.children === 'Atualizar dados e permissões')[0].props.onClick();
  await settle();
  assert.equal(reads, 2);
  h.cleanup();
});

test('cancel confirmation updates history; duplicate clicks cannot issue duplicate writes', async () => {
  let status = 'pending', writes = 0, release;
  const api = { ownRequests: async () => [{ id: 'r', band_id: 'b', status, requested_at: '2026-01-01T00:00:00Z' }],
    discover: async () => [], cancel: async () => { writes++; await new Promise(resolve => { release = resolve; }); status = 'cancelled'; },
    getRequest: async () => ({ status }) };
  const h = flowHarness(api); await settle();
  const cancel = findElements(h.render(), n => n.type === 'button' && n.props.children === 'Cancelar pedido')[0];
  cancel.props.onClick(); cancel.props.onClick(); await settle();
  assert.equal(writes, 1); release(); await settle();
  assert.match(h.html(), /Pedido cancelado/); assert.match(h.html(), /Cancelado/);
  h.cleanup();
});

test('revoked administrator loses request data and receives no approval feedback', async () => {
  let revoked = false, writes = 0;
  const api = { adminRequests: async () => {
    if (revoked) throw { code: '42501' };
    return [{ id: 'r', applicant_name: 'Private applicant', status: 'pending', requested_at: '2026-01-01T00:00:00Z' }];
  }, getDiscovery: async () => null, decide: async () => { writes++; revoked = true; throw { code: '42501' }; } };
  const h = flowHarness(api, 'band-a'); await settle();
  findElements(h.render(), n => n.type === 'button' && n.props.children === 'Aprovar entrada')[0].props.onClick();
  await settle();
  assert.equal(writes, 1);
  assert.doesNotMatch(h.html(), /Private applicant|Entrada aprovada/);
  assert.match(h.html(), /não tem permissão/);
  h.cleanup();
});

test('confirmed approval refreshes members and band scope changes remount the flow', async () => {
  let status = 'pending', updated = 0;
  const api = { adminRequests: async () => [{ id: 'r', applicant_name: 'Name', status, requested_at: '2026-01-01T00:00:00Z' }],
    getDiscovery: async () => null, decide: async () => { status = 'approved'; }, getRequest: async () => ({ status }) };
  const h = flowHarness(api, 'band-a', { onMembersChanged: () => updated++ }); await settle();
  findElements(h.render(), n => n.type === 'button' && n.props.children === 'Aprovar entrada')[0].props.onClick();
  await settle();
  assert.equal(updated, 1); assert.match(h.html(), /Entrada aprovada/);
  assert.equal(h.key, 'band-a');
  h.cleanup();
});

test('member administration loads requests without discovery settings and preserves approve/reject controls', async () => {
  for (const decision of ['approved', 'rejected']) {
    let status = 'pending', updated = 0;
    const calls = [];
    const api = {
      adminRequests: async bandId => {
        calls.push(['requests', bandId]);
        return [{ id: 'r', applicant_name: 'Musician', status, requested_at: '2026-01-01T00:00:00Z' }];
      },
      getDiscovery: async () => { throw Error('Members must not depend on discovery settings'); },
      setDiscovery: async () => { throw Error('Members must not mutate discovery settings'); },
      discover: async () => { throw Error('Members must not load the directory'); },
      decide: async (...args) => { calls.push(['decide', ...args]); status = decision; },
      getRequest: async (...args) => { calls.push(['confirm', ...args]); return { status }; },
    };
    const h = flowHarness(api, 'band-a', { onMembersChanged: () => updated++ }); await settle();
    const html = h.html();
    assert.match(html, /Pedidos recebidos/);
    assert.match(html, /Musician/);
    assert.doesNotMatch(html, /Descoberta da banda|Nome para descoberta|Aceitar solicitações de entrada|Salvar descoberta|<form|<textarea|type="checkbox"/);
    for (const label of ['Aprovar entrada', 'Recusar pedido']) {
      const control = findElements(h.render(), n => n.type === 'button' && n.props.children === label)[0];
      assert.ok(control); assert.match(control.props.className, /min-h-11/);
    }
    findElements(h.render(), n => n.type === 'button' && n.props.children === (decision === 'approved' ? 'Aprovar entrada' : 'Recusar pedido'))[0].props.onClick();
    await settle();
    assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['decide', 'band-a', 'r', decision])));
    assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['confirm', 'r', 'band-a'])));
    assert.equal(updated, decision === 'approved' ? 1 : 0);
    assert.match(h.html(), decision === 'approved' ? /Entrada aprovada/ : /Pedido recusado/);
    h.cleanup();
  }
});

test('a successful RPC without matching persisted state never reports approval', async () => {
  const api = { adminRequests: async () => [{ id: 'r', applicant_name: 'Name', status: 'pending', requested_at: '2026-01-01T00:00:00Z' }],
    getDiscovery: async () => null, decide: async () => {}, getRequest: async () => ({ status: 'pending' }) };
  let updated = 0;
  const h = flowHarness(api, 'band-a', { onMembersChanged: () => updated++ }); await settle();
  findElements(h.render(), n => n.type === 'button' && n.props.children === 'Aprovar entrada')[0].props.onClick();
  await settle();
  assert.equal(updated, 0); assert.doesNotMatch(h.html(), /Entrada aprovada/);
  assert.match(h.html(), /Não foi possível confirmar o resultado/);
  h.cleanup();
});

test('late loading results are discarded after leaving the page', async () => {
  let resolve;
  const api = { ownRequests: () => new Promise(done => { resolve = done; }), discover: async () => [] };
  const h = flowHarness(api);
  await settle();
  h.cleanup(); resolve([]); await settle();
  assert.match(h.html(), /Carregando/);
  assert.doesNotMatch(h.html(), /Meus pedidos/);
});
