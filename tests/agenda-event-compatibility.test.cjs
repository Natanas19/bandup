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

async function loadAgenda({ taskError = null, taskThrows = false, flyerError = null, publicationError = null, events = [event], signedIn = true, member = true, role = 'admin', updateError = null, notificationTarget = null, targetEvent = null } = {}) {
  const states = [], effects = [], calls = [], cache = new Map();
  let cursor = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: signedIn ? { user: { id: 'user' } } : null }, error: null }) },
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const result = (single = false) => {
        if (table === 'tasks' && taskThrows) throw new Error('Network failure');
        const isTargetRead = notificationTarget && call.filters.some(([column, value]) => column === 'id' && value === notificationTarget);
        const data = table === 'band_members' ? member ? { role } : null
          : table === 'bands' ? { name: 'Demo' }
          : table === 'events' ? (single ? isTargetRead ? targetEvent : { ...events[0], ...call.update } : events)
          : taskError ? null : [task];
        return { data, error: table === 'tasks' ? taskError : call.update && updateError ? updateError
          : table === 'events' && call.columns?.includes('flyer_path') && flyerError ? flyerError
          : table === 'events' && call.columns?.includes('is_public') ? publicationError : null };
      };
      return {
        select(columns) { call.columns = columns; return this; },
        update(values) { call.update = values; return this; },
        eq(...args) { call.filters.push(args); return this; },
        in(column, values) { call.in = [column, Array.from(values)]; return this; },
        order() { return this; },
        maybeSingle() { return Promise.resolve().then(() => result(true)); },
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
        if (name === '@/lib/date-time') return { ...load('src/lib/date-time.ts'), watchPageClock() {} };
        if (name === '@/components/event-flyer') return {
          EventFlyerLayout: ({ children }) => children,
        };
        if (name === '@/components/notification-target') return {
          useNotificationTarget: () => notificationTarget,
          notificationTargetProps: { id: 'conteudo-da-notificacao', tabIndex: -1 },
          NotificationTargetStatus: () => null,
        };
        if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null, BandWorkspaceInfo: () => null };
        if (name.startsWith('@/lib/')) return load('src/' + name.slice(2) + '.ts');
        if (name.startsWith('./')) return load(path.join(path.dirname(file), name + '.ts'));
        return require(name);
      },
    });
    return mod.exports;
  }
  const Component = load('src/app/bandas/[bandId]/agenda/page.tsx').default;
  const render = () => {
    cursor = 0;
    effects.length = 0;
    const content = Component().props.children;
    return content.type(content.props);
  };
  async function reload() {
    render();
    const cleanups = effects.map(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    cleanups.forEach(cleanup => cleanup?.());
    return render();
  }
  return { states, calls, tree: await reload(), render, reload };
}
function text(tree) {
  if (typeof tree === 'string') return tree;
  if (!tree || typeof tree !== 'object') return '';
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  return text(tree.props?.children);
}

test('band agenda independently removes missing publication and flyer columns', async () => {
  const f = await loadAgenda({
    flyerError: {code: '42703', message: 'column events.flyer_path does not exist'},
    publicationError: {code: '42703', message: 'column events.is_public does not exist'},
  });
  assert.equal(f.states[0], 'ready');
  assert.deepEqual(f.calls.filter(call => call.table === 'events').map(call => [
    call.columns.includes('flyer_path'), call.columns.includes('is_public'),
  ]), [[true, true], [false, true], [false, false]]);
  assert.doesNotMatch(text(f.tree), /Divulgar na Página Pública/);
});

test('administrator toggles publication on the existing event and member only sees its status', async () => {
  function controls(tree) {
    if (Array.isArray(tree)) return tree.flatMap(controls);
    if (!tree?.props) return [];
    return [tree, ...controls(tree.props.children)];
  }
  const switchOf = tree => controls(tree).find(el => el.type === 'input' && el.props.type === 'checkbox');
  const f = await loadAgenda({events: [{...event, is_public: false}]});
  assert.match(text(f.tree), /Interno/);
  switchOf(f.tree).props.onChange();
  await new Promise(setImmediate);
  const write = f.calls.find(call => call.update);
  assert.deepEqual(JSON.parse(JSON.stringify(write.update)), {is_public: true});
  assert.deepEqual(write.filters, [['band_id', 'band'], ['id', 'event'], ['is_public', false]]);
  const published = f.render();
  assert.match(text(published), /Público/);
  assert.equal(switchOf(published).props.checked, true);
  switchOf(published).props.onChange();
  await new Promise(setImmediate);
  assert.match(text(f.render()), /Interno/);
  const member = await loadAgenda({role: 'member', events: [{...event, is_public: true}]});
  assert.match(text(member.tree), /Público/);
  assert.equal(switchOf(member.tree), undefined);
});

