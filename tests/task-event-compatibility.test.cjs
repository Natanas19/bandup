/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,
  '../src/lib/task-event-compatibility.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: mod, exports: mod.exports });
const { readTasksWithEventSupport, taskColumns, taskEventValues } = mod.exports;
const missing = { code: '42703', message: 'column tasks.event_id does not exist' };

function fixture(results) {
  const calls = [];
  const client = { from(table) {
    const call = { table, filters: [], orders: [] }; calls.push(call);
    return {
      select(columns) { call.columns = columns; return this; },
      eq(...args) { call.filters.push(args); return this; },
      order(...args) { call.orders.push(args); return this; },
      then(resolve, reject) { return Promise.resolve(results[calls.indexOf(call)]).then(resolve, reject); },
    };
  } };
  return { client, calls };
}

test('missing task event column retries only the band-scoped read, preserving ordering', async () => {
  const rows = [{ id: 'task', status: 'todo' }];
  const f = fixture([{ data: null, error: missing }, { data: rows, error: null }]);
  const result = await readTasksWithEventSupport(f.client, 'band');
  assert.equal(result.supportsEvents, false);
  assert.equal(result.data, rows);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].columns.includes('event_id'));
  assert.equal(f.calls[1].columns.includes('event_id'), false);
  for (const call of f.calls) {
    assert.equal(call.table, 'tasks');
    assert.deepEqual(call.filters, [['band_id', 'band']]);
    assert.deepEqual(JSON.parse(JSON.stringify(call.orders)), [['due_date', { ascending: true, nullsFirst: false }], ['created_at', { ascending: false }]]);
  }
});

test('supported schema preserves associations without fallback', async () => {
  const rows = [{ id: 'task', event_id: 'event' }];
  const f = fixture([{ data: rows, error: null }]);
  const result = await readTasksWithEventSupport(f.client, 'band');
  assert.equal(result.supportsEvents, true);
  assert.equal(result.data[0].event_id, 'event');
  assert.equal(f.calls.length, 1);
});

for (const error of [
  { code: '42501', message: 'permission denied for table tasks' },
  { code: 'PGRST301', message: 'JWT expired' },
  { code: '', message: 'TypeError: Failed to fetch' },
  { code: '42703', message: 'column tasks.assigned_to does not exist' },
  { code: '42703', message: 'column events.event_id does not exist' },
  { code: '42501', message: missing.message },
  { code: 'PGRST204', message: 'Unknown schema cache error' },
]) test(`no fallback for ${error.code}: ${error.message}`, async () => {
  const f = fixture([{ data: null, error }]);
  const result = await readTasksWithEventSupport(f.client, 'band');
  assert.equal(result.error, error);
  assert.equal(f.calls.length, 1);
});

test('fallback errors propagate rather than authorizing an empty task list', async () => {
  const error = { code: '42501', message: 'permission denied' };
  const f = fixture([{ error: missing, data: null }, { error, data: null }]);
  assert.equal((await readTasksWithEventSupport(f.client, 'band')).error, error);
  assert.equal(f.calls.length, 2);
});

test('payload and return projection omit missing column and reject attempted association', () => {
  assert.equal('event_id' in taskEventValues(false, ''), false);
  assert.equal(taskColumns(false).includes('event_id'), false);
  assert.throws(() => taskEventValues(false, 'event'), /não permite vincular/);
  assert.equal(taskEventValues(true, 'event').event_id, 'event');
  assert.equal(taskEventValues(true, '').event_id, null);
  assert.ok(taskColumns(true).includes('event_id'));
});
