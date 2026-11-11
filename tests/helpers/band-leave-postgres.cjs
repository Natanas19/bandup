/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');

const target = 'postgresql://postgres@127.0.0.1:5433/bandup_leave_test';
function validateConnection(value, env = process.env) {
  // Exact spelling rejects credentials, query overrides, services, sockets,
  // alternate protocols/hosts, encoded components and implicit defaults.
  if (value !== target) throw Error('Use only the documented password-free local test URL');
  if (Object.keys(env).some(key => /^PG/i.test(key) && key.toUpperCase() !== 'PGPASSFILE' && env[key])) {
    throw Error('Remove ambiguous PG* settings; only PGPASSFILE is accepted');
  }
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^PG/i.test(key)));
  return { ...clean, ...(env.PGPASSFILE ? { PGPASSFILE: env.PGPASSFILE } : {}),
    PGHOST: '127.0.0.1', PGHOSTADDR: '127.0.0.1', PGPORT: '5433',
    PGDATABASE: 'bandup_leave_test', PGUSER: 'postgres', PGCONNECT_TIMEOUT: '5',
    PGSSLMODE: 'disable', PGGSSENCMODE: 'disable' };
}

const guard = `DO $guard$
BEGIN
  IF current_database() IS DISTINCT FROM 'bandup_leave_test'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_port() IS DISTINCT FROM 5433
    OR session_user IS DISTINCT FROM 'postgres'
    OR current_user IS DISTINCT FROM 'postgres'
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
  THEN RAISE EXCEPTION 'Wrong disposable test destination'; END IF;
END $guard$;`;
const marker = `DO $marker$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bandup_leave_test_support.manifest
    WHERE name = 'environment' AND value = 'bandup-leave-local-v1')
  THEN RAISE EXCEPTION 'Missing disposable bootstrap marker'; END IF;
END $marker$;`;

// No caller SQL is sent until this exact session has passed the read-only gate.
async function openSession({ url, requireBootstrap = true, env = process.env, spawnProcess = spawn }) {
  const childEnv = validateConnection(url, env);
  const p = spawnProcess('psql', ['-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    env: childEnv, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '', err = '', closed = false;
  const done = new Promise((resolve, reject) => {
    p.on('error', () => { closed = true; reject(Error('Unable to start local psql')); });
    p.on('close', code => { closed = true; resolve({ code, out: out.replace(/BANDUP_GATE_READY\r?\n/, '').trim(), err }); });
  });
  done.catch(() => {}); // Prevent an early spawn failure becoming an unhandled rejection.
  const lifetime = setTimeout(() => p.kill(), 15000);
  p.once('close', () => clearTimeout(lifetime));
  p.once('error', () => clearTimeout(lifetime));
  // stderr stays internal; never log connection diagnostics or the URL.
  p.stdout.on('data', b => { out += b; });
  p.stderr.on('data', b => { err += b; });
  p.stdin.on('error', () => {});
  p.stdin.write(`${guard}\n${requireBootstrap ? marker : ''}\nSELECT 'BANDUP_GATE_READY';\n`);
  try {
    const deadline = Date.now() + 7000;
    while (!out.split(/\r?\n/).includes('BANDUP_GATE_READY')) {
      if (closed || Date.now() > deadline) throw Error('Local database identity/bootstrap gate failed');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } catch {
    p.kill(); await done.catch(() => {});
    throw Error('Local database identity/bootstrap gate failed; no test SQL was sent');
  }
  return { p, done, output: () => out };
}

module.exports = { target, validateConnection, guard, marker, openSession };
