/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit administrative entry point. Importing this module does not connect.
const fs = require('node:fs');
const path = require('node:path');
const { openSession } = require('../helpers/band-leave-postgres.cjs');
async function main(mode) {
  if (!['setup', 'cleanup'].includes(mode)) throw Error('Choose setup or cleanup');
  const s = await openSession({ url: process.env.BANDUP_LEAVE_TEST_DATABASE_URL, requireBootstrap: mode !== 'setup' });
  const sql = mode === 'setup'
    ? fs.readFileSync(path.join(__dirname, 'band-leave-bootstrap.sql'), 'utf8') + '\n' +
      fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261111140000_bandup_leave_band.sql'), 'utf8')
    : fs.readFileSync(path.join(__dirname, 'band-leave-cleanup.sql'), 'utf8');
  s.p.stdin.end(sql);
  const result = await s.done;
  if (result.code !== 0) throw Error('Local preparation/cleanup failed; no connection details are logged');
}
if (require.main === module) main(process.argv[2]).then(() => {
  process.stdout.write('Local disposable operation completed.\n');
}).catch(() => {
  process.stderr.write('Local disposable operation rejected or failed. Review the target, prerequisites and SQL files.\n');
  process.exitCode = 1;
});
module.exports = { main };
