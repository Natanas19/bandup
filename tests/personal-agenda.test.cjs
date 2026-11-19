/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const storageOrigin = 'https://local-fixture.example';

function compile(file, overrides = {}, globals = {}) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const mod = { exports: {} }; cache.set(relative, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, Date, Intl, URL, AbortSignal, crypto,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: storageOrigin } }, ...globals,
      require(name) {
        if (name in overrides) return overrides[name];
        if (name === 'react/jsx-runtime') return require(name);
        if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
        if (name.startsWith('@/')) {
          const base = path.join('src', name.slice(2));
          const target = [base + '.ts', base + '.tsx'].find(candidate => fs.existsSync(path.join(root, candidate)));
          return load(target);
        }
        if (name.startsWith('./')) return load(path.join(path.dirname(relative), name + '.ts'));
        return require(name);
      },
    });
    return mod.exports;
  }
  return load(file);
}

const bands = [
  { band_id: 'band-a', role: 'admin', band: { id: 'band-a', name: 'Banda A' } },
  { band_id: 'band-b', role: 'member', band: { id: 'band-b', name: 'Banda B' } },
];
const events = [
  { id: 'event-a', band_id: 'band-a', title: 'Show de sexta', description: 'Levar os instrumentos. Mapa: https://example.com/mapa', event_type: 'show', start_at: '2099-04-03T18:30:00Z', end_at: '2099-04-03T20:00:00Z', location: 'Casa de shows' },
  { id: 'event-b', band_id: 'band-b', title: 'Ensaio', description: null, event_type: 'rehearsal', start_at: '2099-04-05T19:00:00Z', end_at: null, location: null },
];

