/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const { test } = require('node:test');

// Transaction-shaped browser storage double: no disk, credentials or network.
function fixture(options = {}) {
  let record;
  const state = { now: 1000, closes: 0 };
  const database = { close() { state.closes++; }, createObjectStore() {},
    transaction() {
      const before = record;
      const tx = { aborted: false, abort() { this.aborted = true; record = before; queueMicrotask(() => tx.onabort?.()); },
        objectStore() { return {
          get() { const req = {}; queueMicrotask(() => {
            req.result = record; req.onsuccess?.();
            queueMicrotask(() => { if (!tx.aborted) tx.oncomplete?.(); });
          }); return req; },
          put(value) { if (options.quota) throw Error('quota'); record = value; },
          delete() { record = undefined; },
        }; },
      }; return tx;
    },
  };
  const indexedDB = { open() { const request = {}; queueMicrotask(() => {
    if (options.blocked) { request.onblocked?.(); return; }
    request.result = database; request.onsuccess?.();
  }); return request; } };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/avatar-draft.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, crypto: webcrypto,
    Date: { now: () => state.now }, setTimeout, clearTimeout,
    ...(options.unavailable ? {} : { indexedDB }),
    require(name) { assert.equal(name, './avatar-upload'); return {
      validateAvatarFile: file => !file || file.type !== 'image/png' || file.size <= 0 ? 'Invalid' : null,
    }; },
  });
  return { api: mod.exports, state, record: () => record };
}
const file = { type: 'image/png', size: 100 };
const user = { id: 'owner-a', email: 'ana@example.com' };

test('signup draft persists file and normalized email without relying on an Auth ID or token', async () => {
  const f = fixture(); const draft = await f.api.saveAvatarDraft(file, ' ANA@example.com ');
  assert.equal(draft.email, 'ana@example.com'); assert.equal(draft.file, file);
  assert.equal(draft.ownerId, undefined);
  assert.match(draft.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal((await f.api.loadAvatarDraft(user)).ownerId, user.id);
  assert.ok(f.state.closes >= 2);
});
test('another email or account ID cannot resume a draft and discards the local photo', async () => {
  for (const other of [{ id: 'owner-b', email: 'other@example.com' }, { id: 'owner-b', email: user.email }]) {
    const f = fixture(); await f.api.saveAvatarDraft(file, user.email); await f.api.loadAvatarDraft(user);
    assert.equal(await f.api.loadAvatarDraft(other), null); assert.equal(f.record(), undefined);
  }
});
test('unbound draft for another email is discarded before any photo can be returned', async () => {
  const f = fixture(); await f.api.saveAvatarDraft(file, user.email);
  assert.equal(await f.api.loadAvatarDraft({ id: 'b', email: 'other@example.com' }), null);
});
test('expired or future-dated drafts are removed on the next access', async () => {
  for (const elapsed of [24 * 60 * 60 * 1000 + 1, -1]) {
    const f = fixture(); await f.api.saveAvatarDraft(file, user.email); f.state.now += elapsed;
    assert.equal(await f.api.loadAvatarDraft(user), null); assert.equal(f.record(), undefined);
  }
});
test('stale completion cannot delete a newer selection', async () => {
  const f = fixture(), old = await f.api.saveAvatarDraft(file, user.email);
  const current = await f.api.saveAvatarDraft(file, user.email);
  await f.api.discardAvatarDraft(old.id); assert.equal(f.record().id, current.id);
  await f.api.discardAvatarDraft(current.id); assert.equal(f.record(), undefined);
});
test('missing, blocked or quota-limited IndexedDB rejects without affecting Auth', async () => {
  for (const options of [{ unavailable: true }, { blocked: true }, { quota: true }]) {
    const f = fixture(options); await assert.rejects(f.api.saveAvatarDraft(file, user.email));
    assert.equal(f.record(), undefined);
  }
});
