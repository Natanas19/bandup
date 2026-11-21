/* eslint-disable @typescript-eslint/no-require-imports */
// Opt-in manual runner. Never connects when imported or by normal node --test.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const BIN = 'C:/Program Files/PostgreSQL/17/bin';
const ROOT = path.resolve(__dirname, '../..');
const MIGRATION = 'docs/band-members-write-hardening-candidate.sql';
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
  check(/^(postgres|bandup_members_test_[a-f0-9]{12})$/.test(database), 'Unexpected database name');
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

function replaceOnce(source, needle, replacement) {
  check(source.split(needle).length === 2, 'Candidate anchor changed: ' + needle);
  return source.replace(needle, replacement);
}
async function validate(context) {
  const source = read(MIGRATION);
  const pass = async (name, fn) => { await fn(); console.log('PASS: ' + name); context.passed++; };
  const scalar = async query => (await sql(context,query)).out.trim();
  const assertSQL = async expression => check(await scalar(`SELECT (${expression});`) === 't', 'Assertion failed: ' + expression);
  const as = (actor, query, state) => sql(context,`SET request.jwt.claim.sub=${quote(actor)}; SET ROLE authenticated; ${query}`,state);
  const [admin,member,outsider,approved,removed,band,request,soleBand] = Array.from({length:8},randomUUID);
  const snapshot = () => scalar(`SELECT jsonb_build_object('acl',(SELECT relacl::text FROM pg_class
    WHERE oid='public.band_members'::regclass),'rows',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id)
    FROM public.band_members m))::text;`);
  await sql(context,read('tests/postgres/band-members-hardening-fixture.sql'));
  await as(admin,`INSERT INTO public.bands VALUES(${quote(band)},'Synthetic band');`);
  await sql(context,`INSERT INTO public.band_members(band_id,user_id,role,created_at) VALUES
    (${quote(band)},${quote(member)},'member','2000-01-01'),
    (${quote(band)},${quote(removed)},'member','2001-01-01');
    INSERT INTO private.requests VALUES(${quote(request)},${quote(band)},${quote(approved)},'pending');`);
  const baseline = await snapshot();
  await pass('missing authenticated/anon fails explicitly before mutation',async () => {
    for (const role of ['authenticated','anon']) {
      await sql(context,`ALTER ROLE ${role} RENAME TO hardening_missing_role;`);
      const before = await snapshot();
      const result = await sql(context,source,'P0001');
      check(result.err.includes('Papel cliente obrigatorio ausente'),'Wrong missing-role guard');
      check(await snapshot()===before,'Missing-role guard modified ACL/data');
      await sql(context,`ALTER ROLE hardening_missing_role RENAME TO ${role};`);
    }
    check(await snapshot()===baseline,'Role names were not restored');
  });
  await pass('table ACL has each of the four expected role/privilege pairs',async () => {
    const pairs = JSON.parse(await scalar(`SELECT jsonb_agg(pair ORDER BY pair)::text FROM (
      SELECT acl_role.rolname::text || ':' || a.privilege_type AS pair FROM pg_class c
      CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles acl_role ON acl_role.oid=a.grantee
      WHERE c.oid='public.band_members'::regclass AND a.privilege_type IN ('INSERT','UPDATE')
    ) pairs;`));
    check(JSON.stringify(pairs)===JSON.stringify(['authenticated:INSERT','authenticated:UPDATE','postgres:INSERT','postgres:UPDATE']),
      'Unexpected explicit ACL pairs');
    for (const [role,privilege] of [['authenticated','INSERT'],['authenticated','UPDATE'],['postgres','INSERT'],['postgres','UPDATE']]) {
      await sql(context,`REVOKE ${privilege} ON public.band_members FROM ${role};`);
      const before = await snapshot();
      const result = await sql(context,source,'P0001');
      check(result.err.includes('ACL diverge'),'Wrong ACL guard for missing '+role+':'+privilege);
      check(await snapshot()===before,'Missing-pair guard modified ACL/data');
      await sql(context,`GRANT ${privilege} ON public.band_members TO ${role};`);
    }
    check(await snapshot()===baseline,'Expected ACL was not restored');
  });
  await pass('critical definer drift aborts and preserves ACL/data',async () => {
    await sql(context,'ALTER FUNCTION public.bandup_leave_band(uuid) SECURITY INVOKER;');
    const result = await sql(context,source,'P0001');
    check(result.err.includes('Definer/owner/row_security diverge'),'Wrong definer guard');
    check(await snapshot() === baseline,'Definer guard changed ACL/data');
    await sql(context,'ALTER FUNCTION public.bandup_leave_band(uuid) SECURITY DEFINER;');
  });
  const filled = source; // Execute the reviewed candidate unchanged, no manifest substitutions.
  // Fail clearly on real candidate defects before fault-injection scenarios.
  await pass('unmodified candidate commits without unrelated delete RPC',async () => {
    await sql(context,'DROP FUNCTION public.bandup_delete_band(uuid);');
    await sql(context,filled);
  });
  await sql(context,'GRANT INSERT,UPDATE ON public.band_members TO authenticated;');
  await pass('column grant drift aborts without broadening REVOKE',async () => {
    const columnState = async () => JSON.parse(await scalar(`SELECT jsonb_build_object(
      'attacl',a.attacl::text,'explicit_update',EXISTS(SELECT FROM pg_catalog.aclexplode(a.attacl) acl
        WHERE acl.grantee='authenticated'::regrole AND acl.privilege_type='UPDATE'),
      'table_update',has_table_privilege('authenticated','public.band_members','UPDATE'),
      'effective_update',has_column_privilege('authenticated','public.band_members','role','UPDATE'))
      FROM pg_catalog.pg_attribute a WHERE a.attrelid='public.band_members'::regclass AND a.attname='role';`));
    const beforeColumn = await columnState();
    check(beforeColumn.attacl===null && !beforeColumn.explicit_update
      && beforeColumn.table_update && beforeColumn.effective_update,
    'NULL column ACL must coexist with effective table UPDATE in this fixture');
    await sql(context,'GRANT UPDATE(role) ON public.band_members TO authenticated;');
    const grantedColumn = await columnState();
    check(grantedColumn.explicit_update && grantedColumn.effective_update,'Explicit column UPDATE missing');
    const drift = await snapshot();
    const result = await sql(context,filled,'P0001');
    check(result.err.includes('ACL diverge'),'Wrong ACL guard');
    check(await snapshot() === drift,'ACL guard modified table ACL/data');
    check(JSON.stringify(await columnState())===JSON.stringify(grantedColumn),
      'ACL guard changed explicit column ACL/effective privileges');
    await sql(context,'REVOKE UPDATE(role) ON public.band_members FROM authenticated;');
    const revokedColumn = await columnState();
    check(!revokedColumn.explicit_update && revokedColumn.table_update && revokedColumn.effective_update,
      'Revoking explicit column grant must preserve table-derived UPDATE');
  });
  await pass('forced failure after REVOKE rolls back grants and data',async () => {
    const anchor = 'REVOKE INSERT, UPDATE ON TABLE public.band_members FROM authenticated RESTRICT;';
    const fault = replaceOnce(filled,anchor,anchor + `
      IF has_table_privilege('authenticated',target,'INSERT') OR has_table_privilege('authenticated',target,'UPDATE')
      THEN RAISE EXCEPTION 'REVOKE was not reached'; END IF;
      RAISE EXCEPTION USING ERRCODE='PBT01',MESSAGE='Injected after REVOKE';`);
    await sql(context,fault,'PBT01');
    check(await snapshot() === baseline,'Post-REVOKE rollback failed');
  });
  await pass('candidate reapplies after rollback scenarios',() => sql(context,filled));
  await pass('effective grants: only client INSERT/UPDATE removed',async () => {
    await assertSQL("NOT has_table_privilege('authenticated','public.band_members','INSERT') AND NOT has_table_privilege('authenticated','public.band_members','UPDATE') AND NOT has_any_column_privilege('authenticated','public.band_members','UPDATE') AND has_table_privilege('authenticated','public.band_members','SELECT') AND has_table_privilege('authenticated','public.band_members','DELETE') AND has_table_privilege('postgres','public.band_members','INSERT') AND has_table_privilege('postgres','public.band_members','UPDATE')");
  });
  for (const [name,query] of [
    ['INSERT',`INSERT INTO public.band_members(band_id,user_id,role) VALUES(${quote(band)},${quote(outsider)},'member');`],
    ['UPDATE',`UPDATE public.band_members SET role='admin' WHERE band_id=${quote(band)} AND user_id=${quote(member)};`],
    ['UPSERT',`INSERT INTO public.band_members(band_id,user_id,role) VALUES(${quote(band)},${quote(member)},'admin') ON CONFLICT(band_id,user_id) DO UPDATE SET role=excluded.role;`],
  ]) await pass(name+' denied for admin and ordinary member',async () => {
    const before = await snapshot();
    for (const actor of [admin,member]) await as(actor,query,'42501');
    check(await snapshot() === before,name+' modified data');
  });
  await pass('SELECT preserved and outsider sees no members',async () => {
    check((await as(member,`SELECT count(*) FROM public.band_members WHERE band_id=${quote(band)};`)).out.trim()==='3','Member SELECT failed');
    check((await as(outsider,'SELECT count(*) FROM public.band_members;')).out.trim()==='0','Outsider read leaked');
  });
  await pass('DELETE unauthorized targets blocked, authorized member removal works',async () => {
    for (const [actor,target] of [[member,removed],[outsider,removed],[admin,admin]]) {
      const result = await as(actor,`WITH d AS (DELETE FROM public.band_members WHERE band_id=${quote(band)} AND user_id=${quote(target)} RETURNING id) SELECT count(*) FROM d;`);
      check(result.out.trim()==='0','Unauthorized DELETE allowed');
    }
    check((await as(admin,`WITH d AS (DELETE FROM public.band_members WHERE band_id=${quote(band)} AND user_id=${quote(removed)} RETURNING id) SELECT count(*) FROM d;`)).out.trim()==='1','Authorized DELETE failed');
  });
  await pass('band creation definer inserts initial administrator after REVOKE',async () => {
    await as(admin,`INSERT INTO public.bands VALUES(${quote(soleBand)},'Synthetic sole band');`);
    await assertSQL(`EXISTS(SELECT FROM public.band_members WHERE band_id=${quote(soleBand)} AND user_id=${quote(admin)} AND role='admin')`);
  });
  await pass('approval definer rejects outsider and adds pending applicant as member',async () => {
    await as(outsider,`SELECT public.bandup_decide_entry(${quote(request)});`,'42501');
    await as(admin,`SELECT public.bandup_decide_entry(${quote(request)});`);
    await assertSQL(`EXISTS(SELECT FROM public.band_members WHERE band_id=${quote(band)} AND user_id=${quote(approved)} AND role='member') AND EXISTS(SELECT FROM private.requests WHERE id=${quote(request)} AND status='approved')`);
  });
  await pass('leave definer promotes oldest successor and removes only caller',async () => {
    await as(admin,`SELECT public.bandup_leave_band(${quote(band)});`);
    await assertSQL(`NOT EXISTS(SELECT FROM public.band_members WHERE band_id=${quote(band)} AND user_id=${quote(admin)}) AND EXISTS(SELECT FROM public.band_members WHERE band_id=${quote(band)} AND user_id=${quote(member)} AND role='admin')`);
    await as(approved,`SELECT public.bandup_leave_band(${quote(band)});`);
    await assertSQL(`(SELECT count(*)=1 FROM public.band_members WHERE band_id=${quote(band)})`);
  });
  await pass('sole administrator exit fails atomically',async () => {
    const before = await snapshot();
    await as(admin,`SELECT public.bandup_leave_band(${quote(soleBand)});`,'PBL01');
    check(await snapshot() === before,'Failed exit modified data');
  });
}