function serviceFixture(options = {}) {
  const calls = [];
  const client = {
    auth: { getUser: async () => options.authError
      ? { data: { user: null }, error: options.authError }
      : { data: { user: { id: 'user-a' } }, error: null } },
    from(table) {
      const call = { table, filters: [], ranges: [] }; calls.push(call);
      const query = {
        select(columns) { call.columns = columns; return this; },
        eq(...values) { call.filters.push(values); return this; },
        in(column, values) { call.in = [column, [...values]]; return this; },
        order(...values) { (call.orders ??= []).push(values); return this; },
        range(first, last) { call.ranges.push([first, last]); this.offset = first; return this; },
        then(resolve, reject) {
          const failure = table === 'band_members' ? options.membershipError
            : (call.columns.includes('flyer_path') && options.flyerError) || options.eventError;
          if (failure) return Promise.resolve({ data: null, error: failure }).then(resolve, reject);
          let data = table === 'band_members' ? (options.bands ?? bands) : (options.events ?? events);
          if (table === 'events' && !options.ignoreBandFilter && call.in) data = data.filter(row => call.in[1].includes(row.band_id));
          if (options.paginate && table === 'events') data = data.slice(this.offset ?? 0, (this.offset ?? 0) + 500);
          else if (table === 'band_members' && call.ranges.length) data = data.slice(call.ranges[0][0], call.ranges[0][1] + 1);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { client, calls };
}

const service = compile('src/lib/personal-agenda.ts');

test('personal agenda reads only current memberships and labels events with their band names', async () => {
  const fixture = serviceFixture();
  const result = await service.loadPersonalAgenda(fixture.client);
  assert.deepEqual(Array.from(result, event => [event.id, event.bandName]), [['event-a', 'Banda A'], ['event-b', 'Banda B']]);
  assert.equal(fixture.calls[0].table, 'band_members');
  assert.deepEqual(fixture.calls[0].filters, [['user_id', 'user-a']]);
  const eventQuery = fixture.calls[1];
  assert.equal(eventQuery.table, 'events');
  assert.deepEqual(eventQuery.in, ['band_id', ['band-a', 'band-b']]);
  assert.equal(eventQuery.columns, 'id, band_id, title, description, event_type, start_at, end_at, location, flyer_path');
  assert.deepEqual(eventQuery.orders.map(order => order[0]), ['start_at', 'id']);
});

const flyerBand = '20000000-0000-0000-0000-000000000001';
const flyerEvent = '30000000-0000-0000-0000-000000000001';
const flyerFile = { type: 'image/webp', size: 1024 };
const flyerPath = `${flyerBand}/${flyerEvent}/40000000-0000-4000-8000-000000000001.webp`;
const signedFlyer = `${storageOrigin}/storage/v1/object/sign/event-flyers/${flyerPath}?token=fixture`;

function flyerFixture(options = {}) {
  let linked = options.linked ?? null;
  const calls = [];
  const timers = new Map();
  let signal, verificationCount = 0;
  const scoped = {
    storage: { from(bucket) {
      assert.equal(bucket, 'event-flyers');
      return {
        async upload(path, file, settings) {
          calls.push(['upload', path, file, settings]);
          if (options.uploadTimeout) {
            return new Promise((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('Upload aborted')), { once: true });
              for (const expire of timers.values()) expire();
            });
          }
          return { error: options.uploadDenied ? { code: '403' } : null };
        },
        async createSignedUrl(path, ttl) {
          assert.equal(path, flyerPath); assert.equal(ttl, 60);
          return { data: { signedUrl: options.signedUrl ?? signedFlyer } };
        },
      };
    } },
    from(table) {
      assert.equal(table, 'events');
      let replacement, expected;
      return {
        select() { return this; },
        update(value) { replacement = value; return this; },
        eq(field, value) {
          if (field === 'flyer_path') expected = value;
          else assert.equal(value, field === 'id' ? flyerEvent : flyerBand);
          return this;
        },
        is(field, value) { assert.equal(field, 'flyer_path'); expected = value; return this; },
        async maybeSingle() {
          if (!replacement) return { data: { flyer_path: linked } };
          calls.push(['update', expected, replacement.flyer_path]);
          if (options.denied) return { error: { code: '42501' } };
          if (options.concurrent || expected !== linked) return { data: null };
          linked = replacement.flyer_path;
          if (options.lostReply) throw Error('Connection lost');
          return { data: { flyer_path: linked } };
        },
      };
    },
  };
  const api = compile('src/lib/event-flyer.ts', { './band-logo-upload': {
    async bandPhotoSession(_client, _user, deadline) {
      signal = deadline;
      return { scoped, async verify() {
        if (++verificationCount === options.failVerification) throw Error('Session unavailable');
      } };
    },
  } }, {
    AbortController,
    AbortSignal: {},
    crypto: options.crypto ?? crypto,
    setTimeout(expire, delay) {
      assert.equal(delay, 30_000);
      const id = Symbol('flyer timeout');
      timers.set(id, expire);
      return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  return { api, scoped, calls, timers, save: (previous, file) => api.saveEventFlyer(scoped, 'user', flyerBand, flyerEvent, previous, file) };
}

test('flyer validates file types and size before an upload', async () => {
  const f = flyerFixture();
  for (const file of [{ type: 'image/svg+xml', size: 1 }, { type: 'image/png', size: 0 }, { type: 'image/jpeg', size: 2097153 }]) {
    await assert.rejects(f.save(null, file), /flyer válido/);
  }
  assert.deepEqual(f.calls, []);
});

test('flyer uploads immutably, confirms association and removes only the link', async () => {
  const f = flyerFixture({ lostReply: true });
  const path = await f.save(null, flyerFile);
  assert.match(path, new RegExp(`^${flyerBand}/${flyerEvent}/[0-9a-f-]+\\.webp$`));
  assert.equal(f.calls[0][0], 'upload');
  assert.equal(f.calls[0][3].upsert, false);
  assert.deepEqual(f.calls[1], ['update', null, path]);
  assert.equal(await f.save(path, null), null);
  assert.deepEqual(f.calls[2], ['update', path, null]);
  assert.equal(f.calls.length, 3);
  assert.equal(f.timers.size, 0);
});

test('flyer works without AbortSignal.timeout or crypto.randomUUID', async () => {
  const f = flyerFixture({ crypto: {
    getRandomValues(bytes) {
      assert.equal(bytes.length, 16);
      return bytes.fill(255);
    },
  } });
  const expected = `${flyerBand}/${flyerEvent}/ffffffff-ffff-4fff-bfff-ffffffffffff.webp`;
  assert.equal(await f.save(null, flyerFile), expected);
  assert.equal(f.calls[0][1], expected);
  assert.deepEqual(f.calls[1], ['update', null, expected]);
  assert.equal(f.timers.size, 0);
});

test('flyer timeout cancels the upload, clears the timer and skips association', async () => {
  const f = flyerFixture({ uploadTimeout: true });
  await assert.rejects(f.save(null, flyerFile), /tempo para alterar o flyer se esgotou/);
  assert.deepEqual(f.calls.map(call => call[0]), ['upload']);
  assert.equal(f.timers.size, 0);
});

test('flyer distinguishes session failure before linking from failure to confirm a write', async () => {
  const before = flyerFixture({ failVerification: 1 });
  await assert.rejects(before.save(null, flyerFile), /sessão para vincular o flyer/);
  assert.deepEqual(before.calls.map(call => call[0]), ['upload']);
  assert.equal(before.timers.size, 0);

  const after = flyerFixture({ failVerification: 2 });
  await assert.rejects(after.save(null, flyerFile), /confirmar a alteração do flyer/);
  assert.deepEqual(after.calls.map(call => call[0]), ['upload', 'update']);
  assert.equal(after.timers.size, 0);
});

test('flyer failures do not report success or retry mutations', async () => {
  const upload = flyerFixture({ uploadDenied: true });
  await assert.rejects(upload.save(null, flyerFile), /envio do flyer/);
  assert.equal(upload.calls.length, 1);
  const denied = flyerFixture({ denied: true, linked: flyerPath });
  await assert.rejects(denied.save(flyerPath, null), /permissão/);
  assert.equal(denied.calls.length, 1);
  const concurrent = flyerFixture({ concurrent: true, linked: flyerPath });
  await assert.rejects(concurrent.save(flyerPath, null), /confirmar a alteração/);
  assert.equal(concurrent.calls.length, 1);
});

test('flyer viewer signs the exact object briefly and rejects an unexpected origin', async () => {
  const ok = flyerFixture();
  assert.equal(await ok.api.signEventFlyer(ok.scoped, flyerPath), signedFlyer);
  const invalid = flyerFixture({ signedUrl: signedFlyer.replace(storageOrigin, 'https://unexpected.example') });
  await assert.rejects(invalid.api.signEventFlyer(invalid.scoped, flyerPath), /inválido/);
});

test('flyer viewer opens the full image, expires locally and handles a failed refresh', async () => {
  let cursor = 0, effect, expiry, fail = false;
  const states = [];
  const { EventFlyer } = compile('src/components/event-flyer.tsx', {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
      },
      useEffect(run) { effect = run; },
    },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({}) },
    '@/lib/event-flyer': { EVENT_FLYER_URL_SECONDS: 60, async signEventFlyer() {
      if (fail) throw Error('Denied');
      return signedFlyer;
    } },
  }, { setTimeout(callback) { expiry = callback; }, clearTimeout() {} });
  const render = () => { cursor = 0; return EventFlyer({ path: flyerPath, title: 'Show', thumbnail: true }); };
  const settle = () => new Promise(resolve => setImmediate(resolve));

  assert.equal(render().props.children, 'Carregando flyer...');
  const unmount = effect();
  await settle();
  const imageLink = render();
  assert.equal(imageLink.props.href, signedFlyer);
  assert.equal(imageLink.props.target, '_blank');
  assert.match(imageLink.props.className, /\blg:mx-auto\b/);
  assert.doesNotMatch(imageLink.props.className, /(?:^|\s)mx-auto\b/);
  assert.match(imageLink.props.children.props.className, /object-contain/);
  assert.match(imageLink.props.children.props.className, /max-h-48.*lg:max-h-36/);
  expiry();
  const [expired, retry] = render().props.children;
  assert.match(expired.props.children, /expirou/);
  unmount();
  fail = true;
  retry.props.onClick();
  assert.equal(render().props.children, 'Carregando flyer...');
  const cleanup = effect();
  await settle();
  assert.match(render().props.children[0].props.children, /Não foi possível abrir/);
  cleanup();
});

test('personal agenda falls back only when the flyer column is missing', async () => {
  const fixture = serviceFixture({ flyerError: { code: '42703', message: 'column events.flyer_path does not exist' } });
  assert.equal((await service.loadPersonalAgenda(fixture.client)).length, 2);
  assert.deepEqual(fixture.calls.filter(call => call.table === 'events').map(call => call.columns.includes('flyer_path')), [true, false]);
  const forbidden = serviceFixture({ flyerError: { code: '42501', message: 'permission denied' } });
  await assert.rejects(service.loadPersonalAgenda(forbidden.client));
  assert.equal(forbidden.calls.filter(call => call.table === 'events').length, 1);
});

test('no memberships skips the events query and event pages are read past the service page size', async () => {
  const none = serviceFixture({ bands: [] });
  assert.deepEqual(Array.from(await service.loadPersonalAgenda(none.client)), []);
  assert.deepEqual(none.calls.map(call => call.table), ['band_members']);

  const manyEvents = Array.from({ length: 501 }, (_, index) => ({ ...events[0], id: `event-${index}` }));
  const paged = serviceFixture({ events: manyEvents, paginate: true });
  assert.equal((await service.loadPersonalAgenda(paged.client)).length, 501);
  assert.deepEqual(paged.calls.filter(call => call.table === 'events').map(call => call.ranges[0][0]), [0, 500]);
});

test('authentication, membership and event failures do not become empty agendas', async () => {
  for (const options of [
    { authError: { message: 'private' } },
    { membershipError: { message: 'private' } },
    { eventError: { message: 'private' } },
  ]) {
    const fixture = serviceFixture(options);
    await assert.rejects(service.loadPersonalAgenda(fixture.client), error => /Não foi possível/.test(error.message)
      && !error.message.includes('private'));
  }
});

test('event rows outside verified memberships are rejected', async () => {
  const fixture = serviceFixture({ events: [{ ...events[0], band_id: 'outside' }], ignoreBandFilter: true });
  await assert.rejects(service.loadPersonalAgenda(fixture.client), /confirmar o acesso/);
});

function renderAgenda({ events: rows = null, error = '' } = {}) {
  let cursor = 0;
  const states = [rows, error, 0];
  const hooks = {
    ...React,
    useState() { return [states[cursor++], () => {}]; },
    useEffect() {},
  };
  const load = compile('src/components/personal-agenda.tsx', {
    react: hooks,
    '@/lib/personal-agenda': { ...service, loadPersonalAgenda: async () => [] },
    '@/lib/supabase/client': { getSupabaseBrowserClient: () => ({}) },
  });
  return renderToStaticMarkup(React.createElement(load.default));
}

test('personal agenda renders loading, error, empty and responsive event details', () => {
  assert.match(renderAgenda(), /Carregando sua agenda/);
  assert.match(renderAgenda({ error: 'Falha segura' }), /role="alert"/);
  assert.match(renderAgenda({ events: [] }), /Nenhum evento encontrado/);
  const html = renderAgenda({ events: events.map(event => ({ ...event, bandName: event.band_id === 'band-a' ? 'Banda A' : 'Banda B' })) });
  for (const value of ['Show de sexta', 'Banda A', 'Ensaio', 'Banda B', '2099', 'aria-label="Eventos das suas bandas"', 'Local:', 'Levar os instrumentos']) {
    assert.ok(html.includes(value), `${value}\n${html}`);
  }
  assert.match(html, /href="\/bandas\/band-a\/agenda"/);
  assert.match(html, /href="\/bandas\/band-b\/agenda"/);
  const disclosures = html.match(/<details\b[\s\S]*?<\/details>/g) ?? [];
  assert.equal(disclosures.length, 1);
  assert.doesNotMatch(disclosures[0], /<details\b[^>]*\bopen(?:\s|=|>)/);
  assert.match(disclosures[0], /<summary aria-label="Detalhes de Show de sexta"[^>]*>/);
  assert.match(disclosures[0], /Ver detalhes[\s\S]*Recolher detalhes[\s\S]*href="https:\/\/example\.com\/mapa"/);
  assert.match(html, /sm:flex-row/);
  assert.doesNotMatch(html, /lg:w-36|Carregando flyer/);
  const withFlyer = renderAgenda({ events: [{ ...events[0], bandName: 'Banda A', flyer_path: flyerPath }] });
  assert.match(withFlyer, /flex-col gap-2 lg:flex-row lg:items-start lg:gap-4[\s\S]*w-full lg:w-36[\s\S]*Carregando flyer[\s\S]*<h2[^>]*>Show de sexta/);
  assert.match(withFlyer, /href="\/bandas\/band-a\/agenda"[\s\S]*Local:[\s\S]*<details/);
  assert.doesNotMatch(withFlyer.slice(withFlyer.indexOf('<details')), /Carregando flyer/);
  const flyerOnly = renderAgenda({ events: [{ ...events[1], bandName: 'Banda B', flyer_path: flyerPath }] });
  assert.match(flyerOnly, /Carregando flyer/);
  assert.doesNotMatch(flyerOnly, /<details/);
});