test('agenda recognizes and remembers a missing task event column on the same client', async () => {
  const f = await loadAgenda({ taskError: { code: '42703', message: 'column public.tasks.event_id does not exist' } });
  assert.equal(f.states[0], 'ready');
  assert.equal(f.states[4][0].id, 'event');
  assert.equal(Object.keys(f.states[5]).length, 0);
  assert.match(text(f.tree), /Tarefas associadas indisponíveis/);
  assert.match(text(f.tree), /Show/);
  assert.match(text(await f.reload()), /Tarefas associadas indisponíveis/);
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

test('band agenda stays available before the flyer migration', async () => {
  const f = await loadAgenda({ flyerError: { code: '42703', message: 'column events.flyer_path does not exist' } });
  assert.equal(f.states[0], 'ready');
  assert.deepEqual(f.calls.filter(call => call.table === 'events').map(call => call.columns.includes('flyer_path')), [true, false]);
});

function findNode(node, predicate) {
  if (Array.isArray(node)) return node.map(child => findNode(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object') return;
  return predicate(node) ? node : findNode(node.props?.children, predicate);
}

test('notification lookup is scoped to the band and highlights only a returned event', async () => {
  const id = '10000000-0000-0000-0000-000000000002';
  for (const targetEvent of [{ ...event, id }, null]) {
    const f = await loadAgenda({ notificationTarget: id, targetEvent });
    assert.ok(f.calls.some(call => call.table === 'events' &&
      JSON.stringify(call.filters) === JSON.stringify([['band_id', 'band'], ['id', id]])));
    const highlighted = findNode(f.tree, node => node.type === 'article' && node.props.id === 'conteudo-da-notificacao');
    assert.equal(!!highlighted, !!targetEvent);
    assert.equal(findNode(f.tree, node => node.props?.target === id).props.found, !!targetEvent);
  }
});

test('band agenda places the flyer alongside the main event information', async () => {
  const { tree } = await loadAgenda({ events: [{ ...event, flyer_path: 'flyer', location: 'Palco A' }] });
  const [main, details] = findNode(tree, node => node.type === 'article').props.children;
  assert.equal(main.props.path, 'flyer');
  assert.match(text(main), /Show[\s\S]*Palco A/);
  assert.match(text(details), /Tarefas relacionadas/);
});

for (const error of [
  { code: '42501', message: 'permission denied' },
  { code: 'PGRST301', message: 'JWT expired' },
  { code: '', message: 'Failed to fetch' },
  { code: '42703', message: 'column tasks.priority does not exist' },
  { code: '42703', message: 'column events.event_id does not exist' },
]) test(`agenda does not hide ${error.code}: ${error.message}`, async () => {
  const f = await loadAgenda({ taskError: error });
  assert.equal(f.states[0], 'ready');
  assert.match(text(findNode(f.tree, node => node.props.role === 'alert')), /Não foi possível carregar as tarefas dos eventos/);
  assert.doesNotMatch(text(f.tree), /Tarefas associadas indisponíveis/);
  await f.reload();
  assert.equal(f.calls.filter(call => call.table === 'tasks').length, 2);
});

test('agenda does not hide thrown network errors', async () => {
  const f = await loadAgenda({ taskThrows: true });
  assert.equal(f.states[0], 'ready');
  assert.match(text(findNode(f.tree, node => node.props.role === 'alert')), /Não foi possível carregar as tarefas dos eventos/);
});

test('editing uses events only, preserves an unchanged flyer and surfaces a denied write', async () => {
  for (const updateError of [null, { code: '42501' }]) {
    const f = await loadAgenda({
      taskError: { code: '42703', message: 'column tasks.event_id does not exist' },
      events: [{ ...event, flyer_path: 'flyer' }],
      updateError,
    });
    findNode(f.tree, node => node.type === 'button' && text(node) === 'Editar').props.onClick();
    findNode(f.render(), node => node.props.id === 'event-title').props.onChange({ target: { value: 'Título atualizado' } });
    const before = f.calls.length;
    await findNode(f.render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(f.calls.slice(before).some(call => call.table === 'tasks'), false);
    const write = f.calls.find(call => call.update);
    assert.equal(write.update.title, 'Título atualizado');
    assert.equal('flyer_path' in write.update, false);
    assert.match(write.columns, /flyer_path/);
    assert.deepEqual(write.filters, [['id', 'event'], ['band_id', 'band']]);
    const html = text(f.render());
    if (updateError) {
      assert.match(html, /permissão/);
      assert.doesNotMatch(html, /Evento atualizado com sucesso/);
    } else {
      assert.match(html, /Evento atualizado com sucesso/);
      assert.equal(f.states[4][0].flyer_path, 'flyer');
    }
  }
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
