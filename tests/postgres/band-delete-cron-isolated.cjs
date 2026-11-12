// Imported ONLY by the opt-in fresh-cluster runner. No independent connections or execution.
module.exports = async function runCronChecks(context, { sql, openSession, read, check, wait }) {
  const file = 'supabase/migrations/20261112190000_band_delete_receipts_cron.sql';
  const source = read(file);
  const extensionGate = /DO \$cron_required\$[\s\S]*?END \$cron_required\$;/g;
  check([...source.matchAll(extensionGate)].length === 1, 'Expected exactly one real extension gate');
  // Full unmodified migration MUST fail on absent pg_cron, without installing anything.
  await sql(context, source, 'P0001');
  await sql(context, `DO $$ BEGIN
    IF to_regclass('private.band_deletion_purge_runs') IS NOT NULL
      OR to_regprocedure('private.run_band_deletion_receipts_purge()') IS NOT NULL
    THEN RAISE EXCEPTION 'Missing extension did not fail atomically'; END IF;
    END $$;`);
  await sql(context, read('tests/postgres/band-delete-cron-fixture.sql'));
  // The double tests the catalog API contract only. No fake pg_extension row, no timers.
  // Only the extension/GUC availability gate is omitted, explicitly and in memory.
  const contract = source.replace(extensionGate, '-- Test-only omission: real pg_cron unavailable.');
  const schedule = source.match(/DO \$schedule\$[\s\S]*?END \$schedule\$;/)?.[0];
  check(schedule, 'Scheduling block not found');
  await sql(context, `SELECT cron.schedule('unrelated-control','0 0 * * *','SELECT 1;');
    CREATE TABLE cron_test.original_acl AS
      SELECT oid,proacl::text AS acl FROM pg_proc
      WHERE oid IN ('private.expire_band_deletion_receipts(integer)'::regprocedure,
       'public.bandup_delete_band(uuid,text,uuid)'::regprocedure,
       'public.bandup_get_band_deletion(uuid)'::regprocedure);
    SELECT cron.schedule('bandup-band-deletion-receipts-purge','0 0 * * *','SELECT 2;');`);
  await sql(context, contract, 'P0001');
  await sql(context, `SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('private.run_band_deletion_receipts_purge()')),'conflicting schedule rolls back DDL');
    SELECT cron_test.ok((SELECT command='SELECT 2;' FROM cron.job WHERE jobname='bandup-band-deletion-receipts-purge'),'conflicting schedule unchanged');
    SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='bandup-band-deletion-receipts-purge';
    CREATE ROLE cron_extra NOLOGIN;`);
  for (const [objects, privilege] of [['FUNCTIONS','EXECUTE'],['TABLES','SELECT'],['SEQUENCES','USAGE']]) {
    await sql(context, `ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT ${privilege} ON ${objects} TO cron_extra;`);
    await sql(context, contract, 'P0001');
    await sql(context, `ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ${privilege} ON ${objects} FROM cron_extra;
      SELECT cron_test.ok(to_regclass('private.band_deletion_purge_runs') IS NULL,'unexpected defaults roll back metrics');
      SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='bandup-band-deletion-receipts-purge'),'unexpected defaults roll back schedule');`);
  }
  await sql(context, contract);
  await sql(context, schedule);
  await sql(context, schedule);
  await sql(context, contract, 'P0001');
  await sql(context, `SELECT cron_test.ok((SELECT count(*)=1 FROM cron.job WHERE jobname='bandup-band-deletion-receipts-purge'),'repeated scheduling never duplicates');
    SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM cron_test.original_acl a JOIN pg_proc p USING(oid) WHERE p.proacl::text IS DISTINCT FROM a.acl),'original RPC and expiration ACLs preserved');`);
  const result = await sql(context, read('tests/postgres/band-delete-cron-checks.sql'));
  const assertions = Number(result.out.match(/CRON_ASSERTIONS:(\d+)/)?.[1]);
  check(assertions >= 40, 'Missing cron SQL assertions');
  for (const role of ['anon','authenticated','service_role']) {
    await sql(context, `SET ROLE ${role}; SELECT private.run_band_deletion_receipts_purge();`, '42501');
  }
  await sql(context, 'BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT private.run_band_deletion_receipts_purge();', '25000');
  const ready = async (session, marker) => {
    const deadline = Date.now() + 7000;
    while (!session.output().split(/\r?\n/).includes(marker)) {
      check(Date.now() < deadline, 'Cron concurrency session did not become ready'); await wait(10);
    }
  };
  await sql(context, 'SELECT cron_test.seed_expired(10002,50000);');
  const holder = await openSession(context);
  let closed = false;
  try {
    holder.child.stdin.write(`BEGIN; SELECT operation_id FROM private.band_deletion_receipts
      WHERE expires_at<=clock_timestamp() FOR SHARE; SELECT 'CRON_RECEIPTS_READY';\n`);
    await ready(holder, 'CRON_RECEIPTS_READY');
    await sql(context, `SELECT private.run_band_deletion_receipts_purge();
      SELECT cron_test.ok((SELECT status='limited' AND removed=0 AND backlog_at_least=10001 AND backlog_capped
       AND oldest_expired_at IS NOT NULL FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'locked receipts leave capped measurable backlog');`);
    holder.child.stdin.end('COMMIT;\n');
    const result = await holder.done; closed = true;
    check(result.code === 0, 'Receipt lock holder failed');
  } finally {
    if (!closed) { holder.child.stdin.end('ROLLBACK;\n'); await holder.done.catch(() => {}); }
  }
  await sql(context, `SELECT private.run_band_deletion_receipts_purge();
    SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM private.band_deletion_receipts WHERE expires_at<=clock_timestamp()),'next pass drains previously locked backlog');`);
  const singleton = await openSession(context);
  closed = false;
  try {
    singleton.child.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('bandup-receipt-cron-run',0)); SELECT 'CRON_SINGLETON_READY';\n`);
    await ready(singleton, 'CRON_SINGLETON_READY');
    await sql(context, `SELECT private.run_band_deletion_receipts_purge();
      SELECT cron_test.ok((SELECT status='skipped' AND attempts=0 AND removed=0 FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'overlapping invocation is skipped');`);
    singleton.child.stdin.end('COMMIT;\n');
    const result = await singleton.done; closed = true;
    check(result.code === 0, 'Singleton holder failed');
  } finally {
    if (!closed) { singleton.child.stdin.end('ROLLBACK;\n'); await singleton.done.catch(() => {}); }
  }
  await sql(context, `SELECT cron_test.seed_expired(1,70000);
    UPDATE cron_test.failure_mode SET mode='timeout';
    CREATE TABLE cron_test.before_timeout AS SELECT count(*) AS n FROM private.band_deletion_purge_runs;`);
  await sql(context, `SET statement_timeout='100ms'; SELECT private.run_band_deletion_receipts_purge();`, '57014');
  await sql(context, `SELECT cron_test.ok((SELECT count(*)=(SELECT n FROM cron_test.before_timeout) FROM private.band_deletion_purge_runs),'hard timeout rolls back metrics');
    SELECT cron_test.ok(EXISTS(SELECT 1 FROM private.band_deletion_receipts WHERE operation_id=md5('cron-operation:70001')::uuid),'hard timeout preserves expired receipt for retry');
    UPDATE cron_test.failure_mode SET mode='off';
    SELECT private.run_band_deletion_receipts_purge();
    SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM private.band_deletion_receipts WHERE expires_at<=clock_timestamp()),'post-timeout retry succeeds');
    SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM cron_test.original_acl a JOIN pg_proc p USING(oid) WHERE p.proacl::text IS DISTINCT FROM a.acl),'original ACLs still unchanged');`);
  return { sqlAssertions: assertions, scheduling: 'contract double; actual pg_cron NOT installed or exercised',
    missingExtensionRejected: true, defaultAclRollback: true, duplicateJobsPrevented: true,
    lockedBacklog: true, singleton: true, hardTimeoutRollback: true };
};
