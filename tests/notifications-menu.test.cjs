/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

function load(file, dependencies = {}, globals = {}) {
  const testModule = { exports: {} };
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  vm.runInNewContext(outputText, {
    ...globals, module: testModule, exports: testModule.exports,
    require: name => dependencies[name] ?? require(name),
  });
  return testModule.exports;
}

const demo = load('src/lib/demo-notifications.ts');
const destinations = load('src/lib/notification-destination.ts');
const bandId = '10000000-0000-0000-0000-000000000001';
const contentId = '10000000-0000-0000-0000-000000000002';

function fixture(source, navigation = {}, defaultSource) {
  const states = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0;
  const NotificationsMenu = load('src/components/notifications-menu.tsx', {
    react: {
      useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = value; }];
      },
      useRef: initial => refs[refIndex++] ??= { current: initial },
      useEffect: callback => effects.push(callback),
      useCallback: callback => callback,
      useId: () => 'notifications-heading',
    },
    '@/components/navigation-icon': { default: () => null },
    '@/lib/notifications': { notificationSource: defaultSource },
    '@/lib/details-dismiss': { bindDetailsDismiss() {} },
    '@/lib/notification-destination': destinations,
    'next/navigation': { useRouter: () => ({ push: navigation.push }) },
  }).default;

  function render() {
    stateIndex = 0;
    refIndex = 0;
    effects.length = 0;
    const tree = NotificationsMenu({ source });
    if (navigation.menu) tree.props.ref.current = navigation.menu;
    return nodes(tree);
  }
  render();
  effects.forEach(effect => effect());
  return render;
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const text = (tree, value) => tree.find(node => node.props.children === value);

test('demo feed marks one or all and keeps the count between reads in the same source', async () => {
  const source = demo.createDemoNotificationSource();
  const render = fixture(source);
  assert.ok(text(render(), 'Carregando notificações…'));
  await settle();

  let menu = render();
  const trigger = menu.find(node => node.type === 'summary');
  assert.equal(trigger.props['aria-label'], 'Notificações, 2 não lidas');
  assert.equal(text(nodes(trigger), 'Demo'), undefined);
  assert.ok(nodes(trigger).some(node => node.props.name === 'Bell'));
  assert.ok(text(nodes(trigger), 2));
  assert.equal(text(menu, 'Demonstração com dados fictícios.'), undefined);
  assert.ok(text(menu, 'Sem destino disponível.'));
  assert.equal(menu.filter(node => node.type === 'time').length, 3);
  const card = menu.find(node => node.props['aria-label'] === 'Marcar como lida: Pedido de entrada');
  assert.equal(card.type, 'button');
  assert.equal(card.props.type, 'button');
  assert.equal(card.props.onKeyDown, undefined, 'uses native Enter and Space activation');
  assert.match(card.props.className, /w-full.*focus-visible:ring-2/);
  assert.ok(nodes(card).some(node => node.type === 'time'));
  assert.ok(text(nodes(card), 'Pedido de entrada'));
  assert.ok(text(nodes(card), 'Não lida'));
  assert.equal(text(menu, 'Marcar como lida'), undefined);
  card.props.onClick();
  await settle();

  menu = render();
  const readCard = menu.find(node => node.props['aria-label'] === 'Lida: Pedido de entrada');
  assert.equal(readCard.type, 'button');
  assert.equal(readCard.props['aria-disabled'], true);
  assert.equal(readCard.props.onClick, undefined);
  assert.ok(text(nodes(readCard), 'Lida'));
  assert.equal((await source.load()).unreadCount, 1);
  text(menu, 'Marcar todas como lidas').props.onClick();
  await settle();

  menu = render();
  assert.match(menu.find(node => node.type === 'summary').props['aria-label'], /0 não lidas/);
  assert.equal(text(menu, 'Marcar todas como lidas').props['aria-disabled'], true);
  assert.equal((await demo.createDemoNotificationSource().load()).unreadCount, 2);
});

test('a load failure is announced, and retry can render an empty feed', async () => {
  let attempts = 0;
  const render = fixture(undefined, {}, {
    async load() {
      if (++attempts === 1) throw Error('Fixture failure');
      return { items: [], unreadCount: 0 };
    },
  });
  await settle();
  let menu = render();
  assert.match(menu.find(node => node.props.role === 'alert').props.children, /Não foi possível carregar/);
  text(menu, 'Tentar novamente').props.onClick();
  await settle();
  menu = render();
  assert.ok(text(menu, 'Nenhuma notificação.'));
  assert.equal(menu.some(node => node.props.role === 'alert'), false);
});

