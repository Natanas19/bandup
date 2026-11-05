/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const file = path.join(__dirname, '../src/lib/band-entry.ts');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: mod, exports: mod.exports });
const { createBandEntryService, entryError, BAND_ENTRY_BACKEND_VALIDATED } = mod.exports;
const demo = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: demo, exports: demo.exports,
  process: { env: { NODE_ENV: 'development', NEXT_PUBLIC_BAND_ENTRY_DEMO_TEST: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'https://zwmihhdvvpqgyavworgh.supabase.co' } },
  window: { location: { hostname: '127.0.0.1' } } });

const band = 'a0000000-0000-0000-0000-000000000001';
const otherBand = 'a0000000-0000-0000-0000-000000000002';
const user = 'b0000000-0000-0000-0000-000000000001';
const id = 'c0000000-0000-0000-0000-000000000001';
function fixture() {
  const state = { role: 'admin', signedIn: true, calls: [], queries: [],
    row: { id, band_id: band, requester_id: user, status: 'pending' }, error: null };
  const client = {
    auth: { async getUser() { state.calls.push('auth'); return { data: { user: state.signedIn ? { id: user } : null }, error: null }; } },
    from(table) {
      const q = { table, filters: [] }; state.queries.push(q);
      const result = () => {
        const value = table === 'band_members' ? { role: state.role } : state.row;
        const matches = table === 'band_members' || value && q.filters.every(([key, expected]) => value[key] === expected);
        return { data: q.single ? matches ? value : null : matches ? [value] : [], error: null };
      };
      return { select(columns) { q.columns = columns; return this; }, eq(...args) { q.filters.push(args); return this; },
        order(...args) { (q.orders ??= []).push(args); return this; }, range(...args) { q.range = args; return this; },
        maybeSingle() { q.single = true; return Promise.resolve(result()); }, then(resolve) { return Promise.resolve(result()).then(resolve); } };
    },
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (state.error) return { data: null, error: state.error };
      const data = name === 'bandup_request_entry' ? id : name === 'bandup_get_discovery' ? [] : name === 'bandup_discover_bands' ? [] : null;
      return { data, error: null };
    },
  };
  return { state, client, api: demo.exports.createBandEntryService(client) };
}
const denied = (operation, code) => assert.rejects(operation, error => error.code === code);

test('temporary demo gate requires development, explicit opt-in, exact project and loopback browser', async () => {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const enabled = { NODE_ENV: 'development', NEXT_PUBLIC_BAND_ENTRY_DEMO_TEST: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'https://zwmihhdvvpqgyavworgh.supabase.co' };
  const load = (env, hostname) => {
    const gateModule = { exports: {} };
    vm.runInNewContext(source, { module: gateModule, exports: gateModule.exports, process: { env },
      ...(hostname === undefined ? {} : { window: { location: { hostname } } }) });
    return gateModule.exports;
  };
  for (const env of [{}, { ...enabled, NODE_ENV: 'production' }, { ...enabled, NODE_ENV: 'test' },
    { ...enabled, NODE_ENV: 'preview' }, { ...enabled, NEXT_PUBLIC_BAND_ENTRY_DEMO_TEST: '0' },
    { ...enabled, NEXT_PUBLIC_BAND_ENTRY_DEMO_TEST: undefined },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: enabled.NEXT_PUBLIC_SUPABASE_URL + '.evil.test' },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: enabled.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/evil' },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: enabled.NEXT_PUBLIC_SUPABASE_URL + '@evil.test/rest/v1/' },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: enabled.NEXT_PUBLIC_SUPABASE_URL.replace('https:', 'http:') },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: enabled.NEXT_PUBLIC_SUPABASE_URL + ':8443' },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: undefined }]) {
    const api = load(env, 'localhost');
    assert.equal(api.BAND_ENTRY_BACKEND_VALIDATED, false);
    await denied(() => api.createBandEntryService({}).discover(), 'blocked');
  }
  for (const suffix of ['', '/', '/rest/v1', '/rest/v1/']) {
    const env = { ...enabled, NEXT_PUBLIC_SUPABASE_URL: enabled.NEXT_PUBLIC_SUPABASE_URL + suffix };
    const { client } = fixture();
    const api = load(env, '127.0.0.1');
    assert.equal(api.BAND_ENTRY_BACKEND_VALIDATED, true, `demo URL suffix: ${suffix}`);
    await api.createBandEntryService(client).discover();
    for (const NODE_ENV of ['production', 'preview', 'test']) {
      const blocked = load({ ...env, NODE_ENV }, '127.0.0.1');
      assert.equal(blocked.BAND_ENTRY_BACKEND_VALIDATED, false);
      await denied(() => blocked.createBandEntryService({}).discover(), 'blocked');
    }
  }
  for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'preview.example.com', '192.168.1.2', undefined]) {
    const { state, client } = fixture();
    const api = load(enabled, hostname);
    assert.equal(api.BAND_ENTRY_BACKEND_VALIDATED, true);
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
      await api.createBandEntryService(client).discover();
      assert.ok(state.calls.includes('auth'));
    } else {
      await denied(() => api.createBandEntryService(client).discover(), 'blocked');
      assert.equal(state.calls.length + state.queries.length, 0);
    }
  }
});

