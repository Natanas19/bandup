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

async function main(testFile, variables = []) {
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
    run('psql', ['-X', '-w', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'test_port=' + port,
      '-v', 'test_data=' + data.replaceAll('\\', '/'),
      ...variables,
      '-f', path.join(__dirname, testFile)]);
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
    '--public-band-identity': 'public-band-identity.sql',
    '--public-band-events': 'public-band-events.sql',
    '--clear': 'notifications-clear.sql',
    '--band-delete': 'notifications-band-delete.sql',
    '--entry-requests': 'notifications-entry-requests.sql',
    '--task-assignments': 'notifications-task-assignments.sql',
    '--event-creation': 'notifications-event-creation.sql',
    '--install-demo': 'notifications-band-delete.sql',
  };
  const testFile = scenarios[process.argv[2]] ?? 'notifications-isolated.sql';
  const variables = process.argv[2] === '--install-demo' ? ['-v', 'notifications_bundle=1'] : [];
  main(testFile, variables).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
