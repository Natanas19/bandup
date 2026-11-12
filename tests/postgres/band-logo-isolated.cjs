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
const MIGRATION = 'supabase/migrations/20261112100000_band_logos.sql';
const AVATARS = 'supabase/migrations/20261109130000_avatars_storage.sql';
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
  check(port !== 5433, 'Refuse shared port'); return port;
}
async function openSession(context, database = context.database) {
  check(/^(postgres|bandup_logo_test_[a-f0-9]{12})$/.test(database), 'Unexpected database name');
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
function transaction(role, actor, body, commit = false) {
  check(['anon', 'authenticated', 'postgres', 'service_role'].includes(role), 'Unexpected role');
  return `BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='8s'; SET LOCAL ROLE ${role};
    SELECT set_config('request.jwt.claim.sub',${quote(actor ?? '')},true);
    SELECT set_config('request.jwt.claim.role',${quote(role)},true);
    ${body}\n${commit ? 'COMMIT' : 'ROLLBACK'};`;
}
const assertion = (expression, label) => `SELECT logo_test_support.assert_true((${expression}),${quote(label)});`;

async function validate(context, report) {
  const ids = Object.fromEntries(['A','B','C','D','L','bandA','bandB','bandL'].map(key => [key, randomUUID()]));
  const objectPath = band => `${band}/${randomUUID()}.png`;
  const ownA = objectPath(ids.bandA), ownB = objectPath(ids.bandB), ownL = objectPath(ids.bandL);
  const object = (bucket, name, metadata = { size: 100, mimetype: 'image/png' }) =>
    `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES(${quote(bucket)},${quote(name)},${quote(JSON.stringify(metadata))}::jsonb);`;
  const rpc = (band = ids.bandA, name = ownA) => `SELECT public.bandup_set_band_logo(${quote(band)},${quote(name)});`;
  const expectedURL = 'https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/band-logos/' + ownA;
  const run = async (label, work) => { try { await work(); report(label, 'PASS'); } catch (error) { report(label, 'FAIL'); throw error; } };
  const as = (role, actor, body, state, commit = false) => sql(context, transaction(role, actor, body, commit), state);
  const admin = body => as('postgres', null, body);
  const remainsEmpty = () => admin(assertion("to_regclass('private.band_logo_write_permits') IS NULL AND to_regprocedure('public.bandup_set_band_logo(uuid,text)') IS NULL AND NOT EXISTS(SELECT FROM storage.buckets WHERE id='band-logos')", 'installation rollback'));
  await sql(context, read('tests/postgres/band-logo-isolated-bootstrap.sql'));
  for (const file of ['supabase/migrations/20261001000000_initial_bandup_schema.sql',
    'supabase/migrations/20261111100000_restrict_member_removal_to_members.sql',
    'supabase/migrations/20261111140000_bandup_leave_band.sql', AVATARS]) await sql(context, read(file));
  await sql(context, `INSERT INTO logo_test_support.manifest VALUES(${quote(context.run)});`);
  const avatarSnapshot = async () => (await sql(context, `SELECT json_agg(p ORDER BY policyname)::text FROM pg_policies p WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'avatars_%';`)).out.split(/\r?\n/).filter(line => line.startsWith('[')).join('');
  const beforeAvatars = await avatarSnapshot();
  await run('preflight rejects inherited dangerous table privilege, rollback complete', async () => {
    await sql(context, 'GRANT TRIGGER ON public.bands TO logo_acl_fixture; GRANT logo_acl_fixture TO authenticated;');
    await sql(context, read(MIGRATION), 'P0001'); await remainsEmpty();
    await sql(context, 'REVOKE logo_acl_fixture FROM authenticated; REVOKE TRIGGER ON public.bands FROM logo_acl_fixture;');
  });
  await run('postflight rejects inherited private function EXECUTE, rollback complete', async () => {
    await sql(context, 'GRANT logo_acl_fixture TO anon; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO logo_acl_fixture;');
    await sql(context, read(MIGRATION), 'P0001'); await remainsEmpty();
    await sql(context, 'REVOKE logo_acl_fixture FROM anon; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private REVOKE EXECUTE ON FUNCTIONS FROM logo_acl_fixture;');
  });
  await run('postflight rejects inherited permit table access, rollback complete', async () => {
    await sql(context, 'GRANT logo_acl_fixture TO authenticated; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private GRANT SELECT ON TABLES TO logo_acl_fixture;');
    await sql(context, read(MIGRATION), 'P0001'); await remainsEmpty();
    await sql(context, 'REVOKE logo_acl_fixture FROM authenticated; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private REVOKE SELECT ON TABLES FROM logo_acl_fixture;');
  });
  await run('original migration creates all objects and passes its real ACL checks', async () => { await sql(context, read(MIGRATION)); });
  await run('existing avatar policy definitions unchanged', async () => { check(beforeAvatars === await avatarSnapshot(), 'Avatar policy change'); });
  await sql(context, `INSERT INTO auth.users(id) VALUES ${['A','B','C','D','L'].map(key => '(' + quote(ids[key]) + ')').join(',')};`);
  for (const actor of ['A','B','L']) {
    await as('authenticated', ids[actor], `INSERT INTO public.bands(id,name,slug) VALUES(${quote(ids['band'+actor])},'Local band',${quote('test-'+ids['band'+actor])});`, null, true);
  }
  await as('authenticated', ids.A, `INSERT INTO public.band_members(band_id,user_id,role) VALUES
    (${quote(ids.bandA)},${quote(ids.C)},'member'),(${quote(ids.bandA)},${quote(ids.D)},'admin');
    INSERT INTO public.tasks(band_id,created_by,title,assigned_to,status,priority) VALUES(${quote(ids.bandA)},${quote(ids.A)},'Local task',${quote(ids.C)},'todo','medium');`, null, true);
  await as('authenticated', ids.L, `INSERT INTO public.band_members(band_id,user_id,role) VALUES(${quote(ids.bandL)},${quote(ids.C)},'member');`, null, true);
  for (const [actor, name] of [['A', ownA], ['B', ownB], ['L', ownL]]) await as('authenticated', ids[actor], object('band-logos', name), null, true);
  await run('creation without photo and actual creator trigger remain functional', () => as('authenticated', ids.A,
    assertion(`EXISTS(SELECT FROM public.band_members WHERE band_id=${quote(ids.bandA)} AND user_id=${quote(ids.A)} AND role='admin') AND EXISTS(SELECT FROM public.bands WHERE id=${quote(ids.bandA)} AND logo_url IS NULL)`, 'creator admin')));
  await run('RPC associates own band object, retries idempotently and consumes permit', async () => {
    await as('authenticated', ids.A, rpc()+rpc()+assertion(`(SELECT logo_url FROM public.bands WHERE id=${quote(ids.bandA)})=${quote(expectedURL)}`, 'association'));
    await admin(assertion('NOT EXISTS(SELECT FROM private.band_logo_write_permits)', 'permit empty'));
  });
  for (const [label, statement] of [
    ['direct arbitrary URL', `UPDATE public.bands SET logo_url='https://example.invalid/a.png' WHERE id=${quote(ids.bandA)};`],
    ['direct canonical URL', `UPDATE public.bands SET logo_url=${quote(expectedURL)} WHERE id=${quote(ids.bandA)};`],
    ['INSERT with logo', `INSERT INTO public.bands(name,slug,logo_url) VALUES('Blocked','blocked-${randomUUID()}',${quote(expectedURL)});`],
    ['spoofed GUC does not authorize', `SELECT set_config('bandup.logo_authorized','true',true); UPDATE public.bands SET logo_url=${quote(expectedURL)} WHERE id=${quote(ids.bandA)};`],
    ['private permit access', 'SELECT * FROM private.band_logo_write_permits;'],
    ['internal parser EXECUTE', `SELECT private.band_logo_band_id(${quote(ownA)});`],
  ]) await run(label, () => as('authenticated', ids.A, statement, '42501'));
  await run('other column updates preserve logo and remain permitted', () => as('authenticated', ids.A,
    rpc()+`UPDATE public.bands SET name='Edited',description='Description' WHERE id=${quote(ids.bandA)};`+assertion(`(SELECT logo_url FROM public.bands WHERE id=${quote(ids.bandA)})=${quote(expectedURL)}`, 'preserved logo')));
  await run('direct clearing of linked logo is denied', () => as('authenticated', ids.A,
    rpc()+`UPDATE public.bands SET logo_url=NULL WHERE id=${quote(ids.bandA)};`, '42501'));
  for (const [label, actor, band, name, state] of [
    ['RPC member denied', ids.C, ids.bandA, ownA, '42501'],
    ['RPC external user denied', ids.B, ids.bandA, ownA, '42501'],
    ['RPC object from other band denied', ids.A, ids.bandA, ownB, '22023'],
    ['RPC missing object denied', ids.A, ids.bandA, objectPath(ids.bandA), '22023'],
    ['RPC malformed path denied', ids.A, ids.bandA, 'bad/path.png', '22023'],
  ]) await run(label, () => as('authenticated', actor, rpc(band,name), state));
  await run('RPC anonymous EXECUTE denied', () => as('anon', null, rpc(), '42501'));
  for (const [label, metadata] of [['RPC invalid MIME', {size:100,mimetype:'image/gif'}], ['RPC oversized metadata', {size:2097153,mimetype:'image/png'}], ['RPC malformed size', {size:'NaN',mimetype:'image/png'}]]) {
    const name = objectPath(ids.bandA);
    await run(label, () => as('authenticated', ids.A, object('band-logos', name, metadata)+rpc(ids.bandA,name), '22023'));
  }
  await run('AFTER guard rejects modification introduced by another BEFORE trigger', async () => {
    await sql(context, `CREATE FUNCTION logo_test_support.mutate_logo() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.logo_url:='https://example.invalid/injected.png'; RETURN NEW; END $$;
      CREATE TRIGGER zz_logo_fixture BEFORE UPDATE ON public.bands FOR EACH ROW EXECUTE FUNCTION logo_test_support.mutate_logo();`);
    await as('authenticated', ids.A, `UPDATE public.bands SET name='Try' WHERE id=${quote(ids.bandA)};`, '42501');
    await sql(context, 'DROP TRIGGER zz_logo_fixture ON public.bands;');
  });
  // A scoped competing permissive policy, only on two synthetic test buckets.
  await sql(context, `INSERT INTO storage.buckets(id,name) VALUES('other-fixtures','other-fixtures');
    CREATE POLICY logo_test_broad ON storage.objects FOR ALL TO PUBLIC
    USING(bucket_id IN ('band-logos','other-fixtures')) WITH CHECK(bucket_id IN ('band-logos','other-fixtures'));`);
  await run('broad competing policy cannot permit cross-band INSERT', () => as('authenticated', ids.A, object('band-logos',objectPath(ids.bandB)), '42501'));
  await run('broad competing policy cannot permit member INSERT', () => as('authenticated', ids.C, object('band-logos',objectPath(ids.bandA)), '42501'));
  await run('anon SELECT has no private EXECUTE error and sees no logos', () => as('anon',null,assertion("NOT EXISTS(SELECT FROM storage.objects WHERE bucket_id='band-logos')",'anon metadata')));
  await run('anon INSERT denied by RLS rather than private function ACL', async () => {
    const result = await as('anon', null, object('band-logos',objectPath(ids.bandA)), '42501');
    check(/row-level security/.test(result.err), 'Unexpected source of anonymous denial');
  });
  await run('member SELECT metadata denied despite permissive policy', () => as('authenticated',ids.C,assertion(`NOT EXISTS(SELECT FROM storage.objects WHERE bucket_id='band-logos' AND name=${quote(ownA)})`,'member metadata')));
  for (const [label, action] of [
    ['UPDATE immutable object', `UPDATE storage.objects SET metadata='{"size":200,"mimetype":"image/png"}' WHERE bucket_id='band-logos' AND name=${quote(ownA)} RETURNING id`],
    ['DELETE immutable object', `DELETE FROM storage.objects WHERE bucket_id='band-logos' AND name=${quote(ownA)} RETURNING id`],
  ]) await run(label, () => as('authenticated',ids.A,`WITH changed AS (${action}) ${assertion('NOT EXISTS(SELECT FROM changed)','mutation blocked')}`));
  await run('moving another bucket object into band-logos is denied', () => as('authenticated',ids.A,
    object('other-fixtures','move.png')+`UPDATE storage.objects SET bucket_id='band-logos',name=${quote(objectPath(ids.bandA))} WHERE bucket_id='other-fixtures' AND name='move.png';`, '42501'));
  await run('another bucket still allows its prior anon policy', () => as('anon',null,object('other-fixtures','anon.png')+assertion("EXISTS(SELECT FROM storage.objects WHERE bucket_id='other-fixtures' AND name='anon.png')",'other bucket')));
  const avatar = `${ids.A}/${randomUUID()}.png`;
  await run('avatar own INSERT/SELECT remains functional', () => as('authenticated',ids.A,object('avatars',avatar)+assertion(`EXISTS(SELECT FROM storage.objects WHERE bucket_id='avatars' AND name=${quote(avatar)})`,'avatar own')));
  await run('avatar cross-owner INSERT still denied', () => as('authenticated',ids.B,object('avatars',avatar),'42501'));
  await run('existing member removal preserves task and clears assignment', () => as('authenticated',ids.A,
    `DELETE FROM public.band_members WHERE band_id=${quote(ids.bandA)} AND user_id=${quote(ids.C)};`+assertion(`EXISTS(SELECT FROM public.tasks WHERE band_id=${quote(ids.bandA)} AND assigned_to IS NULL)`,'task preserved')));
  await run('last administrator protection remains active', () => as('authenticated',ids.B,`UPDATE public.band_members SET role='member' WHERE band_id=${quote(ids.bandB)} AND user_id=${quote(ids.B)};`,'P0001'));
  async function hold(body, actor = null) {
    const session = await openSession(context);
    session.child.stdin.write(`BEGIN; ${actor ? `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${quote(actor)},true); SELECT set_config('request.jwt.claim.role','authenticated',true);` : ''}
      ${body}\nSELECT 'BANDUP_HELD';\n`);
    const deadline = Date.now()+7000;
    while (!session.output().split(/\r?\n/).includes('BANDUP_HELD')) { check(Date.now()<deadline,'Holder did not acquire lock'); await wait(10); }
    return async commit => { session.child.stdin.end((commit ? 'COMMIT' : 'ROLLBACK')+';\n'); const result=await session.done; check(result.code===0,'Holder failed'); };
  }
  await run('concurrent band lock gives NOWAIT conflict without partial write', async () => {
    const release = await hold(`SELECT id FROM public.bands WHERE id=${quote(ids.bandA)} FOR UPDATE;`);
    try { await as('authenticated',ids.A,rpc(),'55P03'); } finally { await release(false); }
    await admin(assertion('NOT EXISTS(SELECT FROM private.band_logo_write_permits)','rollback permit'));
  });
  await run('reverse-order member lock conflicts without deadlock; band lock released', async () => {
    const release = await hold(`SELECT id FROM public.band_members WHERE band_id=${quote(ids.bandA)} AND user_id=${quote(ids.A)} FOR UPDATE;`);
    try { await as('authenticated',ids.A,rpc(),'55P03'); } finally { await release(false); }
    await admin(`SELECT id FROM public.bands WHERE id=${quote(ids.bandA)} FOR UPDATE NOWAIT;`);
  });
  await run('concurrent demotion conflicts, then revoked admin cannot associate', async () => {
    const release = await hold(`UPDATE public.band_members SET role='member' WHERE band_id=${quote(ids.bandA)} AND user_id=${quote(ids.A)};`,ids.D);
    try { await as('authenticated',ids.A,rpc(),'55P03'); } finally { await release(true); }
    await as('authenticated',ids.A,rpc(),'42501');
    await as('authenticated',ids.D,rpc());
  });
  await run('real leave RPC transfers administration and old admin loses association rights', async () => {
    await as('authenticated',ids.L,`SELECT public.bandup_leave_band(${quote(ids.bandL)});`,null,true);
    await as('authenticated',ids.L,rpc(ids.bandL,ownL),'42501');
    await as('authenticated',ids.C,rpc(ids.bandL,ownL));
  });
  await run('no permit remains and avatars definitions still unchanged', async () => {
    await admin(assertion('NOT EXISTS(SELECT FROM private.band_logo_write_permits)','no capabilities'));
    check(beforeAvatars===await avatarSnapshot(),'Avatar policies changed');
  });
  return ids;
}

