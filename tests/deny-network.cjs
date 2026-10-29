/* eslint-disable @typescript-eslint/no-require-imports */
// Validation-only preload. Never imported by the application.
// Forbids all outgoing TCP/fetch unless an exact loopback HTTP origin is supplied.
const net = require('node:net');
const approved = process.env.BANDUP_TEST_HTTP_ORIGIN;
let allowed;
if (approved) {
  allowed = new URL(approved);
  if (allowed.protocol !== 'http:' || allowed.hostname !== '127.0.0.1' || !allowed.port
      || ['5433','5434'].includes(allowed.port)) throw new Error('Invalid validation origin');
}
function deny(message) { process.emitWarning(message, { code: 'BANDUP_NETWORK_BLOCKED' }); throw new Error(message); }
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const option = Array.isArray(args[0]) ? args[0][0] : args[0];
  // Node IPC named pipes are used by local build workers, not by PostgreSQL TCP.
  if (typeof option === 'string' && option.startsWith('\\\\.\\pipe\\')) return connect.apply(this,args);
  if (option && typeof option === 'object' && typeof option.path === 'string') return connect.apply(this,args);
  const port = typeof option === 'object' ? option?.port : option;
  const host = typeof option === 'object' ? option?.host : args[1];
  if (!allowed || String(port) !== allowed.port || !['127.0.0.1','::ffff:127.0.0.1'].includes(host)) {
    deny('Outgoing network disabled during release validation');
  }
  return connect.apply(this,args);
};
if (globalThis.fetch) {
  const fetch = globalThis.fetch;
  globalThis.fetch = function (input,...args) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!allowed || url.origin !== allowed.origin) deny('Outgoing fetch disabled during release validation');
    return fetch(input,...args);
  };
}
