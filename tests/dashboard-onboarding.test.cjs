/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');

function harness(file, result, initial = {}) {
  const states = { ...initial }, refs = [], calls = [], effects = [];
  let cursor = 0, refCursor = 0;
  const client = { auth: { signUp: async args => {
    calls.push(args);
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result() : result;
  } } };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, window: { location: { origin: 'http://localhost:3000' } },
    require(name) {
      if (name === 'react') return { ...React,
        useState(value) { const i = cursor++; if (!(i in states)) states[i] = value;
          return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef(value) { const i = refCursor++; return refs[i] ??= { current: value }; },
        useEffect(fn) { effects.push(fn); },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ replace: url => calls.push(url) }) };
      if (name === '@/lib/band-entry') return { BAND_ENTRY_BACKEND_VALIDATED: initial.backendValidated === true };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null };
      if (name === '@/lib/display-name') {
      const names = { exports: {} };
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/display-name.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText, { module: names, exports: names.exports });
      return names.exports;
    }
    return require(name);
    },
  });
  return { states, calls, render() { cursor = refCursor = 0; return mod.exports.default(); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test('empty band dashboard keeps creation, discovery and personal profile available without the old musician step', () => {
  const h = harness('src/app/dashboard/page.tsx', null, { 0: { id: 'u' }, 1: [], 2: false });
  const tree = nodes(h.render());
  for (const href of ['/bandas/nova', '/descobrir', '/meu-perfil']) assert.ok(tree.some(n => n.props?.href === href));
  assert.equal(tree.filter(n => n.props?.href === '/meu-perfil').length, 1);
  assert.ok(tree.some(n => n.type === 'h2' && n.props.children === 'Suas bandas'));
  assert.equal(tree.some(n => n.props?.['aria-pressed'] !== undefined), false);
  assert.equal(h.calls.length, 0);
});

test('existing memberships preserve band navigation without onboarding choices', () => {
  const h = harness('src/app/dashboard/page.tsx', null, {
    0: { id: 'u' }, 1: [{ role: 'admin', band: { id: 'b', name: 'Band' } }], 2: false,
  });
  const tree = nodes(h.render());
  assert.ok(tree.some(n => n.props?.href === '/bandas/b'));
  assert.ok(tree.some(n => n.props?.href === '/descobrir'));
  assert.equal(tree.some(n => n.props?.['aria-pressed'] !== undefined), false);
});

test('band dashboard describes discovery availability accurately in demo and blocked environments', () => {
  for (const backendValidated of [false, true]) {
    const h = harness('src/app/dashboard/page.tsx', null, { 0: { id: 'u' }, 1: [], 2: false, backendValidated });
    const tree = nodes(h.render());
    const discovery = tree.find(n => n.props?.href === '/descobrir');
    assert.match(discovery.props.className, /min-h-11/);
    const notice = tree.find(n => n.props?.id === discovery.props['aria-describedby']);
    assert.equal(JSON.stringify(notice.props.children).includes('indispon'), !backendValidated);
    assert.equal(tree.filter(n => n.props?.href === '/descobrir').length, 1);
    assert.ok(tree.some(n => n.props?.href === '/bandas/nova'));
  }
});

test('home preserves real memberships, administrator roles and band creation for musicians', () => {
  const h = harness('src/app/dashboard/page.tsx', null, {
    0: { id: 'u' }, 1: [
      { role: 'member', band: { id: 'a', name: 'Minha banda', description: 'Descrição existente' } },
      { role: 'admin', band: { id: 'b', name: 'Outra banda', description: null } },
    ], 2: false, 6: true,
  });
  const tree = nodes(h.render());
  for (const href of ['/bandas/a', '/bandas/b', '/bandas/nova', '/descobrir']) {
    assert.ok(tree.some(n => n.props?.href === href));
  }
  assert.ok(tree.some(n => n.type === 'h3' && n.props.children === 'Minha banda'));
  assert.ok(tree.some(n => n.type === 'span' && n.props.children === 'Membro'));
  assert.ok(tree.some(n => n.type === 'span' && n.props.children === 'Administrador'));
  assert.equal(tree.some(n => n.props?.['aria-pressed'] !== undefined), false);
  assert.equal(h.calls.length, 0);
});

test('home hides band navigation and onboarding while loading, signed out or in error', () => {
  for (const state of [{ 2: true }, { 0: null }, { 5: 'Não foi possível carregar suas bandas.' }]) {
    const h = harness('src/app/dashboard/page.tsx', null, {
      0: { id: 'u' }, 1: [{ role: 'admin', band: { id: 'cached', name: 'Cached' } }], 2: false, ...state,
    });
    const tree = nodes(h.render());
    for (const href of ['/bandas/cached', '/bandas/nova', '/descobrir']) {
      assert.equal(tree.some(n => n.props?.href === href), false);
    }
    if (state[2]) assert.ok(tree.some(n => n.props?.role === 'status'));
    if (state[0] === null) assert.ok(tree.some(n => n.props?.href === '/login'));
    if (state[5]) assert.ok(tree.some(n => n.props?.role === 'alert'));
    assert.equal(h.calls.length, 0);
  }
});

test('dashboard only offers name completion for missing or invalid saved names', () => {
  for (const name of [undefined, null, '', '   ', 'private@example.com', {}, 'Ana Silva']) {
    const h = harness('src/app/dashboard/page.tsx', null, {
      0: { id: 'u', user_metadata: { display_name: name } }, 1: [], 2: false,
    });
    const forms = nodes(h.render()).filter(n => typeof n.props?.onSaved === 'function');
    assert.equal(forms.length, name === 'Ana Silva' ? 0 : 1);
  }
});

test('successful name completion hides the form immediately and keeps band navigation', () => {
  const h = harness('src/app/dashboard/page.tsx', null, {
    0: { id: 'u', user_metadata: { existing: 'preserved' } },
    1: [{ role: 'admin', band: { id: 'b', name: 'Minha banda' } }], 2: false,
  });
  nodes(h.render()).find(n => typeof n.props?.onSaved === 'function').props.onSaved('Ana Silva');
  const tree = nodes(h.render());
  assert.ok(tree.some(n => n.props?.href === '/meu-perfil' && n.props.children === 'Meu Perfil'));
  assert.equal(tree.some(n => typeof n.props?.onSaved === 'function'), false);
  assert.equal(h.states[0].user_metadata.display_name, 'Ana Silva');
  assert.equal(h.states[0].user_metadata.existing, 'preserved');
  for (const href of ['/bandas/b', '/bandas/nova', '/descobrir']) {
    assert.ok(tree.some(n => n.props?.href === href));
  }
  for (const text of ['Suas bandas', 'Criar outra banda', 'Descobrir outras bandas']) {
    assert.ok(tree.some(n => n.props?.children === text));
  }
  assert.equal(h.calls.length, 0);
});