function safeCleanup(context) {
  const root = fs.realpathSync.native(context.directory);
  const parent = fs.realpathSync.native(ROOT);
  check(root === context.directory && path.dirname(root).toLowerCase()===parent.toLowerCase()
    && path.basename(root).startsWith('bandup-members-hardening-'), 'Unsafe temporary root');
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
  check(process.argv.length===3 && process.argv[2]==='--execute'
    && process.env.BANDUP_MEMBERS_LOCAL_TESTS==='create-isolated-cluster','Explicit local opt-in required');
  for (const tool of ['initdb','pg_ctl','psql']) check(fs.existsSync(path.join(BIN,tool+'.exe')),'PostgreSQL 17 binaries missing');
  // Windows PostgreSQL utilities can misreport non-ASCII TEMP paths. Keep the
  // owned temporary directory under this ASCII workspace, never a shared server.
  check(/^[\x20-\x7e]+$/.test(ROOT),'An ASCII workspace path is required for this Windows runner');
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(ROOT,'bandup-members-hardening-')));
  const context = { directory,data:path.join(directory,'data'),run:randomUUID(),port:await freePort(),
    database:'bandup_members_test_'+randomUUID().replaceAll('-','').slice(0,12),log:path.join(directory,'private-run.log'),passed:0 };
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
