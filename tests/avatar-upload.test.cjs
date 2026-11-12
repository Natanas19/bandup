/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const A = '10000000-0000-4000-8000-000000000001', B = '20000000-0000-4000-8000-000000000002';
const attempt = '30000000-0000-4000-8000-000000000003';
const file = { type: 'image/png', size: 100 };
function fixture(options = {}) {
  const state = { active: A, metadata: {}, objects: new Map(), calls: [], puts: [], ...options };
  const storage = {
    getPublicUrl: path => ({ data: { publicUrl: 'https://project.supabase.co/storage/v1/object/public/avatars/' + path } }),
    async info(path) { state.calls.push(['info', path]); return { data: state.objects.get(path) ?? null, error: null }; },
    async upload(path, value, config) {
      state.calls.push(['upload', path, config]);
      if (!state.uploadError || state.uploadCommitted) state.objects.set(path, { size: value.size, contentType: value.type });
      state.afterUpload?.(); return { error: state.uploadError ?? null };
    },
    remove() { assert.fail('Ambiguous responses must never delete objects'); },
  };
  const client = { auth: {
    async getSession() { return { data: { session: state.active ? { user: { id: state.active }, access_token: 'fixed-token-a' } : null }, error: null }; },
    getUser() { assert.fail('Fixed-token verification must not touch the shared Auth client'); },
    updateUser() { assert.fail('Shared mutable Auth client must not update metadata'); },
  } };
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/avatar-upload.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: loaded, exports: loaded.exports, URL,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key' } },
    async fetch(url, init) {
      assert.equal(init.headers.Authorization, 'Bearer fixed-token-a');
      if (!init.method) {
        state.calls.push(['verify', url]);
        if (state.readWait) await state.readWait;
        if (state.readThrows) throw Error('network');
        return { ok: !state.authError, json: async () => ({ id: state.verifiedId ?? A, is_anonymous: state.anonymous, user_metadata: state.metadata }) };
      }
      state.puts.push({ url, init });
      assert.equal(init.method, 'PUT');
      if (!state.profileError || state.profileCommitted) state.metadata = JSON.parse(init.body).data;
      state.afterPut?.();
      if (state.profileThrows) throw Error('Response lost');
      return { ok: !state.profileError };
    },
    require(name) {
      if (name === '@/lib/development-lab') return { isLaboratoryHttpOrigin: () => false };
      if (name === '@supabase/supabase-js') return { createClient(origin, key, config) {
        state.scoped = { origin, key, config }; return { storage: { from(bucket) { assert.equal(bucket, 'avatars'); return storage; } } };
      } };
      throw Error('Unexpected dependency ' + name);
    },
  });
  return { state, api: loaded.exports, client,
    run: signal => loaded.exports.uploadAvatarForUser(client, A, file, attempt, signal) };
}
test('validation preserves MIME/2 MiB limits, rejecting empty, nonfinite and invalid sizes', () => {
  const { api } = fixture();
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(api.validateAvatarFile({ type, size: 2 * 1024 * 1024 }), null);
  for (const type of ['image/gif', 'image/svg+xml', '', '__proto__']) assert.ok(api.validateAvatarFile({ type, size: 10 }));
  for (const size of [0, -1, NaN, Infinity, 2097153]) assert.ok(api.validateAvatarFile({ type: 'image/png', size }));
});
test('paths contain only a UUID owner, UUID attempt and MIME-derived extension', () => {
  const { api } = fixture();
  for (const [type, ext] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]) {
    assert.equal(api.avatarObjectPath(A, type, attempt), A + '/' + attempt + '.' + ext);
  }
  for (const args of [['../user', 'image/png', attempt], [A, 'image/png', '../file'], [A, '__proto__', attempt]]) {
    assert.equal(api.avatarObjectPath(...args), null);
  }
});
test('valid completion pins Storage and Auth to the verified token and confirms persisted metadata', async () => {
  const f = fixture(); const url = await f.run();
  assert.equal(await f.state.scoped.config.accessToken(), 'fixed-token-a');
  assert.equal(f.state.metadata.avatar_url, url); assert.equal(f.state.puts.length, 1);
  assert.equal(f.state.puts[0].url, 'https://project.supabase.co/auth/v1/user');
  assert.equal(f.state.calls.find(c => c[0] === 'upload')[2].upsert, false);
});
test('missing/mismatched/anonymous identities cannot upload or mutate profiles', async () => {
  for (const options of [{ active: null }, { active: B }, { verifiedId: B }, { anonymous: true }, { authError: { status: 401 } }]) {
    const f = fixture(options); await assert.rejects(f.run(), e => e.stage === 'session');
    assert.equal(f.state.puts.length, 0); assert.ok(!f.state.calls.some(c => c[0] === 'upload'));
  }
});
test('switching accounts during upload blocks metadata mutation; changing during PUT cannot redirect its JWT', async () => {
  const first = fixture(); first.state.afterUpload = () => { first.state.active = B; };
  await assert.rejects(first.run(), e => e.stage === 'session'); assert.equal(first.state.puts.length, 0);
  const second = fixture(); second.state.afterPut = () => { second.state.active = B; };
  await assert.rejects(second.run(), e => e.stage === 'session');
  assert.equal(second.state.puts[0].init.headers.Authorization, 'Bearer fixed-token-a');
});
test('aborted completion cannot issue writes', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(f.run(abort.signal), e => e.stage === 'session'); assert.equal(f.state.puts.length, 0);
});
test('cancellation releases a hung Auth read without allowing a late upload', async () => {
  const f = fixture(), abort = new AbortController();
  let release;
  f.state.readWait = new Promise(resolve => { release = resolve; });
  const result = f.run(abort.signal);
  while (!f.state.calls.some(c => c[0] === 'verify')) await new Promise(setImmediate);
  abort.abort(); await assert.rejects(result, e => e.stage === 'session');
  release(); await new Promise(setImmediate);
  assert.equal(f.state.puts.length, 0); assert.ok(!f.state.calls.some(c => c[0] === 'upload'));
});
test('upload error without a matching persisted object cannot link a photo', async () => {
  const f = fixture({ uploadError: { message: 'private detail' } });
  await assert.rejects(f.run(), e => e.stage === 'upload'); assert.equal(f.state.puts.length, 0);
});
test('lost upload response is reconciled before linking, without overwrite or deletion', async () => {
  const f = fixture({ uploadError: { message: 'network' }, uploadCommitted: true });
  assert.ok(await f.run()); assert.equal(f.state.puts.length, 1);
});
test('lost metadata response is successful only after an authoritative read confirms the URL', async () => {
  const f = fixture({ profileThrows: true, profileCommitted: true, profileError: true });
  assert.ok(await f.run()); assert.equal(f.state.puts.length, 1);
});
test('failed metadata write retains object for idempotent retry and never deletes any previous photo', async () => {
  const f = fixture({ profileError: true });
  await assert.rejects(f.run(), e => e.stage === 'profile');
  f.state.profileError = false; await f.run();
  assert.equal(f.state.calls.filter(c => c[0] === 'upload').length, 1);
});
test('retry of an already linked attempt performs no further upload or metadata write', async () => {
  const f = fixture(); await f.run(); await f.run();
  assert.equal(f.state.puts.length, 1); assert.equal(f.state.calls.filter(c => c[0] === 'upload').length, 1);
});
test('incorrect existing object size/type cannot be linked by retry', async () => {
  const f = fixture({ uploadError: { status: 409 } });
  f.state.objects.set(A + '/' + attempt + '.png', { size: 99, contentType: 'text/html' });
  await assert.rejects(f.run(), e => e.stage === 'upload'); assert.equal(f.state.puts.length, 0);
});
test('Storage migration is review-only and permits only own immutable attempt paths', () => {
  const sql = fs.readFileSync('supabase/migrations/20261109130000_avatars_storage.sql', 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /true[\s\S]*2097152[\s\S]*image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/); assert.match(sql, /RAISE EXCEPTION/);
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 2);
  assert.match(sql, /FOR SELECT\s+TO authenticated/); assert.match(sql, /FOR INSERT\s+TO authenticated/);
  assert.equal((sql.match(/\(SELECT auth\.uid\(\)\)::text/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /FOR UPDATE|FOR DELETE|TO anon|GRANT|DROP POLICY/);
  assert.equal((sql.match(/\[\.\]\(jpg\|png\|webp\)\$/g) ?? []).length, 2);
});
