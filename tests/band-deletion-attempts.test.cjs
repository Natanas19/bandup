/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/band-deletion-attempts.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: mod, exports: mod.exports });
const { createBandDeletionAttemptStore, validDeletionAttempt } = mod.exports;
const actor = randomUUID(), band = randomUUID();

// A small asynchronous IndexedDB double: serialized transactions, request
// callbacks, atomic commit/abort and cursors. No filesystem, browser or network.
function indexedDBDouble() {
  const rows = new Map(), state = { failCommit: false, failOpen: false, transactions: [], creates: 0 };
  let tail = Promise.resolve();
  const db = {
    close() {}, createObjectStore() {},
    transaction(name, mode, options) {
      assert.equal(name, 'attempts'); assert.equal(options.durability, 'strict');
      state.transactions.push(mode);
      let working, aborted = false, finish, started = false, scheduled = false;
      const ops = [];
      const previous = tail;
      tail = new Promise(resolve => { finish = resolve; });
      const tx = { abort() { aborted = true; schedule(); }, objectStore() { return store; } };
      function schedule() { if (started && !scheduled) { scheduled = true; setImmediate(pump); } }
      function pump() {
        scheduled = false;
        if (aborted) { tx.onabort?.(); finish(); return; }
        const op = ops.shift();
        if (op) { op(); schedule(); return; }
        if (mode === 'readwrite' && state.failCommit) { tx.onabort?.(); finish(); return; }
        if (mode === 'readwrite') { rows.clear(); for (const [k, v] of working) rows.set(k, v); }
        tx.oncomplete?.(); finish();
      }
      function request(op) {
        const r = {};
        ops.push(() => { r.result = op(); r.onsuccess?.(); }); schedule(); return r;
      }
      const store = {
        transaction: tx,
        get: key => request(() => working.get(key)),
        add: (value, key) => request(() => {
          assert.equal(mode, 'readwrite'); assert.equal(working.has(key), false);
          working.set(key, structuredClone(value));
        }),
        delete: key => request(() => { assert.equal(mode, 'readwrite'); working.delete(key); }),
        openCursor() {
          const r = {};
          let iterator;
          const advance = () => { ops.push(() => {
            iterator ??= working.entries(); const next = iterator.next();
            r.result = next.done ? null : { key: next.value[0], value: next.value[1], continue: advance };
            r.onsuccess?.();
          }); schedule(); };
          advance(); return r;
        },
      };
      previous.then(() => { working = new Map(rows); started = true; schedule(); });
      return tx;
    },
  };
  const factory = { open() {
    const r = {};
    setImmediate(() => { if (state.failOpen) { r.onerror?.(); return; } r.result = db; r.onsuccess?.(); });
    return r;
  } };
  const create = project => createBandDeletionAttemptStore(factory, project, () => { state.creates++; return randomUUID(); });
  return { create, rows, state };
}

test('competing tabs atomically share one durable operation ID and immutable confirmation', async () => {
  const f = indexedDBDouble(), tab1 = f.create('demo'), tab2 = f.create('demo');
  const [a, b] = await Promise.all([tab1.getOrCreate(actor, band, 'Exact  '), tab2.getOrCreate(actor, band, 'Other')]);
  assert.equal(a.operationId, b.operationId); assert.equal(b.confirmation, 'Exact  '); assert.equal(f.state.creates, 1);
  assert.equal((await tab2.read(actor, band)).operationId, a.operationId);
  assert.equal(validDeletionAttempt(a), true);
});
test('commit failure rolls back the operation and never returns a usable attempt', async () => {
  const f = indexedDBDouble(), store = f.create('demo'); f.state.failCommit = true;
  await assert.rejects(store.getOrCreate(actor, band, 'Name'));
  assert.equal(f.rows.size, 0); f.state.failCommit = false;
  assert.equal(await store.read(actor, band), null);
});
test('actor, project and band scopes do not collide or expose other pending attempts', async () => {
  const f = indexedDBDouble(), demo = f.create('demo'), prod = f.create('prod'), otherActor = randomUUID(), otherBand = randomUUID();
  const mine = await demo.getOrCreate(actor, band, 'A');
  await demo.getOrCreate(otherActor, band, 'B'); await demo.getOrCreate(actor, otherBand, 'C');
  await prod.getOrCreate(actor, band, 'D');
  const list = await demo.list(actor);
  assert.equal(list.length, 2); assert.ok(list.every(a => a.actorId === actor));
  assert.equal((await demo.read(actor, band)).operationId, mine.operationId);
  assert.notEqual((await prod.read(actor, band)).operationId, mine.operationId);
});
test('confirmed completion deletes only the matching operation, keeping other band and account attempts', async () => {
  const f = indexedDBDouble(), store = f.create('demo'), otherBand = randomUUID();
  const a = await store.getOrCreate(actor, band, 'A'), b = await store.getOrCreate(actor, otherBand, 'B');
  await store.remove({ ...a, operationId: randomUUID() }); assert.equal((await store.read(actor, band)).operationId, a.operationId);
  await store.remove(a); assert.equal(await store.read(actor, band), null);
  assert.equal((await store.read(actor, otherBand)).operationId, b.operationId);
});
test('corrupt records fail closed and are never silently replaced by another operation', async () => {
  const f = indexedDBDouble(), store = f.create('demo');
  const a = await store.getOrCreate(actor, band, 'A');
  for (const [key, value] of f.rows) if (value.operationId === a.operationId) f.rows.set(key, { ...value, actorId: randomUUID() });
  await assert.rejects(store.read(actor, band)); await assert.rejects(store.getOrCreate(actor, band, 'New'));
  await assert.rejects(store.list(actor)); assert.equal(f.state.creates, 1);
});
test('unavailable IndexedDB or malformed IDs prevent creation', async () => {
  const f = indexedDBDouble(); f.state.failOpen = true;
  await assert.rejects(f.create('demo').getOrCreate(actor, band, 'A')); assert.equal(f.rows.size, 0);
  f.state.failOpen = false;
  await assert.rejects(f.create('demo').getOrCreate('bad', band, 'A')); assert.equal(f.rows.size, 0);
  assert.equal(validDeletionAttempt({ version: 1, actorId: actor, bandId: band, operationId: [randomUUID()], confirmation: 'A' }), false);
});
