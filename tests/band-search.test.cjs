/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadBandSearch() {
  const file = path.join(__dirname, '../src/lib/band-search.ts');
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, process: { env: {} }, require(name) {
    if (name === '@/lib/display-name') return { normalizeDisplayName: value =>
      typeof value === 'string' && value.trim() ? value.trim() : null };
    throw new Error(`Unexpected import ${name}`);
  } });
  return mod.exports;
}

const id = suffix => `a0000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;

test('band search matches names without case/diacritic sensitivity and IDs exactly across pages', async () => {
  const { searchBandNames } = loadBandSearch();
  const pages = [
    Array.from({ length: 20 }, (_, index) => ({ band_id: id(index + 1), name: `Banda ${index + 1}` })),
    Array.from({ length: 5 }, (_, index) => ({ band_id: id(index + 21), name: index === 4 ? 'Música Azul' : `Banda ${index + 21}` })),
  ];
  const cursors = [];
  const api = { async discover(after) {
    cursors.push(after);
    return after === null ? pages[0] : pages[1];
  } };

  const byName = await searchBandNames(api, 'musica azul');
  assert.deepEqual(JSON.parse(JSON.stringify(byName.matches)), [{ band_id: id(25), name: 'Música Azul' }]);
  assert.equal(byName.next, null);
  cursors.length = 0;
  const byId = await searchBandNames(api, id(25).toUpperCase());
  assert.deepEqual(JSON.parse(JSON.stringify(byId.matches)), [{ band_id: id(25), name: 'Música Azul' }]);
  assert.deepEqual(cursors, [null, id(20)]);
});

test('band search returns a continuation cursor after a bounded five-page scan', async () => {
  const { searchBandNames } = loadBandSearch();
  const cursors = [];
  const api = { async discover(after) {
    cursors.push(after);
    const start = after === null ? 1 : Number(after.slice(-12)) + 1;
    return Array.from({ length: 20 }, (_, index) => ({ band_id: id(start + index), name: `Banda ${start + index}` }));
  } };
  const result = await searchBandNames(api, 'banda');
  assert.equal(result.matches.length, 100);
  assert.equal(result.next, id(100));
  assert.equal(cursors.length, 5);
});

test('an existing pending request is reported without issuing another request', async () => {
  const { registerEntryRequest } = loadBandSearch();
  let writes = 0;
  const result = await registerEntryRequest({
    async pendingRequest() { return { id: 'existing' }; },
    async request() { writes++; return 'new'; },
    async getRequest() { throw new Error('must not run'); },
  }, id(7), 'Musician');
  assert.equal(result, 'pending');
  assert.equal(writes, 0);
});

function componentFixture(eligibility, options = {}) {
  const state = { slots: [], cursor: 0, effects: [], scheduled: [], writes: 0, focus: null, checks: 0, eligibilityChecks: [], targets: [] };
  const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const api = { discover: options.discover, async entryEligibility(band) { state.eligibilityChecks.push(band); return options.eligibility ? options.eligibility(band) : eligibility; }, async pendingRequest() { state.checks++; return options.persisted ?? null; } };
  const hooks = { ...React,
    useState(initial) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = initial;
      return [state.slots[index], value => {
        state.slots[index] = typeof value === 'function' ? value(state.slots[index]) : value;
      }];
    },
    useRef(initial) {
      const index = state.cursor++;
      return state.slots[index] ??= { current: initial };
    },
    useEffect(fn, deps) {
      const index = state.cursor++;
      const old = state.effects[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) state.scheduled.push(() => {
        old?.cleanup?.(); state.effects[index] = { deps, cleanup: fn() };
      });
    },
  };
  const file = path.join(__dirname, '../src/components/band-search.tsx');
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, process: { env: {} },
    FormData: class { constructor(form) { this.form = form; } get(key) { return this.form[key] ?? null; } },
    require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (name === '@/components/profile-avatar') return { __esModule: true, default: () => null };
    if (name === '@/lib/public-band-data') return { safeBandLogo: () => null };
    if (name === '@/components/display-name-settings') return { __esModule: true, default: () => null };
    if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => ({ auth: {
      async getUser() { return { data: { user: { user_metadata: { display_name: 'Musician' } } }, error: null }; },
    } }) };
    if (name === '@/lib/band-entry') return { BAND_ENTRY_BACKEND_VALIDATED: true, entryError: () => ({ message: 'Falha' }),
      createBandEntryService: () => api };
    if (name === '@/lib/band-search') return { defaultEntryMessage: () => '',
      searchBandNames: options.discover ? loadBandSearch().searchBandNames
        : async () => ({ matches: options.bands ?? [{ band_id: id(77), name: 'Band' }], next: null }),
      async registerEntryRequest(_api, band) { state.writes++; state.targets.push(band); return options.submit ? options.submit() : 'created'; } };
    if (name === '@/lib/display-name') return { normalizeDisplayName: value => value };
    throw new Error(`Unexpected import ${name}`);
  } });
  const component = mod.exports.default;
  function render() {
    state.cursor = 0;
    const tree = component({ headerFormId: options.headerFormId });
    for (const node of nodes(tree)) {
      if (node.props?.ref) node.props.ref.current = node.type === 'dialog' ? modal : {
        focus() { state.focus = node.type; },
      };
    }
    while (state.scheduled.length) state.scheduled.shift()();
    return tree;
  }
  return { render, state, modal };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };

test('compact global results reuse explicit band-only search, pagination, empty and error states', async () => {
  const cursors = [];
  let failure = false;
  const h = componentFixture('eligible', { headerFormId: 'header-search', async discover(after) {
    cursors.push(after);
    if (failure) throw new Error('Unavailable');
    const start = after ? Number(after.slice(-12)) + 1 : 1;
    return Array.from({ length: start > 100 ? 1 : 20 }, (_, index) => ({
      band_id: id(start + index), name: start > 100 ? 'Banda Horizonte' : `Grupo ${start + index}`,
    }));
  } });
  h.render(); await settle();
  assert.deepEqual(cursors, []);
  const submit = term => nodes(h.render()).find(node => node.props?.id === 'header-search').props.onSubmit({
    preventDefault() {}, currentTarget: { 'band-query': term },
  });
  submit('Horizonte');
  assert.match(renderToStaticMarkup(h.render()), /Pesquisando bandas cadastradas/);
  await settle();
  assert.equal(cursors.length, 5);
  const more = nodes(h.render()).find(node => node.props?.children === 'Pesquisar mais bandas');
  assert.ok(more);
  more.props.onClick();
  await settle();
  const html = renderToStaticMarkup(h.render());
  assert.match(html, /Banda Horizonte[\s\S]*>Banda<\//);
  assert.doesNotMatch(html, />Músico<\/|Grupo 1/);
  assert.equal(h.state.writes, 0);
  submit('inexistente');
  await settle();
  nodes(h.render()).find(node => node.props?.children === 'Pesquisar mais bandas').props.onClick();
  await settle();
  assert.match(renderToStaticMarkup(h.render()), /Nenhuma banda encontrada/);
  failure = true;
  submit('Horizonte');
  await settle();
  assert.match(renderToStaticMarkup(h.render()), /role="alert"[^>]*>Falha/);
});

async function openEntry(h) {
  h.render(); await settle();
  nodes(h.render()).find(n => n.type === 'input').props.onChange({ target: { value: 'band' } });
  nodes(h.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle();
  nodes(h.render()).find(n => n.props?.children === 'Solicitar entrada').props.onClick();
  await settle();
  return nodes(h.render());
}

test('entry modal opens above the page, focuses draft, cancels and restores focus without writing', async () => {
  const h = componentFixture('eligible');
  let tree = await openEntry(h);
  assert.equal(h.modal.open, true); assert.equal(h.state.focus, 'textarea');
  const cards = tree.filter(n => n.type === 'article');
  assert.equal(cards.length, 1);
  assert.doesNotMatch(renderToStaticMarkup(cards[0]), /ID da banda|a0000000|Selecionar banda/);
  assert.ok(nodes(cards[0]).some(n => n.props?.children === 'Solicitar entrada'));
  assert.equal(tree.filter(n => n.props?.children === 'Solicitar entrada').length, 1);
  const dialog = tree.find(n => n.type === 'dialog');
  assert.equal(dialog.props['aria-labelledby'], 'entry-confirm-title');
  assert.match(dialog.props.className, /backdrop:|overflow-y-auto/);
  assert.ok(tree.some(n => String(n.props?.children).includes('A mensagem não será enviada')));
  tree.find(n => n.props?.children === 'Cancelar').props.onClick(); h.render();
  assert.equal(h.modal.open, false); assert.equal(h.state.focus, 'button'); assert.equal(h.state.writes, 0);
  nodes(h.render()).find(n => n.props?.children === 'Solicitar entrada').props.onClick(); await settle(); tree = nodes(h.render());
  let prevented = false;
  tree.find(n => n.type === 'dialog').props.onCancel({ preventDefault() { prevented = true; } }); h.render();
  assert.equal(prevented, true); assert.equal(h.modal.open, false); assert.equal(h.state.writes, 0);
});

test('confirm sends once, locks cancel and Escape while loading, and closes only after confirmed success', async () => {
  let resolve;
  const h = componentFixture('eligible', { submit: () => new Promise(done => { resolve = done; }) });
  const tree = await openEntry(h);
  const confirm = tree.find(n => n.props?.children === 'Confirmar pedido sem mensagem');
  confirm.props.onClick(); confirm.props.onClick(); await settle();
  let current = nodes(h.render());
  assert.equal(h.state.writes, 1); assert.equal(h.modal.open, true);
  assert.deepEqual(h.state.targets, [id(77)]);
  assert.ok(current.find(n => n.props?.children === 'Registrando...').props.disabled);
  assert.ok(current.find(n => n.props?.children === 'Cancelar').props.disabled);
  current.find(n => n.type === 'dialog').props.onCancel({ preventDefault() {} }); h.render();
  assert.equal(h.modal.open, true);
  resolve('created'); await settle(); current = nodes(h.render());
  assert.equal(h.modal.open, false); assert.equal(h.state.focus, 'p');
  assert.ok(current.some(n => n.props?.role === 'status' && String(n.props.children).includes('Solicitação registrada')));
});

test('uncertain response keeps modal open and subsequent confirmation only reads, never resends', async () => {
  const options = { submit: async () => { throw new Error('Lost response'); }, persisted: null };
  const h = componentFixture('eligible', options);
  let tree = await openEntry(h);
  tree.find(n => n.props?.children === 'Confirmar pedido sem mensagem').props.onClick(); await settle();
  tree = nodes(h.render()); assert.equal(h.modal.open, true);
  assert.ok(tree.some(n => n.props?.role === 'alert' && String(n.props.children).includes('não foi confirmado')));
  tree.find(n => n.props?.children === 'Verificar pedido').props.onClick(); await settle(); h.render();
  assert.equal(h.state.writes, 1); assert.equal(h.modal.open, true);
  options.persisted = { id: 'existing' };
  nodes(h.render()).find(n => n.props?.children === 'Verificar pedido').props.onClick(); await settle(); h.render();
  assert.equal(h.state.writes, 1); assert.equal(h.modal.open, false); assert.equal(h.state.checks, 2);
});

for (const eligibility of ['member', 'pending']) {
  test(`band search explains ${eligibility} status and hides the entry form`, async () => {
    const h = componentFixture(eligibility);
    let tree = nodes(h.render());
    await settle(); tree = nodes(h.render());
    tree.find(node => node.type === 'input' && node.props.id === 'band-search-name').props.onChange({ target: { value: 'band' } });
    tree = nodes(h.render());
    tree.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await settle(); tree = nodes(h.render());
    tree.find(node => node.type === 'button' && node.props.children === 'Solicitar entrada').props.onClick();
    await settle(); tree = nodes(h.render());
    assert.ok(tree.some(node => node.props?.role === 'status' && String(node.props.children).includes(
      eligibility === 'member' ? 'Você já faz parte' : 'solicitação pendente')));
    assert.equal(tree.some(node => node.type === 'textarea' && node.props.id === 'entry-draft'), false);
    assert.equal(h.modal.open, false);
    assert.equal(h.state.writes, 0);
    assert.ok(tree.find(node => node.type === 'button' && node.props.children ===
      (eligibility === 'member' ? 'Você já é integrante' : 'Pedido pendente')).props.disabled);
    if (eligibility === 'member') assert.ok(tree.some(node => node.props?.href === `/bandas/${id(77)}`
      && node.props.children === 'Acessar banda'));
  });
}

test('duplicate card clicks share one eligibility check; failures never open a modal or send', async () => {
  let reject;
  const h = componentFixture('eligible', { eligibility: () => new Promise((_resolve, fail) => { reject = fail; }) });
  h.render(); await settle();
  nodes(h.render()).find(n => n.type === 'input').props.onChange({ target: { value: 'band' } });
  nodes(h.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await settle();
  const card = nodes(h.render()).find(n => n.props?.children === 'Solicitar entrada');
  card.props.onClick(); card.props.onClick();
  assert.deepEqual(h.state.eligibilityChecks, [id(77)]);
  assert.ok(nodes(h.render()).find(n => n.props?.children === 'Verificando...').props.disabled);
  reject(new Error('Denied')); await settle();
  const tree = nodes(h.render());
  assert.equal(h.modal.open, false); assert.equal(h.state.writes, 0);
  assert.ok(tree.some(n => n.props?.role === 'alert'));
  assert.equal(tree.find(n => n.props?.children === 'Solicitar entrada').props.disabled, false);
});
