/* eslint-disable @typescript-eslint/no-require-imports */
// Opt-in manual runner. Never connects when imported or by normal node --test.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const BIN = 'C:/Program Files/PostgreSQL/17/bin';
const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'docs/band-invitations-backend-candidate.sql';
// Isolation helpers adapted from band-logo-isolated.cjs; logo suite is never imported.
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const digest = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const quote = text => "'" + String(text).replaceAll("'", "''") + "'";
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
  check(![5432, 5433].includes(port), 'Refuse shared ports'); return port;
}
async function openSession(context, database = context.database) {
  check(/^(postgres|bandup_invites_test_[a-f0-9]{12})$/.test(database), 'Unexpected database name');
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
  // openSession already validates this exact first line. It is infrastructure
  // output, not a scalar/JSON result from the caller's SQL.
  check(result.out.startsWith('BANDUP_GATE:'),'Missing validated identity output');
  result.out = result.out.replace(/^BANDUP_GATE:[^\r\n]*(?:\r?\n|$)/,'');
  const state = result.err.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1];
  if (expectedState && (result.code===0 || state!==expectedState)) {
    fs.appendFileSync(context.log,'\nUnexpected SQL result:\n'+result.err);
  }
  if (result.code !== 0 && !expectedState) {
    fs.appendFileSync(context.log, '\nSQL failure:\n' + result.err);
    throw Error('Local SQL failed (' + (state ?? 'unknown') + '); diagnostics printed before temporary cleanup');
  }
  check(expectedState ? result.code !== 0 && state === expectedState : result.code === 0,
    'Unexpected SQLSTATE: ' + (state ?? 'none') + '; ' + result.err.split(/\r?\n/).slice(0,3).join(' '));
  return result;
}

async function validate(context) {
  const scenarios = process.argv[3] === '--compatibility'
    ? './band-invitations-compatibility.cjs' : process.argv[3] === '--installation'
      ? './band-invitations-installation.cjs' : process.argv[3] === '--containment'
        ? './band-invitations-containment.cjs' : './band-invitations-scenarios.cjs';
  await require(scenarios)({ context, sql, read, quote, check, openSession, wait });
}

function safeCleanup(context) {
  const root = fs.realpathSync.native(context.directory);
  const parent = fs.realpathSync.native(ROOT);
  check(root === context.directory && path.dirname(root).toLowerCase()===parent.toLowerCase()
    && path.basename(root).startsWith('bandup-invitations-'), 'Unsafe temporary root');
  check(fs.readFileSync(path.join(root,'owner-marker'),'utf8')===context.run,'Ownership marker mismatch');
  check(!fs.existsSync(path.join(root,'data','postmaster.pid')),'Refuse cleanup of running cluster');
  // Reject reparse points/symlinks before recursive deletion; never follow them.
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file = path.join(directory,entry.name), stat = fs.lstatSync(file);
      check(!stat.isSymbolicLink(),'Refuse temporary symlink cleanup');
      if (stat.isDirectory()) inspect(file);
    }
  }
  inspect(root);
  fs.rmSync(root,{recursive:true,force:false});
}
async function main() {
  check((process.argv.length===3 || (process.argv.length===4 && ['--compatibility','--installation','--containment'].includes(process.argv[3]))) && process.argv[2]==='--execute'
    && process.env.BANDUP_INVITATIONS_LOCAL_TESTS==='create-isolated-cluster','Explicit local opt-in required');
  for (const tool of ['initdb','pg_ctl','psql']) check(fs.existsSync(path.join(BIN,tool+'.exe')),'PostgreSQL 17 binaries missing');
  // Windows PostgreSQL utilities can misreport non-ASCII TEMP paths. Keep the
  // owned temporary directory under this ASCII workspace, never a shared server.
  check(/^[\x20-\x7e]+$/.test(ROOT),'An ASCII workspace path is required for this Windows runner');
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(ROOT,'bandup-invitations-')));
  const context = { directory,data:path.join(directory,'data'),run:randomUUID(),port:await freePort(),
    database:'bandup_invites_test_'+randomUUID().replaceAll('-','').slice(0,12),log:path.join(directory,'private-run.log'),passed:0 };
  fs.writeFileSync(path.join(directory,'owner-marker'),context.run);
  command.log = context.log;
  const originalHash = digest(MIGRATION);
  console.log('Private temporary cluster: '+directory+'; port '+context.port);
  let stopped = false;
  try {
    await command('initdb',['-D',context.data,'-U','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale','--no-sync']);
    // Disposable cluster only: no durability requirement; avoid slow disk sync.
    fs.appendFileSync(path.join(context.data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${context.port}\nunix_socket_directories=''\nmax_connections=10\nfsync=off\nsynchronous_commit=off\nfull_page_writes=off\n`);
    await command('pg_ctl',['-D',context.data,'-l',path.join(directory,'server.log'),'-w','-t','15','start']);
    await sql(context,`CREATE DATABASE "${context.database}";`,null,'postgres');
    await validate(context);
  } catch (error) {
    console.error(context.passed+' scenarios passed; remaining scenarios blocked by failure.');
    if (fs.existsSync(context.log)) console.error(fs.readFileSync(context.log,'utf8').slice(-6000));
    throw error;
  } finally {
    if (fs.existsSync(path.join(context.data,'postmaster.pid'))) {
      await command('pg_ctl',['-D',context.data,'-m','fast','-w','-t','60','stop']);
    }
    stopped = !fs.existsSync(path.join(context.data,'postmaster.pid'));
    check(stopped,'Cluster stop not confirmed; temporary directory retained');
    check(digest(MIGRATION)===originalHash,'Original candidate changed');
    safeCleanup(context);
    console.log('Cluster stopped; owned temporary directory removed; original candidate unchanged.');
  }
  console.log(context.passed+' scenarios passed. Synthetic functions do not certify Demo compatibility.');
}
if (require.main===module) main().catch(error => { console.error(error.message); process.exitCode=1; });
module.exports = { safeCleanup };
