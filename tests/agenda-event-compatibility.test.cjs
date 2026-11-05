/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const event = { id: 'event', title: 'Show', event_type: 'show', start_at: '2099-01-01T12:00:00Z',
  end_at: null, description: null, location: null, created_by: 'user' };
const task = { id: 'task', event_id: 'event', title: 'Soundcheck', status: 'todo', priority: 'high' };

async function loadAgenda({ taskError = null, taskThrows = false, events = [event], signedIn = true, member = true } = {}) {
  const states = [], effects = [], calls = [], cache = new Map();
  let cursor = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: signedIn ? { user: { id: 'user' } } : null }, error: null }) },
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const result = () => {
        if (table === 'tasks' && taskThrows) throw new Error('Network failure');
        const data = table === 'band_members' ? member ? { role: 'admin' } : null
          : table === 'bands' ? { name: 'Demo' } : table === 'events' ? events : taskError ? null : [task];
        return { data, error: table === 'tasks' ? taskError : null };
      };
      return {
        select(columns) { call.columns = columns; return this; },
        eq(...args) { call.filters.push(args); return this; },
        in(column, values) { call.in = [column, Array.from(values)]; return this; },
        order() { return this; },
        maybeSingle() { return Promise.resolve().then(result); },
        then(resolve, reject) { return Promise.resolve().then(result).then(resolve, reject); },
      };
    },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, Date, Intl,
      require(name) {
        if (name === 'react') return { ...React,
          useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial;
            return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
          useEffect(effect) { effects.push(effect); },
        };
        if (name === 'next/navigation') return { useParams: () => ({ bandId: 'band' }) };
        if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
        if (name === '@/lib/date-time') return { watchPageClock() {}, differentLocalEventDays: () => false };
        if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null, BandWorkspaceInfo: () => null };
        if (name.startsWith('@/lib/')) return load('src/' + name.slice(2) + '.ts');
        return require(name);
      },
    });
    return mod.exports;
  }
  const Component = load('src/app/bandas/[bandId]/agenda/page.tsx').default;
  Component();
  const cleanups = effects.map(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  cursor = 0;
  const tree = Component();
  cleanups.forEach(cleanup => cleanup?.());
  return { states, calls, tree };
}
function text(tree) {
  if (typeof tree === 'string') return tree;
  if (!tree || typeof tree !== 'object') return '';
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return text(tree.props?.children);
}

test('agenda loads events with an explicit unavailable state for the missing task event column', async () => {
  const f = await loadAgenda({ taskError: { code: '42703', message: 'column tasks.event_id does not exist' } });
  assert.equal(f.states[0], 'ready');
  assert.equal(f.states[4][0].id, 'event');
  assert.equal(Object.keys(f.states[5]).length, 0);
  assert.match(text(f.tree), /Tarefas associadas indisponíveis/);
  assert.match(text(f.tree), /Show/);
  assert.equal(f.calls.filter(call => call.table === 'tasks').length, 1);
});

test('agenda preserves exact event associations and band filters when supported', async () => {
  const f = await loadAgenda();
  assert.equal(f.states[0], 'ready');
  assert.equal(f.states[5].event[0].id, 'task');
  assert.doesNotMatch(text(f.tree), /Tarefas associadas indisponíveis/);
  const query = f.calls.find(call => call.table === 'tasks');
  assert.deepEqual(query.filters, [['band_id', 'band']]);
  assert.deepEqual(query.in, ['event_id', ['event']]);
});

for (const error of [
  { code: '42501', message: 'permission denied' },
  { code: 'PGRST301', message: 'JWT expired' },
  { code: '', message: 'Failed to fetch' },
  { code: '42703', message: 'column tasks.priority does not exist' },
  { code: '42703', message: 'column events.event_id does not exist' },
]) test(`agenda does not hide ${error.code}: ${error.message}`, async () => {
  const f = await loadAgenda({ taskError: error });
  assert.equal(f.states[0], 'error');
  assert.match(text(f.tree), /Não foi possível carregar as tarefas dos eventos/);
  assert.doesNotMatch(text(f.tree), /Tarefas associadas indisponíveis/);
});

test('agenda does not hide thrown network errors', async () => {
  const f = await loadAgenda({ taskThrows: true });
  assert.equal(f.states[0], 'error');
  assert.match(text(f.tree), /Não foi possível carregar a agenda/);
});

test('empty agenda does not query task associations', async () => {
  const f = await loadAgenda({ events: [] });
  assert.equal(f.states[0], 'ready');
  assert.equal(f.calls.some(call => call.table === 'tasks'), false);
});

test('agenda keeps session and membership checks before event and task queries', async () => {
  const signedOut = await loadAgenda({ signedIn: false });
  assert.equal(signedOut.states[0], 'unauthenticated');
  assert.equal(signedOut.calls.length, 0);
  const outsider = await loadAgenda({ member: false });
  assert.equal(outsider.states[0], 'unavailable');
  assert.deepEqual(outsider.calls.map(call => call.table), ['band_members']);
});
