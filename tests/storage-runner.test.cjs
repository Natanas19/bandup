/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configuration, execute, ORIGIN, PROJECT } = require('./storage/run-avatars.cjs');
const env = { BANDUP_STORAGE_CONFIRM: PROJECT, BANDUP_STORAGE_URL: ORIGIN,
  BANDUP_STORAGE_PUBLIC_KEY: 'sb_publishable_fake_public_key_only',
  BANDUP_STORAGE_TEST_EMAIL_A: 'storage+a@example.invalid', BANDUP_STORAGE_TEST_EMAIL_B: 'storage+b@example.invalid' };
test('explicit emails are required, normalized and distinct without exposing values in errors', () => {
  const config = configuration({ ...env, BANDUP_STORAGE_TEST_EMAIL_A: ' Storage+A@example.invalid ' }, ['--execute']);
  assert.deepEqual(config.emails, { A: env.BANDUP_STORAGE_TEST_EMAIL_A, B: env.BANDUP_STORAGE_TEST_EMAIL_B });
  for (const value of [undefined, '', '   ', 'invalid', 'a@@example.invalid', 'a b@example.invalid']) {
    for (const label of ['A', 'B']) assert.throws(() => configuration({ ...env, [`BANDUP_STORAGE_TEST_EMAIL_${label}`]: value }, ['--execute']), /^Error: Two valid disposable emails required$/);
  }
  assert.throws(() => configuration({ ...env, BANDUP_STORAGE_TEST_EMAIL_B: ' STORAGE+A@EXAMPLE.INVALID ' }, ['--execute']), /^Error: Distinct disposable emails required$/);
});
test('opt-in rejects alternate origins, missing confirmation and privileged/ambiguous keys', () => {
  assert.ok(configuration(env, ['--execute']));
  assert.throws(() => configuration(env, []));
  for (const patch of [ { BANDUP_STORAGE_URL: ORIGIN + '/' }, { BANDUP_STORAGE_URL: 'https://other.supabase.co' },
    { BANDUP_STORAGE_CONFIRM: '' }, { BANDUP_STORAGE_PUBLIC_KEY: 'sb_secret_not_allowed_1234567890' },
    { BANDUP_STORAGE_PUBLIC_KEY: 'x.' + Buffer.from(JSON.stringify({ role: 'service_role', ref: PROJECT })).toString('base64url') + '.x' } ]) {
    assert.throws(() => configuration({ ...env, ...patch }, ['--execute']));
  }
});
function fixture(options = {}) {
  const users = [], objects = new Map(), calls = [];
  let saved;
  const response = (value, status = 200) => new Response(Buffer.isBuffer(value) ? value : JSON.stringify(value), { status });
  const request = async (url, init) => {
    assert.ok(saved, 'Manifest precedes network');
    assert.ok(url.startsWith(ORIGIN + '/'));
    assert.equal(init.redirect, 'error');
    calls.push([url, init.method]);
    const route = url.slice(ORIGIN.length), token = init.headers.Authorization?.slice(7);
    const user = users.find(u => u.token === token);
    if (route === '/auth/v1/signup') {
      const input = JSON.parse(init.body);
      assert.equal(input.email, users.length ? env.BANDUP_STORAGE_TEST_EMAIL_B : env.BANDUP_STORAGE_TEST_EMAIL_A);
      const id = `${users.length ? '20000000' : '10000000'}-0000-4000-8000-000000000001`;
      const next = { id, email: input.email, token: 'private-token-' + users.length }; users.push(next);
      return response({ user: next, access_token: next.token });
    }
    if (route === '/auth/v1/user') return response(user);
    if (route.includes('/list/')) {
      const input = JSON.parse(init.body);
      return response([...objects.keys()].filter(p => p.startsWith(user.id + '/') && p.endsWith(input.search)).map(p => ({ name: p.split('/')[1] })));
    }
    if (route.includes('/authenticated/')) return response(objects.get(route.split('/avatars/')[1]));
    if (init.method === 'DELETE') {
      if (options.allowDelete) objects.delete(JSON.parse(init.body).prefixes[0]);
      return response([]);
    }
    const path = route.split('/avatars/')[1];
    assert.ok(JSON.parse(saved).objects.some(o => o.path === path), 'Path persisted before write');
    if (options.serverFailure && path.startsWith(users[1].id) && user?.id === users[0].id) return response({}, 500);
    if (options.transportFailure && init.method === 'PUT') throw Error('sensitive transport detail');
    const allowed = (init.method === 'POST' || (options.allowUpdate && init.method === 'PUT')) && user && (path.startsWith(user.id + '/') || options.allowCross)
      && init.headers['Content-Type'] === 'image/png' && init.body.length <= 2097152;
    if (allowed) { objects.set(path, Buffer.from(init.body)); return response({}); }
    return response({}, 403);
  };
  return { calls, run: () => execute(configuration(env, ['--execute']), { request, persist: value => { saved = value; } }), get saved() { return saved; } };
}
test('full matrix verifies before/after and persists no passwords or tokens', async () => {
  const f = fixture(); const manifest = await f.run();
  assert.equal(manifest.results.length, 8);
  assert.ok(manifest.results.every(r => r.result === 'PASS'));
  assert.doesNotMatch(f.saved, /private-token|password|Authorization|apikey/);
  assert.equal(manifest.accounts.length, 2);
  assert.deepEqual(manifest.accounts.map(a => a.email), [env.BANDUP_STORAGE_TEST_EMAIL_A, env.BANDUP_STORAGE_TEST_EMAIL_B]);
  assert.equal(new Set(manifest.objects.map(o => o.path)).size, 6);
});
for (const option of ['allowCross', 'allowUpdate', 'allowDelete', 'serverFailure', 'transportFailure']) {
  test('stops on ' + option + ' and retains manifest', async () => {
    const f = fixture({ [option]: true });
    await assert.rejects(f.run(), /FAIL_OR_AMBIGUOUS/);
    assert.ok(JSON.parse(f.saved).results.some(r => r.result === 'FAIL_OR_AMBIGUOUS'));
  });
}
test('manifest persistence failure prevents all network', async () => {
  let calls = 0;
  await assert.rejects(execute(configuration(env, ['--execute']), { persist() { throw Error('disk'); }, request() { calls++; } }));
  assert.equal(calls, 0);
});
