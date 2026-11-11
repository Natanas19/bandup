/* eslint-disable @typescript-eslint/no-require-imports */
// Static and simulated-process tests only: no real psql or network is invoked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { target, validateConnection, guard, marker, openSession } = require('./helpers/band-leave-postgres.cjs');

test('only exact explicit password-free target accepted; child destination is pinned', () => {
  const env = validateConnection(target, { PATH: 'test-path', PGPASSFILE: 'test-auth-file' });
  assert.equal(env.PGHOST, '127.0.0.1'); assert.equal(env.PGHOSTADDR, '127.0.0.1');
  assert.equal(env.PGPORT, '5433'); assert.equal(env.PGDATABASE, 'bandup_leave_test');
  assert.equal(env.PGUSER, 'postgres'); assert.equal(env.PGPASSFILE, 'test-auth-file');
  assert.equal(env.PATH, 'test-path');
});
test('server guard checks every effective destination field before the marker', () => {
  for (const pattern of [
    /current_database\(\) IS DISTINCT FROM 'bandup_leave_test'/,
    /inet_server_addr\(\) IS DISTINCT FROM '127\.0\.0\.1'::inet/,
    /inet_server_port\(\) IS DISTINCT FROM 5433/,
    /session_user IS DISTINCT FROM 'postgres'/,
    /current_user IS DISTINCT FROM 'postgres'/,
    /server_version_num.*BETWEEN 170000 AND 179999/,
  ]) assert.match(guard, pattern);
  assert.match(marker, /bandup-leave-local-v1/);
});
for (const url of [undefined, '', 'host=127.0.0.1 dbname=bandup_leave_test',
  target.replace('127.0.0.1', 'localhost'), target.replace('127.0.0.1', '[::1]'),
  target.replace('127.0.0.1', 'example.invalid'), target.replace('5433', '5432'),
  target.replace(':5433', ''), target.replace('bandup_leave_test', 'postgres'),
  target.replace('postgres@', 'authenticated@'), target.replace('postgresql:', 'https:'),
  target + '?host=example.invalid', target + '?hostaddr=192.0.2.1', target + '?service=external',
  target + '?dbname=other', target + '?port=5432', target + '#fragment', target + '/',
  target.replace('127.0.0.1', '127.1'), target.replace('bandup_leave_test', '%62andup_leave_test'),
  target.replace('postgres@', 'postgres:@')]) {
  test('reject noncanonical or alternate connection without exposing input', () => {
    assert.throws(() => validateConnection(url, {}), error => {
      assert.equal(error.message, 'Use only the documented password-free local test URL'); return true;
    });
  });
}
for (const key of ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSERVICE',
  'PGSERVICEFILE', 'PGOPTIONS', 'PGPASSWORD', 'PGSSLMODE', 'pgHost']) {
  test(`reject inherited ${key} rather than silently accepting ambiguity`, () => {
    assert.throws(() => validateConnection(target, { [key]: 'not-logged' }), /ambiguous PG/);
  });
}
function fakeProcess(accept = true) {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = new EventEmitter(); child.writes = [];
  child.stdin.write = sql => {
    child.writes.push(sql);
    setImmediate(() => accept ? child.stdout.emit('data', 'BANDUP_GATE_READY\n') : child.emit('close', 1));
  };
  child.stdin.end = sql => { child.writes.push(sql); child.emit('close', 0); };
  child.kill = () => child.emit('close', 1);
  return child;
}
test('invalid destination fails before spawning a process', async () => {
  let spawned = false;
  await assert.rejects(openSession({ url: target + '?host=remote', env: {}, spawnProcess() { spawned = true; } }));
  assert.equal(spawned, false);
});
test('each new session checks effective destination and bootstrap before caller SQL', async () => {
  for (let i = 0; i < 3; i++) {
    const child = fakeProcess();
    const s = await openSession({ url: target, env: {}, spawnProcess(cmd, args) {
      assert.equal(cmd, 'psql'); assert.ok(args.includes('-X')); assert.ok(args.includes('-w')); return child;
    } });
    assert.equal(child.writes.length, 1);
    assert.ok(child.writes[0].includes(guard)); assert.ok(child.writes[0].includes(marker));
    s.p.stdin.end('TEST_ONLY_CALLER_SQL'); await s.done;
    assert.equal(child.writes[1], 'TEST_ONLY_CALLER_SQL');
  }
});
test('failed server gate sends no caller SQL and terminates the session', async () => {
  const child = fakeProcess(false);
  await assert.rejects(openSession({ url: target, env: {}, spawnProcess: () => child }), /no test SQL was sent/);
  assert.equal(child.writes.length, 1);
  assert.doesNotMatch(child.writes[0], /INSERT|UPDATE|DELETE|CREATE TABLE|DROP TABLE/);
});
test('setup still enforces real destination while allowing an absent bootstrap', async () => {
  const child = fakeProcess();
  const s = await openSession({ url: target, env: {}, requireBootstrap: false, spawnProcess: () => child });
  assert.ok(child.writes[0].includes(guard)); assert.ok(!child.writes[0].includes(marker));
  child.stdin.end(''); await s.done;
});
test('SQL bootstrap is minimal, refuses collisions and copies the original trigger functions exactly', () => {
  const bootstrap = fs.readFileSync('tests/postgres/band-leave-bootstrap.sql', 'utf8').replace(/\r\n/g, '\n');
  const source = fs.readFileSync('supabase/migrations/20261001000000_initial_bandup_schema.sql', 'utf8').replace(/\r\n/g, '\n');
  for (const name of ['add_band_creator_as_admin', 'prevent_last_band_admin_removal']) {
    const start = source.indexOf(`CREATE OR REPLACE FUNCTION private.${name}()`);
    const body = source.slice(start, source.indexOf('$$;', start) + 3);
    assert.ok(bootstrap.includes(body), `Exact source copy required for ${name}`);
  }
  assert.match(bootstrap, /to_regnamespace\('auth'\) IS NOT NULL/);
  assert.match(bootstrap, /created-role:/);
  assert.match(bootstrap, /current_setting\('request.jwt.claim.role', true\)/);
  assert.doesNotMatch(bootstrap, /CREATE TABLE public\.(events|social_links)|storage\./);
});
test('cleanup is guarded, tracks new roles, never drops the database and never cascades', () => {
  const sql = fs.readFileSync('tests/postgres/band-leave-cleanup.sql', 'utf8').replace(/--[^\n]*/g, '');
  assert.match(sql, /current_database\(\).*bandup_leave_test/);
  assert.match(sql, /inet_server_port\(\).*5433/);
  assert.match(sql, /bandup-leave-local-v1/);
  assert.match(sql, /created-role:%/);
  assert.doesNotMatch(sql, /CASCADE|DROP DATABASE|DROP SCHEMA public|DROP OWNED/i);
});
test('all real test sessions including cleanup use the gate and preserve the original cases', () => {
  const source = fs.readFileSync('tests/band-leave-postgres.test.cjs', 'utf8');
  assert.match(source, /const session = \(\) => openSession\(\{ url \}\)/);
  assert.match(source, /const s = await session\(\)/);
  assert.match(source, /const holder = await session\(\)/);
  assert.match(source, /if \(fixturesStarted\) await run\(`BEGIN; DELETE/);
  assert.doesNotMatch(source, /require\('node:child_process'\)/);
  for (const scenario of ['only authenticated role', 'ordinary member leaves', 'last admin promotes',
    'another admin', 'creation time', 'only member cannot leave', 'outer transaction rollback',
    'concurrent leave', 'lock contention in a different band', 'direct concurrent removal']) {
    assert.ok(source.includes(scenario));
  }
});
