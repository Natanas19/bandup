/* eslint-disable @typescript-eslint/no-require-imports */
// Deliberately not named *.test.cjs: importing this module never connects.
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const PROJECT = 'zwmihhdvvpqgyavworgh';
const ORIGIN = `https://${PROJECT}.supabase.co`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function check(value, label) { if (!value) throw Error(label); }
function configuration(env, args) {
  check(args.length === 1 && args[0] === '--execute', 'Explicit --execute required');
  check(env.BANDUP_STORAGE_CONFIRM === PROJECT, 'Project confirmation required');
  check(env.BANDUP_STORAGE_URL === ORIGIN, 'Exact Demo origin required');
  const key = env.BANDUP_STORAGE_PUBLIC_KEY;
  check(typeof key === 'string' && key.length > 20, 'Public key required');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch { /* reject below */ }
    check(key.split('.').length === 3 && claims?.role === 'anon' && claims?.ref === PROJECT,
      'Only publishable or project anon keys allowed');
  }
  const emails = {};
  for (const label of ['A', 'B']) {
    const value = env[`BANDUP_STORAGE_TEST_EMAIL_${label}`];
    check(typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()), 'Two valid disposable emails required');
    emails[label] = value.trim().toLowerCase();
  }
  check(emails.A !== emails.B, 'Distinct disposable emails required');
  return { key, emails };
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Synthetic 1x1 PNG, no personal data.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function execute(config, { request = fetch, persist, report = () => {} }) {
  const run = randomUUID();
  const manifest = { project: PROJECT, bucket: 'avatars', run, accounts: [], objects: [], results: [] };
  // Must persist successfully before any remote operation, including signup.
  const save = () => persist(JSON.stringify(manifest, null, 2));
  save();
  async function api(route, token, method = 'GET', body, type = 'application/json') {
    let response;
    try {
      response = await request(ORIGIN + route, { method, redirect: 'error',
        signal: AbortSignal.timeout(20000), cache: 'no-store',
        headers: { apikey: config.key, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': type },
        ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    } catch { throw Error('Transport failure; remote outcome may be ambiguous; inspect manifest'); }
    return response;
  }
  async function json(response) { try { return await response.json(); } catch { throw Error('Invalid response; inspect manifest'); } }
  async function account(label) {
    const entry = { label, email: config.emails[label] };
    manifest.accounts.push(entry); save();
    const response = await api('/auth/v1/signup', null, 'POST', { email: entry.email, password: randomBytes(32).toString('base64url') });
    check(response.ok, 'Disposable signup failed');
    const data = await json(response);
    check(uuid.test(data.user?.id) && typeof data.access_token === 'string', 'Confirmed disposable session required');
    entry.id = data.user.id; save();
    const verified = await api('/auth/v1/user', data.access_token);
    check(verified.ok, 'Identity verification failed');
    const user = await json(verified);
    check(user.id === entry.id && user.email === entry.email && user.is_anonymous !== true, 'Disposable identity mismatch');
    return { id: entry.id, token: data.access_token };
  }
  const a = await account('A'), b = await account('B');
  check(a.id !== b.id, 'Distinct accounts required');
  function object(owner, label) {
    const path = `${owner.id}/${randomUUID()}.png`;
    manifest.objects.push({ label, path }); save(); return path;
  }
  async function snapshot(owner, path) {
    check(path.startsWith(owner.id + '/') && manifest.objects.some(o => o.path === path), 'Unregistered object');
    const name = path.split('/')[1];
    const listing = await api('/storage/v1/object/list/avatars', owner.token, 'POST', { prefix: owner.id, search: name, limit: 100, offset: 0 });
    check(listing.ok, 'Owner listing failed');
    const rows = await json(listing);
    check(Array.isArray(rows), 'Invalid listing');
    if (!rows.some(row => row.name === name)) return null;
    const download = await api('/storage/v1/object/authenticated/avatars/' + path, owner.token);
    check(download.ok, 'Owner content verification failed');
    return hash(Buffer.from(await download.arrayBuffer()));
  }
  async function record(label, work) {
    try { await work(); manifest.results.push({ label, result: 'PASS' }); save(); report(label + ': PASS'); }
    catch { manifest.results.push({ label, result: 'FAIL_OR_AMBIGUOUS' }); save(); throw Error(label + ': FAIL_OR_AMBIGUOUS; stop and inspect manifest'); }
  }
  const upload = (path, token, bytes = PNG, type = 'image/png', method = 'POST') => api('/storage/v1/object/avatars/' + path, token, method, bytes, type);
  async function own(owner, label) {
    const path = object(owner, label);
    await record(label, async () => {
      check(await snapshot(owner, path) === null, 'Path already exists');
      const response = await upload(path, owner.token);
      check(response.ok, 'Own upload failed');
      check(await snapshot(owner, path) === hash(PNG), 'Content mismatch');
    }); return path;
  }
  const ownA = await own(a, 'own-A'); await own(b, 'own-B');
  async function forbidden(label, owner, path, action, allowEmptySuccess = false) {
    await record(label, async () => {
      const before = await snapshot(owner, path);
      let response, transportFailed = false;
      try { response = await action(); } catch { transportFailed = true; }
      const after = await snapshot(owner, path);
      check(before === after, 'Forbidden write changed content/existence');
      check(!transportFailed && response && (response.ok ? allowEmptySuccess : [400, 401, 403, 404, 413, 422].includes(response.status)), 'Denial unconfirmed');
      if (response.ok && allowEmptySuccess) {
        const body = await json(response);
        check(Array.isArray(body) && body.length === 0, 'Delete unexpectedly reported success');
      }
    });
  }
  const cross = object(b, 'cross-owner');
  await forbidden('cross-owner', b, cross, () => upload(cross, a.token));
  const anon = object(a, 'unauthenticated');
  await forbidden('unauthenticated', a, anon, () => upload(anon, null));
  const mime = object(a, 'invalid-MIME');
  await forbidden('invalid-MIME', a, mime, () => upload(mime, a.token, Buffer.from('harmless fixture'), 'text/plain'));
  const big = object(a, 'over-2-MiB');
  await forbidden('over-2-MiB', a, big, () => upload(big, a.token, Buffer.concat([PNG, Buffer.alloc(2097153 - PNG.length)])));
  await forbidden('UPDATE', a, ownA, () => upload(ownA, a.token, Buffer.concat([PNG, Buffer.from('changed')]), 'image/png', 'PUT'));
  await forbidden('DELETE', a, ownA, () => api('/storage/v1/object/avatars', a.token, 'DELETE', { prefixes: [ownA] }), true);
  return manifest;
}
async function main() {
  const config = configuration(process.env, process.argv.slice(2));
  const file = resolve(`bandup-storage-run-${randomUUID()}.json`);
  writeFileSync(file, '{}', { flag: 'wx', mode: 0o600 });
  console.log('Sanitized manifest: ' + file);
  await execute(config, { persist: value => writeFileSync(file, value, { mode: 0o600 }), report: message => console.log(message) });
  console.log('Complete. No automatic cleanup. Retain manifest privately.');
}
if (require.main === module) main().catch(() => { console.error('Stopped. No automatic cleanup. Inspect sanitized manifest; credentials are never logged.'); process.exitCode = 1; });
module.exports = { configuration, execute, ORIGIN, PROJECT };
