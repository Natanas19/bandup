/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const React = require('react');

function loadBandSearch() {
  const file = path.join(__dirname, '../src/lib/band-search.ts');
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, require(name) {
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

function componentFixture(eligibility) {
  const state = { slots: [], cursor: 0, effects: [], scheduled: [] };
  const api = { async entryEligibility() { return eligibility; } };
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
    useEffect(fn) {
      const index = state.cursor++;
      if (!state.effects[index]) state.scheduled.push(() => { state.effects[index] = fn(); });
    },
  };
  const file = path.join(__dirname, '../src/components/band-search.tsx');
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return {
      jsx: (type, props, key) => React.createElement(type, { ...props, key }),
      jsxs: (type, props, key) => React.createElement(type, { ...props, key }),
      Fragment: React.Fragment,
    };
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
    if (name === '@/components/display-name-settings') return { __esModule: true, default: () => null };
    if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => ({ auth: {
      async getUser() { return { data: { user: { user_metadata: { display_name: 'Musician' } } }, error: null }; },
    } }) };
    if (name === '@/lib/band-entry') return { BAND_ENTRY_BACKEND_VALIDATED: true, entryError: () => ({ message: 'Falha' }),
      createBandEntryService: () => api };
    if (name === '@/lib/band-search') return { defaultEntryMessage: () => '',
      async searchBandNames() { return { matches: [{ band_id: id(77), name: 'Band' }], next: null }; },
      async registerEntryRequest() { throw new Error('Should not submit in this test'); } };
    if (name === '@/lib/display-name') return { normalizeDisplayName: value => value };
    throw new Error(`Unexpected import ${name}`);
  } });
  const component = mod.exports.default;
  function render() {
    state.cursor = 0;
    const tree = component();
    while (state.scheduled.length) state.scheduled.shift()();
    return tree;
  }
  return { render };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };

for (const eligibility of ['member', 'pending']) {
  test(`band search explains ${eligibility} status and hides the entry form`, async () => {
    const h = componentFixture(eligibility);
    let tree = nodes(h.render());
    await settle(); tree = nodes(h.render());
    tree.find(node => node.type === 'input' && node.props.id === 'band-search-name').props.onChange({ target: { value: 'band' } });
    tree = nodes(h.render());
    tree.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    await settle(); tree = nodes(h.render());
    tree.find(node => node.type === 'button' && node.props.children === 'Selecionar banda').props.onClick();
    await settle(); tree = nodes(h.render());
    assert.ok(tree.some(node => node.props?.role === 'status' && String(node.props.children).includes(
      eligibility === 'member' ? 'Você já faz parte' : 'solicitação pendente')));
    assert.equal(tree.some(node => node.type === 'textarea' && node.props.id === 'entry-draft'), false);
    if (eligibility === 'member') assert.ok(tree.some(node => node.props?.href === `/bandas/${id(77)}`
      && node.props.children === 'Acessar banda'));
  });
}
