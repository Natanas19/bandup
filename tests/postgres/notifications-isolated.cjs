/* eslint-disable @typescript-eslint/no-require-imports */
// Creates its own PostgreSQL cluster. Does not accept a connection string.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = fs.realpathSync.native(path.join(__dirname, '../..'));
const bin = 'C:/Program Files/PostgreSQL/17/bin';
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key))),
  PGCONNECT_TIMEOUT: '5',
  PGCLIENTENCODING: 'UTF8',
};

function run(tool, args) {
  const result = spawnSync(path.join(bin, tool + '.exe'), args, {
    env, windowsHide: true, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(tool + ' exited with status ' + result.status);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function removeCluster(directory, data) {
  if (fs.realpathSync.native(directory) !== directory ||
      path.dirname(directory) !== root ||
      !path.basename(directory).startsWith('bandup-notifications-') ||
      fs.existsSync(path.join(data, 'postmaster.pid'))) {
    throw Error('Cannot safely remove temporary cluster: ' + directory);
  }
  fs.rmSync(directory, { recursive: true });
}

async function main(testFile, variables = [], afterSetup) {
  const port = await freePort();
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(root, 'bandup-notifications-')));
  const data = path.join(directory, 'data');
  const log = path.join(directory, 'server.log');
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '-A', 'scram-sha-256',
      '--pwfile=' + writePassword(directory), '--encoding=UTF8', '--locale=C', '--no-sync']);
    fs.appendFileSync(path.join(data, 'postgresql.conf'),
      "\nlisten_addresses = '127.0.0.1'\nport = " + port + "\nunix_socket_directories = ''\n");
    run('pg_ctl', ['-D', data, '-l', log, '-w', '-t', '15', 'start']);
    const connection = ['-X', '-w', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    run('psql', [...connection, '-v', 'test_port=' + port,
      '-v', 'test_data=' + data.replaceAll('\\', '/'),
      ...variables,
      '-f', path.join(__dirname, testFile)]);
    if (afterSetup) {
      await afterSetup(sql => {
        const result = spawnSync(path.join(bin, 'psql.exe'), [...connection, '-At', '-v', 'VERBOSITY=verbose'], {
          env, windowsHide: true, encoding: 'utf8', input: sql, timeout: 15000,
        });
        if (result.error) throw result.error;
        if (result.status !== 0) {
          const failure = new Error(result.stderr);
          failure.code = /ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1];
          throw failure;
        }
        return result.stdout.trim();
      });
    }
  } finally {
    if (fs.existsSync(path.join(data, 'postmaster.pid'))) {
      run('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '45', 'stop']);
    }
    removeCluster(directory, data);
  }
}

function writePassword(directory) {
  const password = require('node:crypto').randomUUID();
  const file = path.join(directory, 'password');
  fs.writeFileSync(file, password + '\n');
  env.PGPASSWORD = password;
  return file;
}

if (require.main === module) {
  const scenarios = {
    '--multi-assignees': 'task-assignees-activation.sql',
    '--multi-assignees-integration': 'task-assignees-activation.sql',
    '--multi-assignees-reversal': 'task-assignees-activation.sql',
    '--public-band-identity': 'public-band-identity.sql',
    '--public-band-events': 'public-band-events.sql',
    '--task-event-link': 'task-event-link.sql',
    '--clear': 'notifications-clear.sql',
    '--band-delete': 'notifications-band-delete.sql',
    '--entry-requests': 'notifications-entry-requests.sql',
    '--task-assignments': 'notifications-task-assignments.sql',
    '--event-creation': 'notifications-event-creation.sql',
    '--install-demo': 'notifications-band-delete.sql',
  };
  const testFile = scenarios[process.argv[2]] ?? 'notifications-isolated.sql';
  const variablesByScenario = {
    '--install-demo': ['-v', 'notifications_bundle=1'],
    '--multi-assignees-reversal': ['-v', 'multi_reversal=1'],
  };
  const variables = variablesByScenario[process.argv[2]] ?? [];
  const integration = process.argv[2] === '--multi-assignees-integration'
    ? require('./task-assignees-integration.cjs') : undefined;
  main(testFile, variables, integration).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
