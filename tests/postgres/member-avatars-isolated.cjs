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
const MIGRATION = 'supabase/migrations/20261112160000_band_member_avatars.sql';
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
  check(/^(postgres|bandup_member_avatar_test_[a-f0-9]{12}(?:_enum)?)$/.test(database), 'Unexpected database name');
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
  check(process.argv.length===3 && process.argv[2]==='--execute'
    && process.env.BANDUP_MEMBER_AVATAR_LOCAL_TESTS==='create-isolated-cluster','Explicit local opt-in required');
  for(const tool of ['initdb','pg_ctl','psql']) check(fs.existsSync(path.join(BIN,tool+'.exe')),'PostgreSQL 17 binaries missing');
  const run=randomUUID(), directory=fs.mkdtempSync(path.join(os.tmpdir(),'bandup-member-avatars-'));
  const context={ directory, data:path.resolve(directory,'data'), port:await freePort(),
    database:'bandup_member_avatar_test_'+run.replaceAll('-','').slice(0,12), log:path.join(directory,'private-run.log') };
  command.log=context.log;
  const report={...context,migrationSHA256:digest(MIGRATION),results:[],sqlAssertions:{},stopped:false};
  const save=()=>fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(report,null,2));
  const test=async(label,work)=>{await work(); report.results.push(label); save();};
  const absent=`SELECT avatar_test.assert_true(to_regprocedure('public.bandup_member_avatars(uuid,uuid[])') IS NULL,'failed installation rolled back');`;
  const fixtures=read('tests/postgres/member-avatars-fixtures.sql');
  let initialized=false;
  save(); console.log('New private local cluster: '+directory);
  try {
    await command('initdb',['-D',context.data,'-U','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale']);
    initialized=true;
    fs.appendFileSync(path.join(context.data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${context.port}\nunix_socket_directories=''\nmax_connections=10\n`);
    await command('pg_ctl',['-D',context.data,'-l',path.join(directory,'server.log'),'-w','-t','15','start']);
    await sql(context,`CREATE DATABASE "${context.database}";`,null,'postgres');
    await sql(context,fixtures);
    await sql(context,read('supabase/migrations/20261105120000_band_member_display_names.sql'));
    await sql(context,read('supabase/migrations/20261112140000_pending_request_avatars.sql'));
    await sql(context,'TRUNCATE avatar_test.original; INSERT INTO avatar_test.original SELECT avatar_test.snapshot();');
    await test('incompatible membership column rejected without repair',async()=>{
      await sql(context,'ALTER TABLE public.band_members RENAME COLUMN user_id TO unexpected_user;');
      await sql(context,read(MIGRATION),'P0001');
      await sql(context,absent+'ALTER TABLE public.band_members RENAME COLUMN unexpected_user TO user_id;');
    });
    await test('custom default EXECUTE rejected with transactional rollback',async()=>{
      await sql(context,'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO avatar_extra;');
      await sql(context,read(MIGRATION),'P0001');
      await sql(context,absent+'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM avatar_extra;');
    });
    await test('inherited anonymous EXECUTE rejected without changing memberships',async()=>{
      await sql(context,'GRANT authenticated TO anon;');
      await sql(context,read(MIGRATION),'P0001');
      await sql(context,absent+`SELECT avatar_test.assert_true(pg_has_role('anon','authenticated','MEMBER'),'fixture membership preserved'); REVOKE authenticated FROM anon;`);
    });
    await test('disabled source RLS rejected without repair',async()=>{
      await sql(context,'ALTER TABLE public.band_members DISABLE ROW LEVEL SECURITY;');
      await sql(context,read(MIGRATION),'P0001');
      await sql(context,absent+'ALTER TABLE public.band_members ENABLE ROW LEVEL SECURITY;');
    });
    await test('private avatar bucket rejected without repair',async()=>{
      await sql(context,"UPDATE storage.buckets SET public=false WHERE id='avatars';");
      await sql(context,read(MIGRATION),'P0001');
      await sql(context,absent+"UPDATE storage.buckets SET public=true WHERE id='avatars';");
    });
    await test('integral candidate installs with minimum ACL',()=>sql(context,read(MIGRATION)));
    await test('membership authorization, privacy, 20 URL cases and batches',async()=>{
      const result=await sql(context,read('tests/postgres/member-avatars-checks.sql'));
      report.sqlAssertions.text=Number(result.out.match(/SQL_ASSERTIONS:(\d+)/)?.[1]);
      check(report.sqlAssertions.text>=40,'Missing SQL assertions');
    });
    await test('collision aborts rather than replacing installed RPC',()=>sql(context,read(MIGRATION),'P0001'));
    report.success=true;
  } catch(error) {report.success=false;report.failure=error.message;throw error;}
  finally {
    report.sourceUnchanged=digest(MIGRATION)===report.migrationSHA256;
    if(initialized) {
      try {await command('pg_ctl',['-D',context.data,'-m','fast','-w','-t','15','stop']);report.stopped=true;}
      catch {report.stopNeedsReview=true;}
    }
    save();console.log('Retained manifest: '+path.join(directory,'result.json'));
    check(report.sourceUnchanged,'Migration source changed');
  }
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