test('the existing workspace header renders only one notification trigger', () => {
  const header = fs.readFileSync('src/components/space-switcher.tsx', 'utf8');
  assert.equal([...header.matchAll(/<NotificationsMenu\s*\/>/g)].length, 1);
});

test('only known types and UUID references produce scoped internal routes', () => {
  for (const [kind, expected] of [
    ['event_created', `/bandas/${bandId}/agenda?notificacao=${contentId}`],
    ['task_assigned', `/bandas/${bandId}/tarefas?notificacao=${contentId}`],
    ['entry_request_created', `/bandas/${bandId}/membros?notificacao=${contentId}`],
    ['entry_request_decided', `/descobrir?notificacao=${contentId}&banda=${bandId}`],
    ['unknown', null],
  ]) {
    assert.equal(destinations.notificationHref({ kind, band_id: bandId, content_id: contentId }), expected);
  }
  assert.equal(destinations.notificationHref({ kind: 'event_created', band_id: bandId, content_id: '../x' }), null);
  assert.equal(destinations.notificationHref({ kind: 'event_created', band_id: null, content_id: contentId }), null);
});

test('unread linked cards wait for confirmation and read cards navigate directly', async () => {
  const actions = [];
  const menu = { open: true, querySelector: () => ({ focus() {} }) };
  let completeWrite;
  const item = {
    ...(await demo.createDemoNotificationSource().load()).items[0],
    reference: { kind: 'task_assigned', band_id: bandId, content_id: contentId },
  };
  const source = {
    async load() { return { recipientId: 'alice', items: [item], unreadCount: 1 }; },
    markRead(id, recipientId) {
      assert.equal(recipientId, 'alice');
      actions.push(id);
      return new Promise(resolve => { completeWrite = () => resolve({ items: [{ ...item, read: true }], unreadCount: 0 }); });
    },
  };
  const render = fixture(source, { menu, push(href) { assert.equal(menu.open, false); actions.push(href); } });
  await settle();
  const destination = `/bandas/${bandId}/tarefas?notificacao=${contentId}`;
  for (const state of ['não lida', 'lida']) {
    menu.open = true;
    const card = render().find(node => node.props['aria-label'] === `Abrir conteúdo: Pedido de entrada, ${state}`);
    assert.equal(card.props['aria-disabled'], false);
    card.props.onClick();
    if (state === 'não lida') {
      assert.equal(actions.at(-1), item.id);
      assert.equal(menu.open, true);
      completeWrite();
      await settle();
    }
    assert.equal(actions.at(-1), destination);
  }
  assert.deepEqual(actions, [item.id, destination, destination]);
});

test('a failed write leaves the item unread and does not navigate', async () => {
  const item = {
    ...(await demo.createDemoNotificationSource().load()).items[0],
    reference: { kind: 'task_assigned', band_id: bandId, content_id: contentId },
  };
  const menu = { open: true };
  let writes = 0;
  const render = fixture({
    async load() { return { recipientId: 'alice', items: [item], unreadCount: 1 }; },
    async markRead() { writes++; throw new Error('RPC unavailable'); },
  }, { menu, push() { assert.fail('navigation after failed write'); } });
  await settle();
  const unreadCard = () => render().find(node => node.props['aria-label'] === 'Abrir conteúdo: Pedido de entrada, não lida');
  unreadCard().props.onClick();
  await settle();
  assert.ok(render().find(node => node.props.role === 'alert'));
  assert.ok(unreadCard());
  assert.equal(menu.open, true);
  text(render(), 'Recarregar notificações').props.onClick();
  await settle();
  assert.equal(render().some(node => node.props.role === 'alert'), false);
  assert.equal(writes, 1);
});

function supabaseFeed(respond) {
  const requests = [];
  let account = 'alice';
  const client = createClient('https://notifications.example', 'test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const request = {
        url: new URL(input),
        method: init.method,
        body: init.body && JSON.parse(init.body),
        authorization: new Headers(init.headers).get('Authorization'),
      };
      requests.push(request);
      return respond(request);
    } },
  });
  const { notificationSource } = load('src/lib/notifications.ts', {
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: account && { access_token: account } } }),
        getUser: async token => ({ data: { user: { id: token } } }),
      },
      from: client.from.bind(client),
      rpc: client.rpc.bind(client),
    }) },
  });
  return { notificationSource, requests, setAccount: value => { account = value; } };
}

const taskRow = {
  id: 'task', kind: 'task_assigned', band_id: bandId, content_id: contentId,
  message: 'Uma tarefa foi atribuída a você.', created_at: '2026-11-18T14:30:00Z', read_at: null,
};

