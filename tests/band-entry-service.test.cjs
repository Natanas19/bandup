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
  process: { env: { NODE_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' } }, URL });

const band = 'a0000000-0000-0000-0000-000000000001';
const otherBand = 'a0000000-0000-0000-0000-000000000002';
const user = 'b0000000-0000-0000-0000-000000000001';
const id = 'c0000000-0000-0000-0000-000000000001';
function fixture() {
  const state = { role: 'admin', signedIn: true, calls: [], queries: [],
    row: { id, band_id: band, requester_id: user, status: 'pending' }, error: null, isMember: false, searchRows: [] };
  const client = {
    auth: { async getUser() { state.calls.push('auth'); return { data: { user: state.signedIn ? { id: user } : null }, error: null }; } },
    from(table) {
      const q = { table, filters: [] }; state.queries.push(q);
      const result = () => {
        const value = table === 'band_members' ? (q.columns === 'user_id' ? state.isMember ? { user_id: user } : null : { role: state.role }) : state.row;
        const matches = table === 'band_members' ? value !== null : value && q.filters.every(([key, expected]) => value[key] === expected);
        return { data: q.single ? matches ? value : null : matches ? [value] : [], error: null };
      };
      return { select(columns) { q.columns = columns; return this; }, eq(...args) { q.filters.push(args); return this; },
        order(...args) { (q.orders ??= []).push(args); return this; }, range(...args) { q.range = args; return this; },
        maybeSingle() { q.single = true; return Promise.resolve(result()); }, then(resolve) { return Promise.resolve(result()).then(resolve); } };
    },
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (state.error) return { data: null, error: state.error };
      const data = name === 'bandup_request_entry' ? id : name === 'bandup_pending_request_avatars' ? state.avatarRows
        : name === 'bandup_discover_bands_v2' ? typeof state.searchRows === 'function' ? state.searchRows(args) : state.searchRows : null;
      return { data, error: null };
    },
  };
  return { state, client, api: demo.exports.createBandEntryService(client) };
}
const denied = (operation, code) => assert.rejects(operation, error => error.code === code);

test('request avatars use one bounded RPC and associate only requested IDs regardless of return order', async () => {
  const f = fixture(), second = 'c0000000-0000-0000-0000-000000000002';
  f.state.avatarRows = [{ request_id: second, avatar_url: 'second-photo' },
    { request_id: id, avatar_url: null }, { request_id: otherBand, avatar_url: 'unrequested' }];
  const result = await f.api.pendingRequestAvatars(band, [id, second, id]);
  assert.equal(result.get(second), 'second-photo'); assert.equal(result.get(id), null);
  assert.equal(result.has(otherBand), false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.calls.filter(c => c?.name))), [{
    name: 'bandup_pending_request_avatars', args: { p_band_id: band, p_request_ids: [id, second] },
  }]);
  assert.equal(f.state.queries.some(q => q.table !== 'band_members'), false);
});

test('request avatar service skips empty batches, rejects invalid/oversized input and enforces admin checks', async () => {
  const f = fixture(); assert.equal((await f.api.pendingRequestAvatars(band, [])).size, 0);
  assert.equal(f.state.calls.length, 0);
  for (const ids of [Array(21).fill(id), ['invalid']]) await denied(() => f.api.pendingRequestAvatars(band, ids), '22023');
  assert.equal(f.state.calls.length, 0);
  f.state.role = 'member'; await denied(() => f.api.pendingRequestAvatars(band, [id]), '42501');
  assert.equal(f.state.calls.filter(c => c?.name).length, 0);
});

test('request avatar RPC errors propagate independently and non-string URLs become missing avatars', async () => {
  const f = fixture(); f.state.error = { code: '42501' };
  await denied(() => f.api.pendingRequestAvatars(band, [id]), '42501');
  f.state.error = null; f.state.avatarRows = [{ request_id: id, avatar_url: {} }];
  assert.equal((await f.api.pendingRequestAvatars(band, [id])).get(id), null);
});

