/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const BAND = '30000000-0000-4000-8000-000000000003';
const OTHER = '40000000-0000-4000-8000-000000000004';
const OP = '50000000-0000-4000-8000-000000000005';
const REF = 'abcdefghijklmnopqrst';
const ORIGIN = `https://${REF}.supabase.co`;
const SECRET = 'x'.repeat(40);
const env = { NEXT_PUBLIC_SUPABASE_URL: ORIGIN, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fake_server_key',
  CRON_SECRET: SECRET, BANDUP_BAND_LOGO_CLEANUP_PROJECT_REF: REF, BANDUP_BAND_LOGO_CLEANUP_ENABLED: 'true' };
function load(file, dependencies = {}, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, require(name) {
    if (name === 'server-only') return {};
    return name in dependencies ? dependencies[name] : require(name);
  }, Buffer, URL, Request, Response, AbortController, AbortSignal, setTimeout, clearTimeout,
  fetch: () => { throw Error('No real network'); }, console: { info() { assert.fail('Core must not log'); } }, ...globals });
  return mod.exports;
}
const worker = load('src/lib/band-logo-cleanup-worker.ts');
const server = load('src/lib/band-logo-cleanup-server.ts');
function fixture(options = {}) {
  const state = { queue: [BAND], objects: new Map(), renewals: 0, lists: 0, removals: 0,
    finishes: [], buckets: [], claims: 0, ...options };
  let current;
  const storage = {
    async list(prefix, config) {
      assert.equal(prefix, current.band_id); assert.equal(config.offset, 0); assert.equal(config.limit, 100);
      assert.equal(config.sortBy.column, 'name'); assert.equal(config.sortBy.order, 'asc'); state.lists++;
      if (state.listError) return { error: { message: 'sensitive error' }, data: null };
      if (state.invalidEntries) return { data: state.invalidEntries, error: null };
      const rows = [...state.objects.keys()].filter(path => path.startsWith(prefix + '/')).sort().slice(0, 100)
        .map(path => ({ name: path.slice(prefix.length + 1), id: 'object-id', metadata: {} }));
      state.afterList?.(rows, state);
      return { data: rows, error: null };
    },
    async remove(paths) {
      state.removals++;
      for (const path of paths) {
        assert.ok(path.startsWith(current.band_id + '/')); assert.equal(path.split('/').length, 2);
        state.objects.delete(path);
        if (state.partialFailure) { state.partialFailure = false; throw Error('secret-token sensitive filename'); }
      }
      return { data: [], error: null };
    },
  };
  const client = {
    storage: { from(bucket) { assert.equal(bucket, 'band-logos'); state.buckets.push(bucket); return storage; } },
    async rpc(name, args) {
      assert.ok(['bandup_claim_band_logo_cleanup','bandup_renew_band_logo_cleanup','bandup_finish_band_logo_cleanup'].includes(name));
      if (name === 'bandup_claim_band_logo_cleanup') {
        state.claims++;
        if (state.claimError) return { data: null, error: { message: 'sensitive queue failure' } };
        const band = state.queue.shift(); if (!band) return { data: null, error: null };
        current = { operation_id: OP, band_id: band, lease_token: args.p_claim_id,
          bucket_id: 'band-logos', object_prefix: band + '/', ...state.claimPatch };
        return { data: current, error: null };
      }
      assert.equal(args.p_operation_id, current.operation_id); assert.equal(args.p_lease_token, current.lease_token);
      if (name === 'bandup_renew_band_logo_cleanup') {
        state.renewals++;
        return { data: state.renewals !== state.loseAt, error: null };
      }
      state.finishes.push(args.p_outcome);
      if (state.ackLost) { state.ackLost = false; throw Error('private ack payload'); }
      return { data: state.ackNull ? null : args.p_outcome === 'unsafe' ? 'needs_attention' : state.finishStatus ?? 'pending', error: null };
    },
  };
  const controller = new AbortController();
  return { state, client, controller, run: (opts) => worker.runBandLogoCleanup(client, controller.signal, opts) };
}
function fill(f, n, band = BAND) {
  for (let i = 0; i < n; i++) f.state.objects.set(`${band}/${randomUUID()}.png`, true);
}
test('drains from offset zero, verifies emptiness, preserves another band', async () => {
  const f = fixture(); fill(f, 205); fill(f, 3, OTHER);
  const result = await f.run();
  assert.equal(result.objectsRequested, 205); assert.equal(result.listCalls, 4); assert.equal(result.deleteCalls, 3);
  assert.equal(result.emptyChecks, 1); assert.equal(f.state.objects.size, 3);
  assert.equal(f.state.finishes[0], 'empty'); assert.equal(result.failures, 0);
});
test('caps each job at five deletion rounds and repeats safely next invocation', async () => {
  const f = fixture(); fill(f, 501); fill(f, 1, OTHER);
  assert.equal((await f.run()).objectsRequested, 500); assert.equal(f.state.finishes[0], 'progress');
  assert.equal(f.state.objects.size, 2); f.state.queue.push(BAND);
  assert.equal((await f.run()).objectsRequested, 1); assert.equal(f.state.objects.size, 1);
});
test('partial committed delete with lost response is retried by listing remaining objects', async () => {
  const f = fixture({ partialFailure: true }); fill(f, 3); fill(f, 1, OTHER);
  assert.equal((await f.run()).failures, 1); assert.equal(f.state.finishes[0], 'retry');
  f.state.queue.push(BAND); const next = await f.run();
  assert.equal(next.objectsRequested, 2); assert.equal(next.failures, 0); assert.equal(f.state.objects.size, 1);
});
for (const loseAt of [1,2]) test(`lost lease at renewal ${loseAt} never deletes or acknowledges`, async () => {
  const f = fixture({ loseAt }); fill(f, 1);
  const result = await f.run(); assert.equal(result.lostLeases, 1);
  assert.equal(f.state.removals, 0); assert.equal(f.state.finishes.length, 0); assert.equal(f.state.objects.size, 1);
});
for (const claimPatch of [{ bucket_id: 'avatars' },{ band_id: '../bad' },{ object_prefix: OTHER + '/' },
  { operation_id: 'invalid' },{ lease_token: 'other' }]) test(`invalid claim stops before Storage: ${Object.keys(claimPatch)[0]}`, async () => {
  const f = fixture({ claimPatch }); assert.equal((await f.run()).failures, 1); assert.equal(f.state.buckets.length, 0);
});
for (const entry of [ { name: '../other.png', id: 'id' },{ name: `${OTHER}/${randomUUID()}.png`, id: 'id' },
  { name: '%2fsecret.png', id: 'id' },{ name: randomUUID() + '.png', id: null },
  { name: randomUUID() + '.svg', id: 'id' } ]) test('unsafe list entries require attention without deleting', async () => {
  const f = fixture({ invalidEntries: [entry] }); const result = await f.run();
  assert.equal(result.failures, 1); assert.equal(f.state.removals, 0); assert.equal(f.state.finishes[0], 'unsafe');
});
test('list failure never becomes an empty success', async () => {
  const f = fixture({ listError: true }); const result = await f.run();
  assert.equal(result.emptyChecks, 0); assert.equal(f.state.removals, 0); assert.equal(f.state.finishes[0], 'retry');
});
test('lost acknowledgement and a late upload are recoverable on subsequent invocations', async () => {
  const f = fixture({ ackLost: true }); assert.equal((await f.run()).failures, 1);
  fill(f, 1); f.state.queue.push(BAND); const next = await f.run();
  assert.equal(next.objectsRequested, 1); assert.equal(next.emptyChecks, 1); assert.equal(next.failures, 0);
});
test('stale acknowledgement is inconclusive, never completed', async () => {
  const f = fixture({ ackNull: true }); const result = await f.run();
  assert.equal(result.lostLeases, 1); assert.equal(result.completed, 0);
});
test('three jobs maximum; aborted invocation has no calls', async () => {
  const f = fixture({ queue: [BAND,OTHER,BAND,OTHER] }); assert.equal((await f.run()).claimed, 3);
  assert.equal(f.state.queue.length, 1);
  const aborted = fixture(); aborted.controller.abort(); assert.equal((await aborted.run()).claimed, 0); assert.equal(aborted.state.claims, 0);
});
test('time budget bounds processing without relying on fake completion', async () => {
  const f = fixture(); fill(f, 501); let time = 0;
  const result = await f.run({ now: () => { time += 2000; return time; } });
  assert.ok(result.listCalls < 5); assert.equal(result.completed, 0);
});
test('configuration rejects public keys, mismatched projects and URL overrides', () => {
  assert.equal(server.cleanupConfiguration(env).origin, ORIGIN);
  for (const patch of [{ SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_not_privileged' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },{ NEXT_PUBLIC_SUPABASE_URL: ORIGIN + '/x' },
    { BANDUP_BAND_LOGO_CLEANUP_PROJECT_REF: '' }]) assert.throws(() => server.cleanupConfiguration({ ...env, ...patch }), /configuration unavailable/);
  const token = role => 'header.' + Buffer.from(JSON.stringify({ role, ref: REF })).toString('base64url') + '.signature';
  assert.throws(() => server.cleanupConfiguration({ ...env, SUPABASE_SERVICE_ROLE_KEY: token('anon') }));
  assert.equal(server.cleanupConfiguration({ ...env, SUPABASE_SERVICE_ROLE_KEY: token('service_role') }).origin, ORIGIN);
});
test('cron authorization fails closed without revealing the secret', () => {
  assert.equal(server.cleanupRequestAuthorized('Bearer ' + SECRET, SECRET), true);
  for (const header of [null,'Bearer wrong','Basic ' + SECRET,'Bearer ' + SECRET + 'x']) assert.equal(server.cleanupRequestAuthorized(header, SECRET), false);
  assert.equal(server.cleanupRequestAuthorized('Bearer x','x'), false);
});
test('transport guard rejects avatars, SQL/table endpoints, other projects and mixed-band deletes', async () => {
  let calls = 0;
  const guarded = server.cleanupFetch(ORIGIN, new AbortController().signal, async () => { calls++; return new Response('[]'); });
  const path = `${BAND}/${randomUUID()}.png`;
  const cases = [ [ORIGIN + '/storage/v1/object/avatars','DELETE',{ prefixes: [path] }],
    [ORIGIN + '/rest/v1/rpc/bandup_delete_band','POST',{}], [ORIGIN + '/rest/v1/bands','DELETE',{}],
    ['https://other.supabase.co/rest/v1/rpc/bandup_claim_band_logo_cleanup','POST',{}],
    [ORIGIN + '/storage/v1/object/band-logos','DELETE',{ prefixes: [path, `${OTHER}/${randomUUID()}.png`] }],
    [ORIGIN + '/storage/v1/object/band-logos','DELETE',{ prefixes: [BAND + '/../other.png'] }],
    [ORIGIN + '/storage/v1/object/list/band-logos','POST',{ prefix: BAND, limit: 1000, offset: 0 }] ];
  for (const [url, method, body] of cases) await assert.rejects(guarded(url, { method, body: JSON.stringify(body) }));
  assert.equal(calls, 0);
  await guarded(ORIGIN + '/storage/v1/object/band-logos', { method: 'DELETE', body: JSON.stringify({ prefixes: [path] }) });
  assert.equal(calls, 1);
});
test('installed Supabase SDK works through the transport boundary without real network', async () => {
  let claimed = false, present = true, calls = 0;
  const objectName = randomUUID() + '.png';
  const sdkServer = load('src/lib/band-logo-cleanup-server.ts', {}, { fetch: async (input, init) => {
    calls++; const url = new URL(String(input)); const body = JSON.parse(init.body);
    assert.equal(url.origin, ORIGIN); assert.equal(init.redirect, 'error');
    let value;
    if (url.pathname === '/rest/v1/rpc/bandup_claim_band_logo_cleanup') {
      value = claimed ? null : { operation_id: OP, band_id: BAND, lease_token: body.p_claim_id,
        bucket_id: 'band-logos', object_prefix: BAND + '/' }; claimed = true;
    } else if (url.pathname === '/rest/v1/rpc/bandup_renew_band_logo_cleanup') value = true;
    else if (url.pathname === '/rest/v1/rpc/bandup_finish_band_logo_cleanup') {
      assert.equal(body.p_outcome, 'empty'); value = 'pending';
    } else if (url.pathname === '/storage/v1/object/list/band-logos') {
      assert.equal(body.prefix, BAND); value = present ? [{ name: objectName, id: randomUUID(), metadata: {} }] : [];
    } else {
      assert.equal(url.pathname, '/storage/v1/object/band-logos'); assert.equal(init.method, 'DELETE');
      assert.deepEqual(body.prefixes, [`${BAND}/${objectName}`]); present = false; value = [];
    }
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  } });
  const client = sdkServer.createBandLogoCleanupClient(sdkServer.cleanupConfiguration(env), new AbortController().signal);
  const result = await worker.runBandLogoCleanup(client, new AbortController().signal);
  assert.equal(result.failures, 0); assert.equal(result.objectsRequested, 1); assert.equal(result.emptyChecks, 1);
  assert.ok(calls > 0);
});
function routeFixture(patch = {}, throwing = false) {
  let calls = 0; const logs = [];
  const api = load('src/app/api/cron/band-logo-cleanup/route.ts', {
    '@/lib/band-logo-cleanup-server': { ...server, createBandLogoCleanupClient() { calls++; return {}; } },
    '@/lib/band-logo-cleanup-worker': { async runBandLogoCleanup() {
      if (throwing) throw Error(SECRET + ' sensitive private data');
      return { claimed: 0, failures: 0, lostLeases: 0 };
    } },
  }, { process: { env: { ...env, ...patch } }, console: { info(...value) { logs.push(value); } } });
  return { api, logs, calls: () => calls, request: (header = 'Bearer ' + SECRET, suffix = '') => new Request('https://bandup.example/api/cron/band-logo-cleanup' + suffix,
    { headers: header ? { authorization: header } : {} }) };
}
test('route denies unauthenticated/disabled/query/HEAD calls before creating privileged client', async () => {
  const f = routeFixture(); assert.equal((await f.api.GET(f.request(null))).status, 401);
  assert.equal((await f.api.GET(f.request(undefined,'?band_id=anything'))).status, 400);
  assert.equal(f.api.HEAD().status, 405); assert.equal(f.calls(), 0);
  const disabled = routeFixture({ BANDUP_BAND_LOGO_CLEANUP_ENABLED: 'false' });
  assert.equal((await disabled.api.GET(disabled.request())).status, 503); assert.equal(disabled.calls(), 0);
});
test('route logs only aggregate fields; exception payload is never returned or logged', async () => {
  for (const throwing of [false,true]) {
    const f = routeFixture({},throwing); const response = await f.api.GET(f.request());
    assert.equal(response.status, throwing ? 503 : 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(JSON.stringify(f.logs) + await response.text(), new RegExp(SECRET + '|sensitive private data|service_role'));
  }
});
