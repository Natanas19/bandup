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

function compile(file, overrides = {}) {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const mod = { exports: {} }; cache.set(relative, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, Date, Intl,
      require(name) {
        if (name in overrides) return overrides[name];
        if (name === 'react/jsx-runtime') return require(name);
        if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
        if (name.startsWith('@/')) {
          const base = path.join('src', name.slice(2));
          const target = [base + '.ts', base + '.tsx'].find(candidate => fs.existsSync(path.join(root, candidate)));
          return load(target);
        }
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
  { id: 'event-a', band_id: 'band-a', title: 'Show de sexta', description: 'Levar os instrumentos', event_type: 'show', start_at: '2099-04-03T18:30:00Z', end_at: '2099-04-03T20:00:00Z', location: 'Casa de shows' },
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
          const failure = table === 'band_members' ? options.membershipError : options.eventError;
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
  assert.equal(eventQuery.columns, 'id, band_id, title, description, event_type, start_at, end_at, location');
  assert.deepEqual(eventQuery.orders.map(order => order[0]), ['start_at', 'id']);
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
  assert.match(html, /sm:flex-row/);
});
