/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');

async function loadOverview({ member = true, signedIn = true } = {}) {
  const states = [], effects = [], calls = [];
  let cursor = 0;
  const band = { id: 'band', name: 'Demo', description: null, slug: 'demo' };
  const client = {
    auth: { getSession: async () => ({ data: { session: signedIn ? { user: { id: 'creator' } } : null }, error: null }) },
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const result = () => {
        if (table === 'bands') {
          // Model the demo schema: requesting the missing column rejects the query.
          if (call.columns.split(',').map(value => value.trim()).includes('is_public')) {
            return { data: null, error: { code: '42703', message: 'column bands.is_public does not exist' } };
          }
          return { data: band, error: null };
        }
        if (table === 'band_members') return call.options?.head
          ? { data: null, count: 1, error: null }
          : { data: member ? { role: 'admin' } : null, error: null };
        return { data: table === 'tasks' ? [] : null, error: null };
      };
      return {
        select(columns, options) { call.columns = columns; call.options = options; return this; },
        eq(column, value) { call.filters.push([column, value]); return this; },
        gte() { return this; }, order() { return this; }, limit() { return this; },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
    },
  };
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/app/bandas/[bandId]/page.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, Date, Intl,
    require(name) {
      if (name === 'react') return { ...React,
        useState(initial) { const index = cursor++; states[index] = initial;
          return [initial, value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
        useEffect(effect) { effects.push(effect); },
      };
      if (name === 'next/navigation') return { useParams: () => ({ bandId: 'band' }) };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
      if (name === '@/lib/date-time') return { watchPageClock() {}, isTaskOverdue: () => false };
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null, BandWorkspaceInfo: () => null };
      return require(name);
    },
  });
  mod.exports.default();
  const cleanups = effects.map(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  cleanups.forEach(cleanup => cleanup?.());
  return { states, calls };
}

test('overview loads a new band and summaries without the publication column', async () => {
  const { states, calls } = await loadOverview();
  assert.equal(states[1], 'ready');
  assert.equal(states[0].name, 'Demo');
  assert.equal(states[0].role, 'admin');
  assert.equal(states[2].tasks.total, 0);
  assert.equal(states[2].members, 1);
  assert.equal(states[3].event, 'ready');
  assert.deepEqual(calls.find(call => call.table === 'bands').filters, [['id', 'band']]);
  assert.deepEqual(calls[0].filters, [['band_id', 'band'], ['user_id', 'creator']]);
});

test('overview does not query bands or summaries without membership', async () => {
  const { states, calls } = await loadOverview({ member: false });
  assert.equal(states[1], 'unavailable');
  assert.deepEqual(calls.map(call => call.table), ['band_members']);
});

test('overview does not query private tables without a session', async () => {
  const { states, calls } = await loadOverview({ signedIn: false });
  assert.equal(states[1], 'unauthenticated');
  assert.equal(calls.length, 0);
});
