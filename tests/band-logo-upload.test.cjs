/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const A = '10000000-0000-4000-8000-000000000001', B = '20000000-0000-4000-8000-000000000002';
const BAND = '30000000-0000-4000-8000-000000000003', OTHER = '40000000-0000-4000-8000-000000000004';
const ATTEMPT = '50000000-0000-4000-8000-000000000005';
const file = { type: 'image/png', size: 100 };
function load(filename, dependency, globals = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, require: dependency, URL, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval, ...globals });
  return mod.exports;
}
function fixture(options = {}) {
  const state = { identity: A, role: 'admin', objects: new Map(), uploads: 0, links: 0, logo: null, ...options };
  const avatar = load('src/lib/avatar-upload.ts', () => { throw Error('No avatar upload allowed'); });
  const storage = {
    getPublicUrl: path => ({ data: { publicUrl: 'https://project.supabase.co/storage/v1/object/public/band-logos/' + path } }),
    async info(path) { return { data: state.objects.get(path) ?? null }; },
    async upload(path, value, config) {
      assert.equal(config.upsert, false); assert.equal(path, `${BAND}/${ATTEMPT}.png`);
      state.uploads++;
      if (!state.uploadFailure || state.uploadCommitted) state.objects.set(path, { size: value.size, contentType: value.type });
      state.afterUpload?.();
      if (state.waitUpload) await state.waitUpload;
      if (state.uploadFailure) throw Error('Lost upload response');
      return { error: null };
    },
    remove() { assert.fail('No automatic deletion'); }, update() { assert.fail('No overwrite'); },
  };
  const scoped = {
    storage: { from(bucket) { assert.equal(bucket, 'band-logos'); return storage; } },
    from(table) {
      const filters = {};
      return { select() { return this; }, eq(k, v) { filters[k] = v; return this; }, async maybeSingle() {
        if (table === 'band_members') {
          assert.equal(filters.band_id, BAND); assert.equal(filters.user_id, A);
          return { data: { role: state.role } };
        }
        assert.equal(filters.id, BAND); return { data: { logo_url: state.logo } };
      } };
    },
    async rpc(name, args) {
      assert.equal(name, 'bandup_set_band_logo'); assert.equal(args.p_band_id, BAND);
      assert.equal(args.p_object_path, `${BAND}/${ATTEMPT}.png`); state.links++;
      if (state.linkDenied) return { error: { code: '42501' } };
      if (!state.linkFailure || state.linkCommitted) state.logo = storage.getPublicUrl(args.p_object_path).data.publicUrl;
      if (state.linkFailure) throw Error('Lost association response');
      return { data: state.logo };
    },
  };
  const client = { auth: { async getSession() { return { data: { session: state.identity ? { user: { id: state.identity }, access_token: 'pinned-A' } : null } }; } } };
  const api = load('src/lib/band-logo-upload.ts', name => {
    if (name === './avatar-upload') return avatar;
    if (name === './development-lab') return { isLaboratoryHttpOrigin: () => false };
    if (name === '@supabase/supabase-js') return { createClient(origin, key, config) {
      assert.equal(origin, 'https://project.supabase.co'); state.config = config; return scoped;
    } };
    throw Error(name);
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key' } },
    setInterval(fn) { state.monitor = fn; return 1; }, clearInterval() {},
    setTimeout(fn) { state.timeout = fn; return 1; }, clearTimeout() {},
    async fetch(url, init) {
      assert.equal(url, 'https://project.supabase.co/auth/v1/user'); assert.equal(init.headers.Authorization, 'Bearer pinned-A');
      return { ok: true, json: async () => ({ id: state.verifiedId ?? A, is_anonymous: state.anonymous }) };
    } });
  const controller = new AbortController();
  return { state, api, client, controller, run: (value = file, band = BAND) => api.uploadBandLogo(client, A, band, value, ATTEMPT, controller.signal) };
}
test('band upload pins identity, confirms object and association; retry does not upload again', async () => {
  const f = fixture(); const url = await f.run();
  assert.match(url, /band-logos/); assert.equal(await f.state.config.accessToken(), 'pinned-A');
  assert.equal(await f.run(), url); assert.equal(f.state.uploads, 1); assert.equal(f.state.links, 2);
});
test('MIME, nonpositive/oversized payload and malformed band UUID fail before upload', async () => {
  for (const value of [{ ...file, type: 'image/gif' }, { ...file, size: 2097153 }, { ...file, size: 0 }]) {
    const f = fixture(); await assert.rejects(f.run(value), e => e.stage === 'validation'); assert.equal(f.state.uploads, 0);
  }
  await assert.rejects(fixture().run(file, 'invalid'), e => e.stage === 'validation');
});
test('another band object is never reused', async () => {
  const f = fixture(); f.state.objects.set(`${OTHER}/${ATTEMPT}.png`, { size: 100, contentType: 'image/png' });
  await f.run(); assert.equal(f.state.uploads, 1); assert.equal(f.state.objects.size, 2);
});
for (const options of [{ identity: B }, { identity: null }, { role: 'member' }, { role: null }, { anonymous: true }, { verifiedId: B }]) {
  test('unauthorized session or member cannot upload: ' + JSON.stringify(options), async () => {
    const f = fixture(options); await assert.rejects(f.run()); assert.equal(f.state.uploads, 0); assert.equal(f.state.links, 0);
  });
}
for (const change of ['identity', 'role']) {
  test('loss of ' + change + ' after upload prevents association', async () => {
    const f = fixture(); f.state.afterUpload = () => { f.state[change] = change === 'identity' ? B : 'member'; };
    await assert.rejects(f.run()); assert.equal(f.state.links, 0);
  });
}
test('ambiguous upload and association responses reconcile safely', async () => {
  const f = fixture({ uploadFailure: true, uploadCommitted: true, linkFailure: true, linkCommitted: true });
  await f.run(); await f.run(); assert.equal(f.state.uploads, 1);
});
test('failed upload and failed/denied association do not report success', async () => {
  for (const options of [{ uploadFailure: true }, { linkFailure: true }, { linkDenied: true }]) {
    const f = fixture(options); await assert.rejects(f.run());
    if (options.uploadFailure) assert.equal(f.state.links, 0);
  }
});
test('abort prevents writes', async () => {
  const f = fixture(); f.controller.abort(); await assert.rejects(f.run()); assert.equal(f.state.uploads, 0);
});
test('abort interrupts a pending Auth lock without later creating a scoped client', async () => {
  const f = fixture(); f.client.auth.getSession = () => new Promise(() => {});
  const running = f.run(); f.controller.abort(); await assert.rejects(running);
  assert.equal(f.state.uploads, 0); assert.equal(f.state.config, undefined);
});
test('timeout retains retry capability and does not associate an interrupted upload', async () => {
  let release;
  const f = fixture({ waitUpload: new Promise(resolve => { release = resolve; }) });
  const running = f.run();
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
  f.state.timeout(); release();
  await assert.rejects(running, e => e.stage === 'upload'); assert.equal(f.state.links, 0);
  f.state.waitUpload = null; await f.run(); assert.equal(f.state.uploads, 1);
});
test('authorization monitor cancels pending work after demotion', async () => {
  let release;
  const f = fixture({ waitUpload: new Promise(resolve => { release = resolve; }) });
  const running = f.run();
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
  f.state.role = 'member'; f.state.monitor();
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
  release(); await assert.rejects(running, e => e.stage === 'authorization'); assert.equal(f.state.links, 0);
});
test('creation recovers lost INSERT using stable unique slug, without another insert', async () => {
  const api = load('src/lib/band-creation.ts', () => {});
  let inserted = 0, row;
  const client = { from() { return { select() { return this; }, eq(k, v) { assert.equal(k, 'slug'); assert.equal(v, 'same-slug'); return this; },
    async insert(value) { inserted++; assert.equal(value.slug, 'same-slug'); row = { id: BAND }; throw Error('Response lost'); },
    async maybeSingle() { return { data: row }; } }; } };
  const attempt = { slug: 'same-slug', sent: false };
  assert.equal(await api.ensureCreatedBand(client, attempt, 'Band', ''), BAND);
  assert.equal(await api.ensureCreatedBand(client, attempt, 'Band', ''), BAND);
  assert.equal(inserted, 1);
});
test('creation retry keeps slug even after unresolved response and uniqueness conflict', async () => {
  const api = load('src/lib/band-creation.ts', () => {});
  let writes = 0;
  const client = { from() { return { select() { return this; }, eq() { return this; },
    async insert(value) { assert.equal(value.slug, 'same'); writes++; return { error: { code: '23505' } }; },
    async maybeSingle() { return { data: null }; } }; } };
  const attempt = { slug: 'same', sent: false };
  await assert.rejects(api.ensureCreatedBand(client, attempt, 'Band', ''));
  await assert.rejects(api.ensureCreatedBand(client, attempt, 'Band', ''));
  assert.equal(writes, 2); assert.equal(attempt.slug, 'same');
});
test('creation uses minimal INSERT and reads ID after creator membership commits', async () => {
  const api = load('src/lib/band-creation.ts', () => {});
  let committed = false;
  const client = { from() { return {
    async insert() { committed = true; return { error: null }; },
    select() { assert.equal(committed, true); return this; }, eq() { return this; },
    async maybeSingle() { return { data: { id: BAND } }; },
  }; } };
  assert.equal(await api.ensureCreatedBand(client, { slug: 'stable', sent: false }, 'Band', ''), BAND);
});
