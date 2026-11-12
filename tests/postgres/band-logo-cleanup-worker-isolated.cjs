// Called only by the opt-in fresh PostgreSQL cluster runner. No Storage or remote API.
module.exports = async function runLogoWorkerChecks(context, { sql, openSession, read, check, wait }) {
  const source = read('supabase/migrations/20261112200000_band_logo_cleanup_worker.sql');
  await sql(context, `CREATE TABLE cron_test.before_logo_worker_acl AS
    SELECT p.oid,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private');
    CREATE TABLE cron_test.before_logo_worker_jobs AS
    SELECT jsonb_agg(to_jsonb(j) ORDER BY operation_id) AS data FROM private.band_logo_cleanup_jobs j;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO cron_extra;`);
  await sql(context, source, 'P0001');
  await sql(context, `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM cron_extra;
    SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='private.band_logo_cleanup_jobs'::regclass
     AND attname='lease_token' AND NOT attisdropped),'worker installation rollback preserves old queue schema');`);
  await sql(context, source);
  await sql(context, `SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM cron_test.before_logo_worker_acl a JOIN pg_proc p USING(oid)
     WHERE p.proacl::text IS DISTINCT FROM a.acl),'worker preserves all existing function ACLs');
    SELECT cron_test.ok((SELECT data FROM cron_test.before_logo_worker_jobs)=
     (SELECT jsonb_agg(to_jsonb(j)-ARRAY['lease_token','empty_since','last_scanned_at'] ORDER BY operation_id)
      FROM private.band_logo_cleanup_jobs j),'worker installation preserves existing job values');`);
  await sql(context, source, 'P0001');
  const result = await sql(context, read('tests/postgres/band-logo-cleanup-worker-checks.sql'));
  const assertions = Number(result.out.match(/LOGO_WORKER_ASSERTIONS:(\d+)/)?.[1]);
  check(assertions >= 55, 'Missing logo worker assertions');
  await sql(context, 'BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL request.jwt.claim.role=\'service_role\'; SELECT public.bandup_claim_band_logo_cleanup(gen_random_uuid());', '25000');
  await sql(context, `UPDATE private.band_logo_cleanup_jobs SET next_attempt_at='infinity';
    INSERT INTO private.band_deletion_tombstones SELECT md5('worker-concurrent-band:'||g)::uuid FROM generate_series(1,2) g;
    INSERT INTO private.band_deletion_operations SELECT md5('worker-concurrent-op:'||g)::uuid FROM generate_series(1,2) g;
    INSERT INTO private.band_logo_cleanup_jobs(operation_id,band_id)
    SELECT md5('worker-concurrent-op:'||g)::uuid,md5('worker-concurrent-band:'||g)::uuid FROM generate_series(1,2) g;`);
  const holder = await openSession(context);
  let closed = false;
  try {
    holder.child.stdin.write(`BEGIN; SET LOCAL request.jwt.claim.role='service_role'; SET LOCAL ROLE service_role;
      SELECT public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000091');
      SELECT 'LOGO_CLAIM_READY';\n`);
    const deadline = Date.now() + 7000;
    while (!holder.output().split(/\r?\n/).includes('LOGO_CLAIM_READY')) {
      check(Date.now() < deadline, 'Logo claim holder did not become ready'); await wait(10);
    }
    const same = await sql(context, `SET request.jwt.claim.role='service_role'; SET ROLE service_role;
      SELECT public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000091') IS NULL;`);
    check(same.out.split(/\r?\n/).includes('t'), 'Concurrent same claim ID redirected to another band');
    const other = await sql(context, `SET request.jwt.claim.role='service_role'; SET ROLE service_role;
      SELECT public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000092') IS NOT NULL;`);
    check(other.out.split(/\r?\n/).includes('t'), 'Independent claim did not skip locked job');
    holder.child.stdin.end('COMMIT;\n');
    const committed = await holder.done; closed = true;
    check(committed.code === 0, 'Claim holder failed');
  } finally {
    if (!closed) { holder.child.stdin.end('ROLLBACK;\n'); await holder.done.catch(() => {}); }
  }
  await sql(context, `SELECT cron_test.ok((SELECT count(*)=2 AND count(DISTINCT band_id)=2 AND count(DISTINCT lease_token)=2
    FROM private.band_logo_cleanup_jobs WHERE status='processing' AND lease_token IN
    ('aaaaaaaa-0000-4000-8000-000000000091','aaaaaaaa-0000-4000-8000-000000000092')),'concurrent workers own distinct bands');
    SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM cron_test.before_logo_worker_acl a JOIN pg_proc p USING(oid)
     WHERE p.proacl::text IS DISTINCT FROM a.acl),'existing ACLs unchanged after worker tests');`);
  // A renewal that starts before expiry but waits on a row must not resurrect the lease.
  await sql(context, `UPDATE private.band_logo_cleanup_jobs SET lease_until=clock_timestamp()+interval '2 seconds'
    WHERE lease_token='aaaaaaaa-0000-4000-8000-000000000091';`);
  const clockHolder = await openSession(context);
  let clockClosed = false, probe;
  try {
    clockHolder.child.stdin.write(`BEGIN; UPDATE private.band_logo_cleanup_jobs SET updated_at=updated_at
      WHERE lease_token='aaaaaaaa-0000-4000-8000-000000000091'; SELECT 'LOGO_CLOCK_READY';\n`);
    const deadline = Date.now() + 6000;
    while (!clockHolder.output().split(/\r?\n/).includes('LOGO_CLOCK_READY')) {
      check(Date.now() < deadline, 'Clock holder did not become ready'); await wait(10);
    }
    probe = await openSession(context);
    probe.child.stdin.end(`SET application_name='bandup-logo-expiry-probe'; SET request.jwt.claim.role='service_role';
      SELECT public.bandup_renew_band_logo_cleanup((SELECT operation_id FROM private.band_logo_cleanup_jobs
       WHERE lease_token='aaaaaaaa-0000-4000-8000-000000000091'),'aaaaaaaa-0000-4000-8000-000000000091');`);
    let observedWait = false;
    while (true) {
      const status = await sql(context, `SELECT 'CLOCK_WAIT:'||EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE application_name='bandup-logo-expiry-probe' AND wait_event_type='Lock');
        SELECT 'CLOCK_EXPIRED:'||(lease_until<=clock_timestamp()) FROM private.band_logo_cleanup_jobs
        WHERE lease_token='aaaaaaaa-0000-4000-8000-000000000091';`);
      observedWait ||= status.out.includes('CLOCK_WAIT:true');
      if (observedWait && status.out.includes('CLOCK_EXPIRED:true')) break;
      check(Date.now() < deadline, 'Renewal did not cross expiry while waiting'); await wait(10);
    }
    clockHolder.child.stdin.end('COMMIT;\n');
    const released = await clockHolder.done; clockClosed = true;
    check(released.code === 0, 'Clock holder failed');
    const result = await probe.done;
    check(result.code === 0 && result.out.split(/\r?\n/).includes('f'), 'Expired lease was revived after a lock wait');
  } finally {
    if (!clockClosed) { clockHolder.child.stdin.end('ROLLBACK;\n'); await clockHolder.done.catch(() => {}); }
    if (probe) await probe.done.catch(() => {});
  }
  return { sqlAssertions: assertions, defaultAclRollback: true, originalAclsPreserved: true,
    concurrentClaims: true, staleLeaseFencing: true, leaseClockBoundary: true, repeatedEmptyReconciliation: true,
    storage: 'not accessed; Storage API exercised separately with isolated in-memory transport' };
};
