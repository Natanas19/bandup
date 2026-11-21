/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Explicit local-only entry point; importing this file never connects.
// Run: node tests/postgres/musician-availability-rls.cjs --execute
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const checks = ['default_false', 'own_read_update', 'cross_user_denied',
  'identity_update_denied', 'anon_denied', 'rollback'];
const gate = `BEGIN READ ONLY;
DO $guard$
BEGIN
 IF current_database() IS DISTINCT FROM 'bandup_migration_test'
   OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
   OR inet_server_port() IS DISTINCT FROM 5433
   OR session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
   OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
 THEN RAISE EXCEPTION 'Wrong local test destination'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
   WHERE oid=pg_catalog.to_regclass('public.musician_availability') AND relrowsecurity)
   OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
   OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('authenticated','anon')
       AND NOT rolsuper AND NOT rolbypassrls) <> 2
 THEN RAISE EXCEPTION 'Local test prerequisites unavailable'; END IF;
END $guard$;
COMMIT;
SELECT 'BANDUP_AVAILABILITY_GATE_READY';
`;

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--execute') {
    throw Error('Use --execute for the fixed local bandup_migration_test database');
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    console.error('An interactive PowerShell/terminal is required for the psql password prompt. No connection was attempted.');
    process.exitCode = 2;
    return;
  }
  // No inherited PGHOST/PGSERVICE/PGOPTIONS/PGPASSWORD can redirect this test.
  // psql owns the non-echoing terminal prompt; Node never reads/stores a password.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)));
  if (process.env.PGPASSFILE) env.PGPASSFILE = process.env.PGPASSFILE;
  Object.assign(env, { PGHOSTADDR: '127.0.0.1', PGCONNECT_TIMEOUT: '3',
    PGSSLMODE: 'disable', PGGSSENCMODE: 'disable' });
  const windowsPsql = 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
  const executable = process.platform === 'win32' && fs.existsSync(windowsPsql) ? windowsPsql : 'psql';
  const sql = fs.readFileSync(path.join(__dirname, 'musician-availability-rls.sql'), 'utf8')
    .replaceAll('__USER_A__', randomUUID()).replaceAll('__USER_B__', randomUUID());
  const child = spawn(executable, ['-X', '-W', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', '5433', '-d', 'bandup_migration_test', '-U', 'postgres'],
  { env, stdio: ['pipe', 'pipe', 'inherit'] });
  let output = '', sent = false;
  // Allow time to type at the native prompt, then bound the fixture transaction.
  let timeout = setTimeout(() => child.kill(), 120000);
  // Inherited stderr is null in Node: prompt/psql diagnostics go to the terminal.
  // Keep exit-code and gate checks below; never capture or log the password.
  child.stdin.on('error', () => {});
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (!sent && output.split(/\r?\n/).includes('BANDUP_AVAILABILITY_GATE_READY')) {
      sent = true;
      clearTimeout(timeout);
      timeout = setTimeout(() => child.kill(), 20000);
      child.stdin.end(sql);
    }
  });
  const code = await new Promise(resolve => {
    child.once('error', () => resolve(null));
    child.once('close', resolve);
    child.stdin.write(gate);
  });
  clearTimeout(timeout);
  if (!sent) {
    process.exitCode = 2;
    console.error('Local connection/identity/prerequisite gate failed; see psql diagnostics in the terminal. No fixture SQL was sent.');
    return;
  }
  const lines = new Set(output.split(/\r?\n/));
  for (const check of checks) console.log(`${lines.has('PASS:' + check) ? 'PASS' : 'NOT VERIFIED'}: ${check}`);
  if (code !== 0 || checks.some(check => !lines.has('PASS:' + check))) {
    process.exitCode = 1;
    console.error('Local functional test failed. No COMMIT exists in the fixture transaction; disconnect rolls back on error.');
  }
}
if (require.main === module) main().catch(() => {
  console.error('Local test could not start; no remote fallback is configured.');
  process.exitCode = 2;
});