test('the default feed scopes both queries to the verified user and counts beyond the recent list', async () => {
  const { notificationSource, requests } = supabaseFeed(({ method }) => method === 'HEAD'
    ? new Response(null, { headers: { 'Content-Range': '*/42' } })
    : Response.json([taskRow]));
  const render = fixture(undefined, {}, notificationSource);
  assert.ok(text(render(), 'Carregando notificações…'));
  await settle();
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url.pathname, '/rest/v1/notifications');
    assert.equal(request.authorization, 'Bearer alice');
    assert.equal(request.url.searchParams.get('recipient_id'), 'eq.alice');
  }
  const recent = requests.find(request => request.method === 'GET').url.searchParams;
  assert.equal(recent.get('order'), 'created_at.desc,id.desc');
  assert.equal(recent.get('limit'), '30');
  const unread = requests.find(request => request.method === 'HEAD').url.searchParams;
  assert.equal(unread.get('read_at'), 'is.null');
  assert.equal(unread.has('limit'), false);
  assert.ok(text(render(), 42));
  assert.ok(text(render(), taskRow.message));
});

test('writes use the SQL RPC signatures and reject stale or signed-out accounts before any write', async () => {
  const { notificationSource, requests, setAccount } = supabaseFeed(({ method, url }) => {
    if (method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '*/0' } });
    if (method === 'GET') return Response.json([{ ...taskRow, read_at: taskRow.created_at }]);
    return Response.json(url.pathname.endsWith('/bandup_mark_notification_read') || 3);
  });
  setAccount('bob');
  await assert.rejects(notificationSource.markRead(taskRow.id, 'alice'), /recipient unavailable/);
  await assert.rejects(notificationSource.markAllRead('alice'), /recipient unavailable/);
  setAccount(null);
  await assert.rejects(notificationSource.load(), /session unavailable/);
  assert.equal(requests.length, 0);
  setAccount('alice');
  const single = await notificationSource.markRead(taskRow.id, 'alice');
  assert.equal(single.items[0].read, true);
  assert.equal(single.unreadCount, 0);
  assert.equal((await notificationSource.markAllRead('alice')).unreadCount, 0);
  const writes = requests.filter(request => request.method === 'POST');
  assert.deepEqual(writes.map(request => [request.url.pathname, request.body, request.authorization]), [
    ['/rest/v1/rpc/bandup_mark_notification_read', { p_notification_id: taskRow.id }, 'Bearer alice'],
    ['/rest/v1/rpc/bandup_mark_all_notifications_read', {}, 'Bearer alice'],
  ]);
});

test('a false single-read RPC result requires an already-read row owned by the same recipient', async () => {
  let row = null;
  const { notificationSource, requests } = supabaseFeed(({ method, url }) => {
    if (method === 'POST') return Response.json(false);
    if (method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '*/0' } });
    return Response.json(url.searchParams.has('id') ? (row ? [row] : []) : [row]);
  });
  await assert.rejects(notificationSource.markRead(taskRow.id, 'alice'), /read not confirmed/);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url.searchParams.get('recipient_id'), 'eq.alice');
  assert.equal(requests[1].url.searchParams.get('id'), 'eq.task');
  row = { ...taskRow, read_at: taskRow.created_at };
  assert.equal((await notificationSource.markRead(taskRow.id, 'alice')).items[0].read, true);
});

test('rejected RPCs surface an error without fetching a success snapshot', async () => {
  const { notificationSource, requests } = supabaseFeed(() =>
    Response.json({ code: '42501', message: 'permission denied' }, { status: 403 }));
  const denied = { code: '42501' };
  await assert.rejects(notificationSource.markRead(taskRow.id, 'alice'), denied);
  await assert.rejects(notificationSource.markAllRead('alice'), denied);
  assert.deepEqual(requests.map(request => request.method), ['POST', 'POST']);
});

test('missing or inaccessible targets expose no content while a matching card receives focus', () => {
  const actions = [];
  const element = { focus: () => actions.push('focus'), scrollIntoView: () => actions.push('scroll') };
  const target = load('src/components/notification-target.tsx', {
    react: { useEffect: effect => effect() },
    'next/navigation': { useSearchParams: () => new URLSearchParams(`notificacao=${contentId}`) },
    '@/lib/notification-destination': destinations,
  }, { document: { getElementById: () => element }, URLSearchParams });
  assert.equal(target.useNotificationTarget(), contentId);
  assert.equal(target.NotificationTargetStatus({ target: contentId, found: true }), null);
  const unavailable = target.NotificationTargetStatus({ target: contentId, found: false });
  assert.equal(unavailable.props.role, 'status');
  assert.equal(unavailable.props.children, 'O conteúdo desta notificação não está disponível.');
  assert.deepEqual(actions, ['focus', 'scroll', 'focus', 'scroll']);
});
