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
      if (name === '@/lib/personal-tasks') return { PersonalTasksLoadError: class PersonalTasksLoadError extends Error {}, loadPersonalTasks: async () => ({ tasks: [], hasMore: false, totalCount: 0 }) };
      if (name === '@/lib/personal-agenda') return { PersonalAgendaLoadError: class PersonalAgendaLoadError extends Error {}, loadPersonalAgenda: async () => [] };
      if (name === '@/lib/date-time') return { formatTaskDate: value => value };
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
test('empty personal dashboard offers band creation, discovery and personal summaries', () => {
  const h = harness('src/app/dashboard/page.tsx', null, { 0: { id: 'u' }, 1: [], 2: false });
  const tree = nodes(h.render());
  for (const href of ['/bandas/nova', '/descobrir', '/dashboard/tarefas']) assert.ok(tree.some(n => n.props?.href === href));
  assert.equal(tree.filter(n => n.props?.href === '/dashboard/tarefas').length, 1);
  assert.ok(tree.some(n => n.type === 'h2' && n.props.children === 'Seu espaço começa com uma banda'));
  assert.ok(tree.some(n => n.type === 'h2' && n.props.children === 'Minhas tarefas'));
  assert.ok(tree.some(n => n.type === 'h2' && n.props.children === 'Minha agenda'));
  assert.equal(tree.some(n => n.props?.['aria-pressed'] !== undefined), false);
  assert.equal(h.calls.length, 0);
});

test('existing memberships retain access to their list and summaries', () => {
  const h = harness('src/app/dashboard/page.tsx', null, {
    0: { id: 'u' }, 1: [{ role: 'admin', band: { id: 'b', name: 'Band' } }], 2: false,
  });
  const tree = nodes(h.render());
  assert.ok(tree.some(n => n.props?.href === '/dashboard/bandas'));
  assert.ok(tree.some(n => n.props?.href === '/dashboard/agenda'));
  assert.ok(tree.some(n => n.props?.href === '/dashboard/tarefas'));
  assert.equal(tree.some(n => n.props?.['aria-pressed'] !== undefined), false);
});

test('overview renders supplied personal task and agenda data with real band labels and counts', () => {
  const h = harness('src/app/dashboard/page.tsx', null, {
    0: { id: 'u', user_metadata: { display_name: 'Ana' } },
    1: [{ role: 'member', band: { id: 'band-a', name: 'Banda Aurora' } }],
    2: false,
    4: [{ id: 'task-1', band_id: 'band-a', bandName: 'Banda Aurora', title: 'Preparar repertório', due_date: '2099-12-31' }],
    5: 8,
    7: [{ id: 'event-1', band_id: 'band-a', bandName: 'Banda Aurora', title: 'Ensaio geral', start_at: '2099-12-31T19:30:00Z', location: 'Sala 2' }],
  });
  const tree = nodes(h.render());
  for (const text of ['Boas-vindas, Ana.', 'Preparar repertório', 'Banda Aurora', 'Ensaio geral', 'Sala 2']) {
    assert.ok(tree.some(n => n.props?.children === text), text);
  }
  assert.ok(tree.some(n => n.type === 'span' && n.props.children === 8));
  assert.ok(tree.some(n => n.props?.href === '/bandas/band-a/tarefas'));
  assert.ok(tree.some(n => n.props?.href === '/bandas/band-a/agenda'));
});

test('empty dashboard describes discovery availability accurately in demo and blocked environments', () => {
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

test('personal overview links to real bands through the bands page', () => {
  const h = harness('src/app/dashboard/page.tsx', null, {
    0: { id: 'u' }, 1: [
      { role: 'member', band: { id: 'a', name: 'Minha banda', description: 'Descrição existente' } },
      { role: 'admin', band: { id: 'b', name: 'Outra banda', description: null } },
    ], 2: false,
  });
  const tree = nodes(h.render());
  assert.ok(tree.some(n => n.props?.href === '/dashboard/bandas'));
  assert.ok(tree.some(n => n.props?.href === '/dashboard/tarefas'));
  assert.ok(tree.some(n => n.props?.href === '/dashboard/agenda'));
  assert.ok(tree.some(n => n.type === 'h1' && n.props.children === 'Boas-vindas ao seu espaço.'));
  assert.equal(tree.some(n => n.props?.['aria-pressed'] !== undefined), false);
  assert.equal(h.calls.length, 0);
});

test('home hides band navigation and onboarding while loading, signed out or in error', () => {
  for (const state of [{ 2: true }, { 0: null }, { 3: 'Não foi possível carregar suas bandas.' }]) {
    const h = harness('src/app/dashboard/page.tsx', null, {
      0: { id: 'u' }, 1: [{ role: 'admin', band: { id: 'cached', name: 'Cached' } }], 2: false, ...state,
    });
    const tree = nodes(h.render());
  for (const href of ['/dashboard/bandas', '/bandas/nova', '/descobrir']) {
      assert.equal(tree.some(n => n.props?.href === href), false);
    }
    if (state[2]) assert.ok(tree.some(n => n.props?.role === 'status'));
    if (state[0] === null) assert.ok(tree.some(n => n.props?.href === '/login'));
    if (state[3]) assert.ok(tree.some(n => n.props?.role === 'alert'));
    assert.equal(h.calls.length, 0);
  }
});

test('overview links to profile management without duplicate editors and preserves saved identity', () => {
  for (const name of [undefined, 'Ana Silva']) {
    const h = harness('src/app/dashboard/page.tsx', null, {
      0: { id: 'u', user_metadata: { display_name: name, existing: 'preserved' } },
      1: [{ role: 'admin', band: { id: 'b', name: 'My band' } }], 2: false,
    });
    const tree = nodes(h.render());
    assert.ok(tree.some(n => n.props?.href === '/dashboard/perfil'));
    assert.equal(tree.some(n => typeof n.props?.onSaved === 'function'), false);
    assert.equal(tree.some(n => n.props?.userId === 'u' && n.props?.key?.startsWith('avatar:')), false);
    assert.ok(tree.some(n => n.props?.href === '/dashboard/tarefas'));
    assert.equal(h.states[0].user_metadata.existing, 'preserved');
    assert.equal(h.calls.length, 0);
  }
  const source = fs.readFileSync('src/app/dashboard/page.tsx', 'utf8');
  assert.doesNotMatch(source, /AvatarCompletion|DisplayNameSettings/);
});