test('production gate blocks every read/mutation before any client call', async () => {
  assert.equal(BAND_ENTRY_BACKEND_VALIDATED, false);
  const { client, state } = fixture();
  const api = createBandEntryService(client, true); // Extra arguments cannot bypass the production gate.
  for (const op of [() => api.discover(), () => api.ownRequests(), () => api.adminRequests(band),
    () => api.getDiscovery(band), () => api.setDiscovery({ band_id: band }), () => api.request(band, 'Name'),
    () => api.cancel(id), () => api.decide(band, id, 'approved'), () => api.getRequest(id), () => api.pendingRequest(band)]) await denied(op, 'blocked');
  assert.equal(state.calls.length + state.queries.length, 0);
});

test('all six RPC signatures match SQL; no supplied user identity or role', async () => {
  const { api, state } = fixture();
  await api.discover(); await api.getDiscovery(band);
  await api.setDiscovery({ band_id: band, display_name: ' Public name ', summary: 'Intro', accepting_requests: true });
  assert.equal(await api.request(band, ' Musician '), id);
  await api.cancel(id); await api.decide(band, id, 'approved');
  const calls = JSON.parse(JSON.stringify(state.calls.filter(x => typeof x === 'object')));
  assert.deepEqual(calls, [
    { name: 'bandup_discover_bands', args: { p_after: null, p_limit: 20 } },
    { name: 'bandup_get_discovery', args: { p_band_id: band } },
    { name: 'bandup_set_discovery', args: { p_band_id: band, p_display_name: 'Public name', p_summary: 'Intro', p_accepting: true } },
    { name: 'bandup_request_entry', args: { p_band_id: band, p_applicant_name: 'Musician' } },
    { name: 'bandup_cancel_entry', args: { p_request_id: id } },
    { name: 'bandup_decide_entry', args: { p_request_id: id, p_decision: 'approved' } },
  ]);
});

test('requests are scoped by current Auth user or verified administrator band and bounded', async () => {
  const { api, state } = fixture();
  await api.ownRequests(20); await api.adminRequests(band);
  const queries = JSON.parse(JSON.stringify(state.queries.filter(x => x.table === 'band_join_requests')));
  assert.deepEqual(queries[0].filters, [['requester_id', user]]);
  assert.deepEqual(queries[0].range, [20, 39]);
  assert.deepEqual(queries[1].filters, [['band_id', band]]);
  assert.deepEqual(queries[1].range, [0, 19]);
  assert.equal(queries[0].orders.length, 2);
  await denied(() => api.ownRequests(-1), '22023');
});

test('fresh auth and admin role are checked for every administrative operation', async () => {
  const { api, state } = fixture();
  await api.getDiscovery(band);
  state.role = 'member';
  for (const op of [() => api.getDiscovery(band), () => api.adminRequests(band),
    () => api.setDiscovery({ band_id: band }), () => api.decide(band, id, 'approved')]) await denied(op, '42501');
  assert.equal(state.calls.filter(x => typeof x === 'object').length, 1);
  state.signedIn = false;
  await denied(() => api.request(band, 'Name'), '42501');
});

test('cross-band decisions, other-user cancellation and terminal requests never reach RPC', async () => {
  const { api, state } = fixture();
  await denied(() => api.decide(otherBand, id, 'approved'), '42501');
  state.row.requester_id = 'other-user';
  await denied(() => api.cancel(id), '42501');
  state.row.requester_id = user; state.row.status = 'approved';
  await denied(() => api.cancel(id), '55000');
  await denied(() => api.decide(band, id, 'rejected'), '55000');
  assert.equal(state.calls.filter(x => typeof x === 'object').length, 0);
});

test('RPC rejection or network ambiguity is propagated without retry or fake success', async () => {
  const { api, state } = fixture();
  state.error = { code: '42501', message: 'Revoked concurrently' };
  await denied(() => api.decide(band, id, 'approved'), '42501');
  assert.equal(state.calls.filter(x => typeof x === 'object').length, 1);
  for (const code of ['23505', '55000', '22023']) {
    state.error = { code }; await denied(() => api.request(band, 'Name'), code);
  }
  assert.equal(entryError({ code: 'PGRST202' }).code, 'blocked');
  assert.match(entryError(new Error('Lost response')).message, /Atualize os dados/);
});

test('invalid identifiers, names and discovery settings are rejected before mutation', async () => {
  const { api, state } = fixture();
  await denied(() => api.request('bad', 'Name'), '22023');
  await denied(() => api.request(band, '   '), '22023');
  await denied(() => api.request(band, 'x'.repeat(81)), '22023');
  await denied(() => api.decide(band, id, 'admin'), '22023');
  await denied(() => api.setDiscovery({ band_id: band, display_name: 'N', summary: 'x'.repeat(501), accepting_requests: true }), '22023');
  assert.equal(state.calls.filter(x => typeof x === 'object').length, 0);
});

test('pending request lookup is limited to authenticated actor, selected band and pending status', async () => {
  const { api, state } = fixture();
  assert.equal((await api.pendingRequest(band)).id, id);
  const query = state.queries[0];
  assert.equal(query.table, 'band_join_requests');
  assert.deepEqual(query.filters, [['requester_id', user], ['band_id', band], ['status', 'pending']]);
  state.row.requester_id = 'someone-else';
  assert.equal(await api.pendingRequest(band), null);
  state.signedIn = false;
  await denied(() => api.pendingRequest(band), '42501');
});