test('feature is enabled by valid configured Supabase URL and publishable key in any deployment', async () => {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const enabled = { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key' };
  const load = env => {
    const gateModule = { exports: {} };
    vm.runInNewContext(source, { module: gateModule, exports: gateModule.exports, process: { env }, URL });
    return gateModule.exports;
  };
  for (const env of [{}, { ...enabled, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: undefined },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: 'http://project.supabase.co' },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/evil' },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: 'https://user:pass@project.supabase.co' },
    { ...enabled, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' }]) {
    const api = load(env);
    assert.equal(api.BAND_ENTRY_BACKEND_VALIDATED, false);
    await denied(() => api.createBandEntryService({}).discover(), 'blocked');
  }
  for (const suffix of ['', '/', '/rest/v1', '/rest/v1/']) {
    const env = { ...enabled, NEXT_PUBLIC_SUPABASE_URL: enabled.NEXT_PUBLIC_SUPABASE_URL + suffix };
    const { client, state } = fixture();
    const api = load(env);
    assert.equal(api.BAND_ENTRY_BACKEND_VALIDATED, true, `configured URL suffix: ${suffix}`);
    await api.createBandEntryService(client).discover();
    assert.ok(state.calls.includes('auth'));
  }
});

test('production gate blocks every read/mutation before any client call', async () => {
  assert.equal(BAND_ENTRY_BACKEND_VALIDATED, false);
  const { client, state } = fixture();
  const api = createBandEntryService(client, true); // Extra arguments cannot bypass the production gate.
  for (const op of [() => api.discover(), () => api.ownRequests(), () => api.adminRequests(band),
    () => api.request(band, 'Name'),
    () => api.cancel(id), () => api.decide(band, id, 'approved'), () => api.getRequest(id), () => api.pendingRequest(band)]) await denied(op, 'blocked');
  assert.equal(state.calls.length + state.queries.length, 0);
});

test('search and entry RPC arguments never supply user identity or role', async () => {
  const { api, state } = fixture();
  await api.discover();
  assert.equal(await api.request(band, ' Musician '), id);
  await api.cancel(id); await api.decide(band, id, 'approved');
  const calls = JSON.parse(JSON.stringify(state.calls.filter(x => typeof x === 'object')));
  assert.deepEqual(calls, [
    { name: 'bandup_discover_bands_v2', args: { p_after: null, p_limit: 20 } },
    { name: 'bandup_request_entry', args: { p_band_id: band, p_applicant_name: 'Musician' } },
    { name: 'bandup_cancel_entry', args: { p_request_id: id } },
    { name: 'bandup_decide_entry', args: { p_request_id: id, p_decision: 'approved' } },
  ]);
});

test('requests are scoped by current Auth user or verified administrator band and bounded', async () => {
  const { api, state } = fixture();
  await api.ownRequests(20); await api.adminRequests(band);
  const queries = JSON.parse(JSON.stringify(state.queries.filter(x => x.table === 'band_join_requests')));
  assert.deepEqual(queries[0].filters, [['requester_id', user], ['status', 'pending']]);
  assert.deepEqual(queries[0].range, [20, 39]);
  assert.deepEqual(queries[1].filters, [['band_id', band]]);
  assert.deepEqual(queries[1].range, [0, 19]);
  assert.equal(queries[0].orders.length, 2);
  await denied(() => api.ownRequests(-1), '22023');
});

test('own requests show only pending status while individual lookup preserves terminal history', async () => {
  const { api, state } = fixture();
  for (const status of ['pending', 'approved', 'rejected', 'cancelled']) {
    state.row.status = status;
    const rows = await api.ownRequests();
    assert.equal(rows.length, status === 'pending' ? 1 : 0, status);
    assert.equal((await api.getRequest(id)).status, status);
    assert.equal(state.row.status, status, 'listing does not modify the stored request');
  }
  assert.equal(state.calls.some(call => call?.name), false, 'listing never calls a mutation RPC');
});

test('fresh auth and admin role are checked for every administrative operation', async () => {
  const { api, state } = fixture();
  await api.adminRequests(band);
  state.role = 'member';
  for (const op of [() => api.adminRequests(band), () => api.decide(band, id, 'approved')]) await denied(op, '42501');
  assert.equal(state.calls.filter(x => typeof x === 'object').length, 0);
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

test('invalid identifiers and names are rejected before mutation', async () => {
  const { api, state } = fixture();
  await denied(() => api.request('bad', 'Name'), '22023');
  await denied(() => api.request(band, '   '), '22023');
  await denied(() => api.request(band, 'x'.repeat(81)), '22023');
  await denied(() => api.decide(band, id, 'admin'), '22023');
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


test('admin pending panel filters status before pagination and rechecks role', async () => {
  const { api, state } = fixture();
  await api.adminRequests(band, 20, true);
  const q = state.queries.find(q => q.table === 'band_join_requests');
  assert.deepEqual(q.filters, [['band_id', band], ['status', 'pending']]);
  assert.deepEqual(q.range, [20, 39]);
  state.role = 'member';
  await denied(() => api.adminRequests(band, 0, true), '42501');
});


test('existing member cannot request entry and never calls the write RPC', async () => {
  const { api, state } = fixture(); state.isMember = true;
  await denied(() => api.request(band, 'Name'), '23505');
  assert.equal(state.calls.some(call => call?.name === 'bandup_request_entry'), false);
});

test('entry eligibility distinguishes current membership, pending request and eligible user', async () => {
  const { api, state } = fixture();
  assert.equal(await api.entryEligibility(band), 'pending');
  let requestQuery = state.queries.at(-1);
  assert.deepEqual(requestQuery.filters, [['requester_id', user], ['band_id', band], ['status', 'pending']]);

  state.row.status = 'rejected';
  assert.equal(await api.entryEligibility(band), 'eligible');
  state.isMember = true;
  assert.equal(await api.entryEligibility(band), 'member');
  assert.equal(state.calls.filter(call => call?.name === 'bandup_request_entry').length, 0);
});

test('all-band search ignores legacy directory state and returns only ID, name and optional logo', async () => {
  const { api, state } = fixture();
  state.searchRows = [{ band_id: band, display_name: 'Same name', description: 'private', members: ['private'] },
    { band_id: otherBand, display_name: 'Same name', accepting_requests: false }];
  const found = await api.discover();
  assert.deepEqual(JSON.parse(JSON.stringify(found)), [{ band_id: band, name: 'Same name', logo_url: null }, { band_id: otherBand, name: 'Same name', logo_url: null }]);
  assert.equal(state.queries.length, 0, 'search must not read bands or directory directly');
  assert.equal(state.calls.find(call => call?.name).name, 'bandup_discover_bands_v2');
});


for (const directory of [null, { accepting_requests: false }]) {
  test(`band without enabled legacy directory can be searched and requested: ${JSON.stringify(directory)}`, async () => {
    const { api, state } = fixture();
    state.directory = directory;
    state.searchRows = [{ band_id: band, display_name: 'Registered Band' }];
    assert.equal((await api.discover())[0].band_id, band);
    assert.equal(await api.request(band, 'Name'), id);
    assert.equal(state.queries.some(q => q.table === 'bands' || q.table === 'band_join_directory'), false);
    assert.equal(state.calls.filter(q => q?.name === 'bandup_request_entry').length, 1);
  });
}

test('new search contract preserves UUID pagination and rejects malformed results', async () => {
  const { api, state } = fixture();
  state.searchRows = args => args.p_after === null ? [{ band_id: band, display_name: 'Same' }] : [{ band_id: otherBand, display_name: 'Same' }];
  assert.equal((await api.discover())[0].band_id, band);
  assert.equal((await api.discover(band))[0].band_id, otherBand);
  const pages = state.calls.filter(c => c?.name === 'bandup_discover_bands_v2');
  assert.deepEqual(pages.map(c => c.args.p_after), [null, band]);
  for (const rows of [null, [{ band_id: 'invalid', name: 'Band' }], [{ band_id: band, name: 'Unexpected contract' }]]) {
    state.searchRows = rows;
    await assert.rejects(() => api.discover());
  }
});

test('discovery v2 forwards nullable logos and strips all other server fields without extra queries', async () => {
  const { api, state } = fixture();
  const logo = 'https://project.supabase.co/storage/v1/object/public/band-logos/' + band + '/photo.png';
  for (const [value, expected] of [[logo, logo], [null, null], [undefined, null], [42, null]]) {
    state.searchRows = [{ band_id: band, display_name: 'Band', logo_url: value,
      summary: 'private', description: 'private', members: ['private'] }];
    assert.deepEqual(JSON.parse(JSON.stringify(await api.discover())), [{ band_id: band, name: 'Band', logo_url: expected }]);
  }
  assert.equal(state.queries.length, 0);
  state.signedIn = false;
  const before = state.calls.filter(c => c?.name).length;
  await denied(() => api.discover(), '42501');
  assert.equal(state.calls.filter(c => c?.name).length, before);
});

test('server duplicate refusal is propagated without a repeated write', async () => {
  const { api, state } = fixture(); state.error = { code: '23505' };
  await denied(() => api.request(band, 'Name'), '23505');
  assert.equal(state.calls.filter(c => c?.name === 'bandup_request_entry').length, 1);
});
