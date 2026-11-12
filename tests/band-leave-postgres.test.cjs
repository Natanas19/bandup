/* eslint-disable @typescript-eslint/no-require-imports */
// OPT-IN ONLY, PostgreSQL 17 at 127.0.0.1:5433/bandup_leave_test, user postgres.
// This test never applies migrations. It creates and deletes its own fixtures.
// Requires the guarded bootstrap, psql and the exact password-free URL.
// See tests/postgres/README-band-leave.md. Every session validates the real server.
// Run only after separately authorizing setup of that disposable database:
// node --test tests/band-leave-postgres.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openSession, validateConnection } = require('./helpers/band-leave-postgres.cjs');
const url = process.env.BANDUP_LEAVE_TEST_DATABASE_URL;

test('real PostgreSQL: authorization, transfers, rollback, tasks and concurrent locks', {
  skip: !url && 'Requires explicitly configured disposable local PostgreSQL; no database was accessed', timeout: 60000,
}, async t => {
  validateConnection(url);
  const session = () => openSession({ url });
  async function run(sql, errorCode) {
    const s = await session(); s.p.stdin.end(sql); const r = await s.done;
    if (errorCode) { assert.notEqual(r.code, 0); assert.ok(r.err.includes(errorCode), `Expected SQLSTATE ${errorCode}`); }
    else assert.equal(r.code, 0, 'Local SQL check failed (inspect disposable database separately)');
    return r.out;
  }
  const users = Array.from({ length: 4 }, randomUUID), bands = [randomUUID(), randomUUID()];
  const memberIds = [randomUUID(), randomUUID()].sort();
  const taskId = randomUUID();
  const identity = user => `SET request.jwt.claim.sub = '${user}'; SET request.jwt.claim.role = 'authenticated'; SET ROLE authenticated;`;
  const call = (user, band = bands[0]) => `${identity(user)} SELECT public.bandup_leave_band('${band}');`;
  const scalar = sql => run(sql);
  async function reset() {
    await run(`BEGIN;
      SET request.jwt.claim.sub = '${users[0]}';
      DELETE FROM public.bands WHERE id IN ('${bands.join("','")}');
      INSERT INTO public.bands(id,name,slug) VALUES
        ('${bands[0]}','Leave test','leave-${bands[0]}'), ('${bands[1]}','Other test','leave-${bands[1]}');
      INSERT INTO public.band_members(id,band_id,user_id,role,created_at) VALUES
        ('${memberIds[0]}','${bands[0]}','${users[1]}','member','2020-01-01'),
        ('${memberIds[1]}','${bands[0]}','${users[2]}','member','2020-01-01');
      COMMIT;`);
  }
  async function withLock(sql, fn) {
    const holder = await session();
    holder.p.stdin.write(`BEGIN; ${sql}; SELECT 'LOCK_READY';\n`);
    try {
      const deadline = Date.now() + 5000;
      while (!holder.output().includes('LOCK_READY')) {
        if (Date.now() > deadline) throw Error('Local lock fixture did not become ready');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await fn();
    } finally {
      holder.p.stdin.end('ROLLBACK;\n'); await holder.done;
    }
  }
  let fixturesStarted = false;
  try {
    // Fail before fixtures if the reviewed RPC is not already installed.
    assert.equal(await scalar("SELECT to_regprocedure('public.bandup_leave_band(uuid)') IS NOT NULL;"), 't');
    fixturesStarted = true;
    await run(`INSERT INTO auth.users(id) VALUES ${users.map(id => `('${id}')`).join(',')};`);
    await reset();
    await t.test('only authenticated role receives EXECUTE; identity and membership required', async () => {
      assert.equal(await scalar("SELECT has_function_privilege('authenticated','public.bandup_leave_band(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.bandup_leave_band(uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.bandup_leave_band(uuid)','EXECUTE');"), 't');
      await run(`SET ROLE authenticated; SELECT public.bandup_leave_band('${bands[0]}');`, '42501');
      // Exercise the JWT role guard even when the SQL role has EXECUTE permission.
      for (const role of ['anon', 'service_role', '']) {
        await run(`SET request.jwt.claim.sub = '${users[0]}'; SET request.jwt.claim.role = '${role}';
          SET ROLE authenticated; SELECT public.bandup_leave_band('${bands[0]}');`, '42501');
      }
      await run(`SET request.jwt.claim.sub = '${users[0]}'; SET ROLE authenticated;
        SELECT public.bandup_leave_band('${bands[0]}');`, '42501');
      await run(`BEGIN ISOLATION LEVEL REPEATABLE READ; ${call(users[0])}`, '25000');
      await run(call(users[3]), '42501');
      await run(call(users[3], randomUUID()), '42501');
    });
    await t.test('ordinary member leaves only own band; tasks remain and assignment clears', async () => {
      await run(`INSERT INTO public.band_members(band_id,user_id,role) VALUES ('${bands[1]}','${users[1]}','member');
        INSERT INTO public.tasks(id,band_id,created_by,assigned_to,title,status,priority)
        VALUES ('${taskId}','${bands[0]}','${users[1]}','${users[1]}','Preserve me','todo','low');`);
      assert.equal(JSON.parse(await run(call(users[1]))).administration_transferred, false);
      assert.equal(await scalar(`SELECT count(*) FROM public.band_members WHERE band_id='${bands[1]}' AND user_id='${users[1]}';`), '1');
      assert.equal(await scalar(`SELECT assigned_to IS NULL AND created_by='${users[1]}' FROM public.tasks WHERE id='${taskId}';`), 't');
    });
    await t.test('last admin promotes oldest with deterministic UUID tie break', async () => {
      await reset();
      assert.equal(JSON.parse(await run(call(users[0]))).administration_transferred, true);
      assert.equal(await scalar(`SELECT role FROM public.band_members WHERE id='${memberIds[0]}';`), 'admin');
      assert.equal(await scalar(`SELECT count(*) FROM public.band_members WHERE band_id='${bands[0]}' AND user_id='${users[0]}';`), '0');
    });
    await t.test('another admin prevents unnecessary promotion', async () => {
      await reset(); await run(`UPDATE public.band_members SET role='admin' WHERE id='${memberIds[1]}';`);
      assert.equal(JSON.parse(await run(call(users[0]))).administration_transferred, false);
      assert.equal(await scalar(`SELECT role FROM public.band_members WHERE id='${memberIds[0]}';`), 'member');
    });
    await t.test('creation time takes precedence over UUID order', async () => {
      await reset();
      await run(`UPDATE public.band_members SET created_at='2019-01-01' WHERE id='${memberIds[1]}';`);
      await run(call(users[0]));
      assert.equal(await scalar(`SELECT role FROM public.band_members WHERE id='${memberIds[1]}';`), 'admin');
      assert.equal(await scalar(`SELECT role FROM public.band_members WHERE id='${memberIds[0]}';`), 'member');
    });
    await t.test('only member cannot leave; existing admin protection stays enabled', async () => {
      await run(call(users[0], bands[1]), 'PBL01');
      assert.equal(await scalar(`SELECT count(*) FROM public.band_members WHERE band_id='${bands[1]}';`), '1');
      await run(`DELETE FROM public.band_members WHERE band_id='${bands[1]}';`, 'P0001');
    });
    await t.test('outer transaction rollback also reverses promotion and task unlinking', async () => {
      await reset();
      await run(`INSERT INTO public.tasks(id,band_id,created_by,assigned_to,title,status,priority)
        VALUES ('${taskId}','${bands[0]}','${users[0]}','${users[0]}','Rollback','todo','low');`);
      await run(`BEGIN; ${call(users[0])} ROLLBACK;`);
      assert.equal(await scalar(`SELECT role FROM public.band_members WHERE id='${memberIds[0]}';`), 'member');
      assert.equal(await scalar(`SELECT assigned_to='${users[0]}' FROM public.tasks WHERE id='${taskId}';`), 't');
    });
    await t.test('concurrent leave holds band lock; second exit aborts without changes', async () => {
      await reset();
      await withLock(call(users[0]), async () => {
        await run(call(users[1]), '42501');
      });
      assert.equal(await scalar(`SELECT count(*) FROM public.band_members WHERE band_id='${bands[0]}';`), '3');
    });
    await t.test('lock contention in a different band cannot block this exit', async () => {
      await withLock(`SELECT id FROM public.bands WHERE id='${bands[1]}' FOR UPDATE`, async () => {
        await run(call(users[2]));
      });
      assert.equal(await scalar(`SELECT count(*) FROM public.band_members WHERE band_id='${bands[0]}';`), '2');
      await reset();
    });
    await t.test('direct concurrent removal/promotion locks oldest; RPC never skips to younger member', async () => {
      for (const mutation of [
        `DELETE FROM public.band_members WHERE id='${memberIds[0]}'`,
        `UPDATE public.band_members SET role='admin' WHERE id='${memberIds[0]}'`,
      ]) {
        await withLock(mutation, async () => { await run(call(users[0]), '55P03'); });
        assert.equal(await scalar(`SELECT role FROM public.band_members WHERE band_id='${bands[0]}' AND user_id='${users[0]}';`), 'admin');
        assert.equal(await scalar(`SELECT count(*) FROM public.band_members WHERE band_id='${bands[0]}';`), '3');
        assert.equal(await scalar(`SELECT role FROM public.band_members WHERE id='${memberIds[1]}';`), 'member');
      }
    });
  } finally {
    if (fixturesStarted) await run(`BEGIN; DELETE FROM public.bands WHERE id IN ('${bands.join("','")}');
      DELETE FROM auth.users WHERE id IN ('${users.join("','")}'); COMMIT;`);
  }
});
