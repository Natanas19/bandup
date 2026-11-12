/* eslint-disable @typescript-eslint/no-require-imports */
// Opt-in manual runner. Never connects when imported or by normal node --test.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const BIN = 'C:/Program Files/PostgreSQL/17/bin';
const ROOT = path.resolve(__dirname, '../..');
const SOURCES = ['supabase/migrations/20261001000000_initial_bandup_schema.sql',
  'supabase/migrations/20261002200000_tasks_optional_event_link.sql'];
const CANDIDATE = 'supabase/migrations/20261112180000_band_delete.sql';
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const digest = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(value, message) { if (!value) throw Error(message); }
function cleanEnv() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key))),
    PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable', PGGSSENCMODE: 'disable', PGCLIENTENCODING: 'UTF8' };
}
function command(tool, args) {
  // File descriptors instead of pipes: the background Windows postmaster may
  // inherit pipes and keep Node's child "close" event waiting indefinitely.
  const fd = fs.openSync(command.log, 'a');
  fs.writeSync(fd, '\n'+tool+'\n');
  const child = spawn(path.join(BIN, tool + '.exe'), args, { env: cleanEnv(), windowsHide: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  return new Promise((resolve, reject) => {
    child.on('error', () => reject(Error(tool + ' could not start')));
    child.on('close', code => code === 0 ? resolve() : reject(Error(tool + ' failed; inspect private local log')));
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  check(port !== 5433, 'Refuse shared port'); return port;
}
async function openSession(context, database = context.database) {
  check(/^(postgres|bandup_delete_core_test_[a-f0-9]{12}(?:_enum)?)$/.test(database), 'Unexpected database name');
  const child = spawn(path.join(BIN, 'psql.exe'), ['-X', '-w', '-q', '-A', '-t',
    '-h', '127.0.0.1', '-p', String(context.port), '-U', 'postgres', '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { env: cleanEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '', closed = false;
  child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
  child.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => {
    child.on('error', () => { closed = true; reject(Error('Local psql could not start')); });
    child.on('close', code => { closed = true; resolve({ code, out, err }); });
  });
  done.catch(() => {});
  const timer = setTimeout(() => child.kill(), 20000);
  child.once('close', () => clearTimeout(timer)); child.once('error', () => clearTimeout(timer));
  // The only SQL sent before validation is this SELECT. Never trust the port alone.
  child.stdin.write(`SELECT 'BANDUP_GATE:' || json_build_object(
    'database',current_database(),'address',host(inet_server_addr()),'port',inet_server_port(),
    'version',current_setting('server_version_num')::int,'directory',current_setting('data_directory'),
    'session_user',session_user,'current_user',current_user)::text;\n`);
  try {
    const deadline = Date.now() + 7000;
    let gate;
    while (!gate) {
      const line = out.split(/\r?\n/).find(line => line.startsWith('BANDUP_GATE:'));
      if (line) gate = JSON.parse(line.slice('BANDUP_GATE:'.length));
      else { check(!closed && Date.now() < deadline, 'Local identity gate failed'); await wait(10); }
    }
    check(gate.database === database && gate.address === '127.0.0.1' && gate.port === context.port
      && gate.version >= 170000 && gate.version < 180000
      && fs.realpathSync.native(gate.directory).toLowerCase() === fs.realpathSync.native(context.data).toLowerCase()
      && gate.session_user === 'postgres' && gate.current_user === 'postgres', 'Wrong private cluster identity');
  } catch (error) { child.kill(); await done.catch(() => {}); throw error; }
  return { child, done, output: () => out };
}
async function sql(context, query, expectedState, database) {
  const session = await openSession(context, database);
  session.child.stdin.end(query + '\n'); const result = await session.done;
  const state = result.err.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
  if (result.code !== 0 && !expectedState) {
    fs.appendFileSync(context.log, '\nSQL failure:\n' + result.err);
    throw Error('Local SQL failed (' + (state ?? 'unknown') + '); inspect private local log');
  }
  check(expectedState ? result.code !== 0 && state === expectedState : result.code === 0, 'Unexpected SQLSTATE: ' + (state ?? 'none'));
  return result;
}


async function main() {
  check(process.argv.length === 3 && process.argv[2] === '--execute'
    && process.env.BANDUP_DELETE_LOCAL_TESTS === 'create-isolated-cluster', 'Explicit isolated local opt-in required');
  for (const tool of ['initdb','pg_ctl','psql']) check(fs.existsSync(path.join(BIN,tool+'.exe')), 'PostgreSQL 17 binaries missing');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'bandup-delete-core-'));
  const context = {directory, data:path.resolve(directory,'data'), port:await freePort(),
    database:'bandup_delete_core_test_'+randomUUID().replaceAll('-','').slice(0,12), log:path.join(directory,'private-run.log')};
  command.log = context.log;
  const sources = [CANDIDATE,'tests/postgres/band-delete-rpc-checks.sql',...SOURCES,'tests/postgres/band-delete-bootstrap.sql','tests/postgres/band-delete-dependencies.sql','tests/postgres/band-delete-core-checks.sql',
    'supabase/migrations/20261112190000_band_delete_receipts_cron.sql','tests/postgres/band-delete-cron-fixture.sql',
    'tests/postgres/band-delete-cron-checks.sql','tests/postgres/band-delete-cron-isolated.cjs',
    'supabase/migrations/20261112200000_band_logo_cleanup_worker.sql','tests/postgres/band-logo-cleanup-worker-checks.sql',
    'tests/postgres/band-logo-cleanup-worker-isolated.cjs'];
  const report = {...context, scope:'EXPANDED SYNTHETIC SCHEMA - supplied bridge and CHECK; local base triggers; NOT complete Demo parity',
    hashes:Object.fromEntries(sources.map(file=>[file,digest(file)])), stopped:false};
  const save = () => fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));
  let initialized=false;
  save(); console.log('New private local cluster: '+directory);
  try {
    await command('initdb',['-D',context.data,'-U','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale']);
    initialized=true;
    fs.appendFileSync(path.join(context.data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${context.port}\nunix_socket_directories=''\nmax_connections=10\n`);
    await command('pg_ctl',['-D',context.data,'-l',path.join(directory,'server.log'),'-w','-t','15','start']);
    await sql(context,`CREATE DATABASE "${context.database}";`,null,'postgres');
    await sql(context,read('tests/postgres/band-delete-bootstrap.sql'));
    for (const source of SOURCES) await sql(context,read(source));
    await sql(context,read('tests/postgres/band-delete-dependencies.sql'));
    const result = await sql(context,read('tests/postgres/band-delete-core-checks.sql'));
    report.assertions = Number(result.out.match(/SQL_ASSERTIONS:(\d+)/)?.[1]);
    check(report.assertions >= 45,'Missing expanded assertions');
    // Fail closed if DELETE is inherited: the original grant and all new DDL roll back.
    await sql(context,'CREATE ROLE delete_extra NOLOGIN; GRANT DELETE ON public.bands TO delete_extra; GRANT delete_extra TO authenticated;');
    await sql(context,read(CANDIDATE),'P0001');
    await sql(context,`DO $$ BEGIN
      IF to_regprocedure('public.bandup_delete_band(uuid,text,uuid)') IS NOT NULL OR to_regclass('private.band_logo_cleanup_jobs') IS NOT NULL
      OR NOT has_table_privilege('authenticated','public.bands','DELETE') THEN RAISE EXCEPTION 'Candidate rollback failed'; END IF;
      END $$; REVOKE delete_extra FROM authenticated;`);
    report.inheritedDeleteRejected=true;
    await sql(context,read(CANDIDATE));
    const rpcResult = await sql(context,read('tests/postgres/band-delete-rpc-checks.sql'));
    report.rpcAssertions=Number(rpcResult.out.match(/RPC_ASSERTIONS:(\d+)/)?.[1]);
    check(report.rpcAssertions>=120,'Missing retention RPC assertions');
    await sql(context,read(CANDIDATE),'P0001');
    // Fresh synthetic fixture transaction for two genuinely separate sessions.
    const seed=read('tests/postgres/band-delete-core-checks.sql').split('-- Roll back both the trigger UPDATE')[0];
    await sql(context,seed+'COMMIT;');
    const holder=await openSession(context);
    let holderClosed=false;
    let reuseSession;
    try {
      holder.child.stdin.write(`BEGIN; SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
        SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL ROLE authenticated;
        SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Synthetic band 1','dddddddd-dddd-4ddd-8ddd-000000000001');
        SELECT 'DELETE_HOLDER_READY';\n`);
      const deadline=Date.now()+7000;
      while(!holder.output().split(/\r?\n/).includes('DELETE_HOLDER_READY')) {
        check(Date.now()<deadline,'Concurrency holder did not become ready'); await wait(10);
      }
      const call=`SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
        SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;
        SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Synthetic band 1','dddddddd-dddd-4ddd-8ddd-000000000001');`;
      await sql(context,call,'42501');
      await sql(context,call.replace('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-000000000003').replace('Synthetic band 1','Synthetic band 3'),'42501');
      await sql(context,call.replace('dddddddd-dddd-4ddd-8ddd-000000000001','dddddddd-dddd-4ddd-8ddd-000000000009'),'42501');
      const invisible=await sql(context,`SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
        SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;
        SELECT public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000001') IS NULL;`);
      check(invisible.out.split(/\r?\n/).includes('t'),'Uncommitted receipt became visible');
      const duringDelete=await sql(context,'SELECT private.expire_band_deletion_receipts();');
      check(duringDelete.out.split(/\r?\n/).includes('0'),'Purge interfered with uncommitted deletion');
      // Start INSERT while the old primary key is being deleted but not committed.
      reuseSession=await openSession(context);
      reuseSession.child.stdin.end(`SET application_name='bandup-delete-reuse-probe'; SET statement_timeout='8s';
        SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000004'; SET ROLE authenticated;
        INSERT INTO public.bands(id,name,slug) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Concurrent recreation','concurrent-recreation');`);
      const reuseDeadline=Date.now()+5000;
      while(true) {
        const probe=await sql(context,`SELECT 'REUSE_WAIT:'||EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE application_name='bandup-delete-reuse-probe' AND wait_event_type='Lock');`);
        if(probe.out.includes('REUSE_WAIT:true')) break;
        check(Date.now()<reuseDeadline,'Recreation did not wait on uncommitted primary key'); await wait(10);
      }
      holder.child.stdin.end('COMMIT;\n');
      const committed=await holder.done; holderClosed=true;
      check(committed.code===0,'Concurrent winner commit not confirmed');
      const reuseResult=await reuseSession.done;
      check(reuseResult.code!==0 && /ERROR:\s+42501:.*Band identity unavailable/.test(reuseResult.err),'Concurrent UUID reuse was not rejected by tombstone');
      report.concurrentUuidReuse='INSERT waited on old primary key; after winner commit tombstone rejected it';
      // Simulate a lost deletion response: ignore winner's JSON and query by known ID.
      const recovered=await sql(context,`SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
        SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;
        SELECT public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000001');`);
      check(recovered.out.includes('"status": "deleted"'),'Lost response receipt not recovered');
      await sql(context,call);
      await sql(context,`SELECT delete_test.ok((SELECT count(*)=1 FROM private.band_logo_cleanup_jobs),'one concurrent job');
        SELECT delete_test.ok(NOT EXISTS(SELECT 1 FROM public.bands WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001'),'winner committed band deletion');
        SELECT delete_test.ok(delete_test.no_orphans(),'concurrency no orphans');`);
      report.concurrentDeletion='winner COMMIT confirmed; contender denied while locked; replay/receipt recover committed result; one job';
    } finally {
      if(!holderClosed) { holder.child.stdin.end('ROLLBACK;\n'); await holder.done.catch(()=>{}); }
      if(reuseSession) await reuseSession.done.catch(()=>{});
    }
    for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
      await sql(context,`BEGIN ISOLATION LEVEL ${isolation};
        SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001'; SET LOCAL ROLE authenticated;
        INSERT INTO public.bands(id,name,slug) VALUES('eeeeeeee-eeee-4eee-8eee-000000000003','Old snapshot creation','old-snapshot-creation');`,'25000');
    }
    report.oldSnapshotCreationRejected=true;
    // Synthetic near-boundary receipt: no clock override or production guard bypass.
    await sql(context,`INSERT INTO private.band_deletion_tombstones VALUES('eeeeeeee-eeee-4eee-8eee-000000000091');
      INSERT INTO private.band_deletion_operations VALUES('dddddddd-dddd-4ddd-8ddd-000000000091');
      WITH timing AS (SELECT clock_timestamp()+interval '3 seconds' AS expiry)
      INSERT INTO private.band_deletion_receipts(operation_id,band_id,requested_by,confirmation_bytes,created_at,expires_at)
      SELECT 'dddddddd-dddd-4ddd-8ddd-000000000091','eeeeeeee-eeee-4eee-8eee-000000000091',
       'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',convert_to('Boundary fixture','UTF8'),expiry-interval '2160 hours',expiry FROM timing;
      INSERT INTO private.band_logo_cleanup_jobs(operation_id,band_id)
      VALUES('dddddddd-dddd-4ddd-8ddd-000000000091','eeeeeeee-eeee-4eee-8eee-000000000091');`);
    const replayHolder=await openSession(context);
    let replayClosed=false;
    try {
      replayHolder.child.stdin.write(`BEGIN;
        SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
        SET LOCAL request.jwt.claim.role='authenticated'; SET LOCAL ROLE authenticated;
        SELECT public.bandup_delete_band('eeeeeeee-eeee-4eee-8eee-000000000091','Boundary fixture','dddddddd-dddd-4ddd-8ddd-000000000091');
        SELECT 'REPLAY_HOLDER_READY';\n`);
      const replayDeadline=Date.now()+7000;
      while(!replayHolder.output().split(/\r?\n/).includes('REPLAY_HOLDER_READY')) {
        check(Date.now()<replayDeadline,'Replay holder did not become ready'); await wait(10);
      }
      check(replayHolder.output().includes('"status": "deleted"'),'Boundary replay did not recover before expiry');
      const expiryDeadline=Date.now()+6000;
      while(true) {
        const expired=await sql(context,`SELECT expires_at<=clock_timestamp() FROM private.band_deletion_receipts
          WHERE operation_id='dddddddd-dddd-4ddd-8ddd-000000000091';`);
        if(expired.out.split(/\r?\n/).includes('t')) break;
        check(Date.now()<expiryDeadline,'Boundary receipt did not expire'); await wait(50);
      }
      const skip=await sql(context,'SELECT private.expire_band_deletion_receipts();');
      check(skip.out.split(/\r?\n/).includes('0'),'Purge did not skip in-flight replay');
      replayHolder.child.stdin.end(`SELECT public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000091') IS NULL;
        SELECT 'EXPIRED_IN_SAME_TRANSACTION'; COMMIT;\n`);
      const result=await replayHolder.done; replayClosed=true;
      check(result.code===0 && /(?:^|\r?\n)t\r?\nEXPIRED_IN_SAME_TRANSACTION(?:\r?\n|$)/.test(result.out),'Long transaction retained expired access');
    } finally {
      if(!replayClosed) { replayHolder.child.stdin.end('ROLLBACK;\n'); await replayHolder.done.catch(()=>{}); }
    }
    const purgeHolder=await openSession(context);
    let purgeClosed=false;
    try {
      purgeHolder.child.stdin.write(`BEGIN; SELECT private.expire_band_deletion_receipts(); SELECT 'PURGE_HOLDER_READY';\n`);
      const purgeDeadline=Date.now()+7000;
      while(!purgeHolder.output().split(/\r?\n/).includes('PURGE_HOLDER_READY')) {
        check(Date.now()<purgeDeadline,'Purge holder did not become ready'); await wait(10);
      }
      check(purgeHolder.output().split(/\r?\n/).includes('1'),'First purger did not remove boundary receipt');
      const second=await sql(context,'SELECT private.expire_band_deletion_receipts();');
      check(second.out.split(/\r?\n/).includes('0'),'Concurrent purger failed SKIP LOCKED');
      const hidden=await sql(context,`SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
        SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;
        SELECT public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000091') IS NULL;`);
      check(hidden.out.split(/\r?\n/).includes('t'),'Recovery exposed receipt during purge');
      await sql(context,`SET request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
        SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;
        SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000003','Synthetic band 3','dddddddd-dddd-4ddd-8ddd-000000000091');`,'42501');
      purgeHolder.child.stdin.end('COMMIT;\n');
      const result=await purgeHolder.done; purgeClosed=true;
      check(result.code===0,'Purge commit failed');
    } finally {
      if(!purgeClosed) { purgeHolder.child.stdin.end('ROLLBACK;\n'); await purgeHolder.done.catch(()=>{}); }
    }
    await sql(context,`SELECT delete_test.ok(EXISTS(SELECT 1 FROM private.band_logo_cleanup_jobs
      WHERE operation_id='dddddddd-dddd-4ddd-8ddd-000000000091' AND status='pending'),'concurrent purge preserves pending job');
      SELECT delete_test.ok(EXISTS(SELECT 1 FROM public.bands WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-000000000003'),'concurrent reuse preserves other band');
      SELECT delete_test.ok(NOT EXISTS(SELECT 1 FROM private.band_deletion_receipts WHERE operation_id='dddddddd-dddd-4ddd-8ddd-000000000091'),'concurrent purge committed');`);
    report.concurrentRetention='replay locks skipped; expiry enforced in long transaction; two purgers skip locked rows; recovery hides expired receipt; consumed ID cannot redirect during purge; pending job preserved';
    report.cron = await require('./band-delete-cron-isolated.cjs')(context, {sql,openSession,read,check,wait});
    report.logoWorker = await require('./band-logo-cleanup-worker-isolated.cjs')(context, {sql,openSession,read,check,wait});
    report.directCascadeSafe=false;
    report.directCascadeFailure='23503 tasks_band_id_fkey in prevent_last_band_admin_removal';
    report.tasksFirstDiagnosticPassed=true;
    report.suitePassed=true;
  } catch(error) {report.suitePassed=false;report.failure=error.message;throw error;}
  finally {
    report.sourcesUnchanged = sources.every(file=>digest(file)===report.hashes[file]);
    if(initialized) {
      try {await command('pg_ctl',['-D',context.data,'-m','fast','-w','-t','15','stop']);report.stopped=true;}
      catch {report.stopNeedsReview=true;}
    }
    save(); console.log('Retained manifest: '+path.join(directory,'result.json'));
    check(report.sourcesUnchanged,'Test sources changed');
  }
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
