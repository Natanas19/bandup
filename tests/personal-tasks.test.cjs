/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { test } = require('node:test');

function loader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, Date, Intl, require(name) {
      if (name in overrides) return overrides[name];
      if (name === 'next/link') return { __esModule: true, default: () => null };
      if (name === 'next/navigation') return { notFound() { throw Error('not-found'); } };
      if (name.startsWith('@/')) {
        const base = 'src/' + name.slice(2);
        return load([base + '.ts', base + '.tsx'].find(file => fs.existsSync(path.join(__dirname, '..', file))));
      }
      return require(name);
    } });
    return mod.exports;
  }
  return load;
}
const service = loader()('src/lib/personal-tasks.ts');
const membership = id => ({ band_id: id, role: 'member', band: { id, name: 'Banda ' + id } });
const task = (id, band = 'a', assignee = 'self', due = null) => ({
  id, band_id: band, assigned_to: assignee, title: 'Tarefa ' + id,
  status: 'todo', priority: 'high', due_date: due, created_at: '2026-01-01T00:00:00Z',
});
function fixture(options = {}) {
  const calls = [];
  const client = {
    auth: { async getUser() { calls.push('auth'); return { data: { user: options.signedOut ? null : { id: 'self' } }, error: options.authError }; } },
    from(table) {
      const call = { table, filters: [], orders: [] }; calls.push(call);
      return {
        select(columns, options) { call.columns = columns; call.selectOptions = options; return this; },
        eq(...args) { call.filters.push(args); return this; },
        in(...args) { call.in = args; return this; },
        order(...args) { call.orders.push(args); return this; },
        async range(start, end) {
          call.range = [start, end];
          if (options.throwQuery) throw Error('private transport detail');
          const error = table === 'band_members' ? options.membershipError : options.taskError;
          let rows = table === 'band_members' ? options.memberships ?? [membership('a')] : options.tasks ?? [];
          if (table === 'tasks' && !options.ignoreFilters) {
            rows = rows.filter(row => row.assigned_to === 'self' && call.in[1].includes(row.band_id));
            rows = [...rows].sort((a, b) => {
              if (a.due_date !== b.due_date) return a.due_date === null ? 1 : b.due_date === null ? -1 : a.due_date.localeCompare(b.due_date);
              return b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
            });
          }
          return { data: error ? null : rows.slice(start, end + 1), error, count: table === 'tasks' ? rows.length : null };
        },
      };
    },
  };
  return { client, calls };
}
test('empty tasks and no memberships produce honest empty results; no bands skips task query', async () => {
  for (const options of [{}, { memberships: [] }]) {
    const f = fixture(options), result = await service.loadPersonalTasks(f.client);
    assert.equal(result.tasks.length, 0); assert.equal(result.hasMore, false); assert.equal(result.totalCount, 0);
    assert.equal(f.calls.filter(c => c.table === 'tasks').length, options.memberships ? 0 : 1);
  }
});
test('multiple bands return only tasks assigned to current user, preserving band names and scoped queries', async () => {
  const f = fixture({ memberships: [membership('a'), membership('b')],
    tasks: [task('own-a'), task('own-b', 'b'), task('other', 'a', 'other'), task('unassigned', 'a', null), task('outside', 'c')] });
  const result = await service.loadPersonalTasks(f.client);
  assert.deepEqual(Array.from(result.tasks, r => [r.id, r.bandName]), [['own-a', 'Banda a'], ['own-b', 'Banda b']]);
  const members = f.calls.find(c => c.table === 'band_members'), query = f.calls.find(c => c.table === 'tasks');
  assert.deepEqual(members.filters, [['user_id', 'self']]);
  assert.deepEqual(query.filters, [['assigned_to', 'self']]);
  assert.deepEqual(Array.from(query.in[1]), ['a', 'b']);
  assert.equal(query.in[0], 'band_id'); assert.doesNotMatch(query.columns, /event_id|created_by/);
});
test('invalid memberships and out-of-scope returned tasks never become visible', async () => {
  const f = fixture({ memberships: [{ ...membership('a'), role: 'invalid' }, { ...membership('b'), band: null }], tasks: [task('hidden')] });
  assert.equal((await service.loadPersonalTasks(f.client)).tasks.length, 0);
  for (const row of [task('other', 'a', 'other'), task('outside', 'z')]) {
    await assert.rejects(service.loadPersonalTasks(fixture({ tasks: [row], ignoreFilters: true }).client), /confirmar o acesso/);
  }
});