async function main() {
  check(process.argv.length === 3 && process.argv[2] === '--execute'
    && process.env.BANDUP_BAND_LOGO_LOCAL_TESTS === 'create-isolated-cluster', 'Explicit local opt-in required');
  for (const tool of ['initdb','pg_ctl','psql']) check(fs.existsSync(path.join(BIN,tool+'.exe')), 'PostgreSQL 17 binaries missing');
  const run = randomUUID(), directory = fs.mkdtempSync(path.join(os.tmpdir(),'bandup-band-logos-'));
  const context = { run, directory, data: path.resolve(directory,'data'), port: await freePort(),
    database: 'bandup_logo_test_'+run.replaceAll('-','').slice(0,12), log:path.join(directory,'private-run.log') };
  command.log = context.log;
  const manifest = { ...context, migrationSHA256: digest(MIGRATION), avatarsSHA256: digest(AVATARS), results: [], stopped: false };
  const save = () => fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(manifest,null,2));
  save(); console.log('Private local run: '+directory); console.log('Shared port 5433 is never contacted.');
  let initialized = false;
  try {
    await command('initdb',['-D',context.data,'-U','postgres','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale']);
    initialized = true;
    fs.appendFileSync(path.join(context.data,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${context.port}\nunix_socket_directories=''\nmax_connections=20\n`);
    await command('pg_ctl',['-D',context.data,'-l',path.join(directory,'server.log'),'-w','-t','15','start']);
    await sql(context,`CREATE DATABASE "${context.database}";`,null,'postgres');
    manifest.fixtures = await validate(context,(label,result) => { manifest.results.push({label,result}); save(); console.log(result+': '+label); });
    manifest.success = true;
  } catch (error) { manifest.success = false; manifest.failure = error.message; throw error; }
  finally {
    manifest.sourcesUnchanged = digest(MIGRATION)===manifest.migrationSHA256 && digest(AVATARS)===manifest.avatarsSHA256;
    if (initialized) {
      try { await command('pg_ctl',['-D',context.data,'-m','fast','-w','-t','15','stop']); manifest.stopped=true; }
      catch { manifest.stopNeedsReview=true; }
    }
    save(); console.log('Database/data retained; manifest: '+path.join(directory,'result.json'));
    check(manifest.sourcesUnchanged, 'Source migration changed');
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode=1; });