test('authentication, membership, RLS and transport failures reject rather than returning empty lists', async () => {
  for (const options of [{ signedOut: true }, { authError: { message: 'secret' } },
    { membershipError: { code: '42501' } }, { taskError: { code: '42501' } }, { throwQuery: true }]) {
    const f = fixture(options);
    await assert.rejects(service.loadPersonalTasks(f.client));
    if (options.signedOut || options.authError) assert.equal(f.calls.length, 1);
  }
});
test('deadline order puts undated tasks last with stable creation/id ties and bounded pagination', async () => {
  const rows = [task('z'), task('b', 'a', 'self', '2026-12-02'), task('a', 'a', 'self', '2026-12-01'), task('y')];
  const f = fixture({ tasks: rows });
  assert.deepEqual(Array.from((await service.loadPersonalTasks(f.client)).tasks, r => r.id), ['a', 'b', 'y', 'z']);
  const query = f.calls.find(c => c.table === 'tasks');
  assert.equal(query.orders[0][0], 'due_date'); assert.equal(query.orders[0][1].nullsFirst, false);
  assert.equal(query.orders[1][0], 'created_at'); assert.equal(query.orders[1][1].ascending, false);
  assert.equal(query.orders[2][0], 'id'); assert.deepEqual(query.range, [0, 50]);
  const many = fixture({ tasks: Array.from({ length: 51 }, (_, i) => task(String(i).padStart(3, '0'))) });
  const first = await service.loadPersonalTasks(many.client), second = await service.loadPersonalTasks(many.client, 50);
  assert.equal(first.tasks.length, 50); assert.equal(first.hasMore, true);
  assert.equal(first.totalCount, 51);
  assert.equal(second.tasks.length, 1); assert.equal(second.hasMore, false);
  assert.equal(second.totalCount, 51);
  assert.equal(many.calls.find(c => c.table === 'tasks').selectOptions.count, 'exact');
});
test('membership pagination includes bands beyond the first page; bad offsets never call Auth', async () => {
  const f = fixture({ memberships: Array.from({ length: 201 }, (_, i) => membership(String(i))), tasks: [task('last', '200')] });
  assert.equal((await service.loadPersonalTasks(f.client)).tasks[0].bandName, 'Banda 200');
  assert.equal(f.calls.filter(c => c.table === 'band_members').length, 2);
  const blocked = fixture(); await assert.rejects(service.loadPersonalTasks(blocked.client, -1)); assert.equal(blocked.calls.length, 0);
});
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
async function settle() { for (let i = 0; i < 8; i++) await new Promise(setImmediate); }
function ui(read) {
  const states = [], effects = []; let cursor = 0;
  const load = loader({
    react: { ...React, useEffect: fn => { effects[0] ??= fn; }, useState(initial) {
      const index = cursor++; if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    } },
    '@/lib/personal-tasks': { ...service, loadPersonalTasks: read },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({}) },
  });
  const Component = load('src/components/personal-tasks.tsx').default;
  const render = () => { cursor = 0; return nodes(Component()); };
  render();
  return { render, start: () => effects[0](), states };
}
test('personal list renders loading, empty, responsive cards and the correct band destination', async () => {
  const empty = ui(async () => ({ tasks: [], hasMore: false }));
  assert.ok(empty.render().some(n => n.props?.role === 'status'));
  const dispose = empty.start(); await settle();
  assert.ok(empty.render().some(n => n.props?.children === 'Nenhuma tarefa atribuída a você')); dispose();
  const h = ui(async () => ({ tasks: [{ ...task('one', 'b'), bandName: 'Banda b' }], hasMore: true }));
  const cleanup = h.start(); await settle(); const tree = h.render();
  assert.ok(tree.some(n => n.props?.href === '/bandas/b/tarefas'));
  assert.ok(tree.some(n => n.props?.children === 'Banda b'));
  assert.ok(tree.some(n => n.props?.children === 'Sem prazo'));
  assert.ok(tree.some(n => n.props?.className?.includes('sm:grid-cols-3')));
  assert.equal(tree.some(n => n.type === 'form'), false);
  tree.find(n => n.props?.children === 'Próximas').props.onClick(); assert.equal(h.states[2], 50);
  cleanup();
});
test('UI reports failures without leaking raw errors, supports retry and ignores late responses', async () => {
  const h = ui(async () => { throw Error('private transport detail'); });
  const cleanup = h.start(); await settle();
  const tree = h.render();
  assert.ok(tree.some(n => n.props?.role === 'alert'));
  assert.equal(JSON.stringify(tree).includes('private transport detail'), false);
  tree.find(n => n.props?.children === 'Tentar novamente').props.onClick(); assert.equal(h.states[3], 1); cleanup();
  let finish; const delayed = ui(() => new Promise(resolve => { finish = resolve; }));
  const dispose = delayed.start(); dispose(); finish({ tasks: [task('late')], hasMore: false }); await settle();
  assert.ok(delayed.render().some(n => n.props?.role === 'status'));
});
test('dashboard tasks and agenda routes render their personal read components', async () => {
  const load = loader(); const Page = load('src/app/dashboard/[section]/page.tsx').default;
  const tasks = await Page({ params: Promise.resolve({ section: 'tarefas' }) });
  assert.equal(tasks.type, load('src/components/personal-tasks.tsx').default);
  const agenda = await Page({ params: Promise.resolve({ section: 'agenda' }) });
  assert.equal(agenda.type.name, 'PersonalAgenda');
});
