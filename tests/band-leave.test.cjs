/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const React = require('react');
const ts = require('typescript');
const sql = fs.readFileSync('supabase/migrations/20261111140000_bandup_leave_band.sql', 'utf8');
const executable = sql.replace(/--[^\n]*/g, '');

test('RPC authorization and minimal grants are scoped only to auth.uid()', () => {
  assert.match(executable, /CREATE FUNCTION public\.bandup_leave_band\(p_band_id UUID\)/);
  assert.match(executable, /actor UUID := auth\.uid\(\)/);
  assert.match(executable, /IF actor IS NULL OR auth\.role\(\) IS DISTINCT FROM 'authenticated' THEN/);
  assert.ok(executable.indexOf('auth.role()') < executable.indexOf('FOR UPDATE OF b NOWAIT'));
  assert.match(executable, /SECURITY DEFINER\s+SET search_path = ''\s+SET row_security = off/);
  assert.match(executable, /OWNER TO postgres/);
  assert.match(executable, /FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(executable, /GRANT EXECUTE.*TO authenticated/);
  assert.equal((executable.match(/MESSAGE = 'Band unavailable'/g) ?? []).length, 4);
});
test('RPC serializes before reading associations and rejects conflicting row locks', () => {
  assert.ok(executable.indexOf('FOR UPDATE OF b NOWAIT') < executable.indexOf('SELECT bm.*'));
  assert.match(executable, /ORDER BY bm.id FOR UPDATE NOWAIT/);
  assert.match(executable, /transaction_isolation.*read committed/);
  assert.match(executable, /ERRCODE = '25000', MESSAGE = 'READ COMMITTED required'/);
  assert.match(executable, /BEGIN\s+PERFORM bm.id[\s\S]*?FOR UPDATE NOWAIT;\s+EXCEPTION WHEN lock_not_available THEN\s+RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'Membership busy; retry later';\s+END;/);
  assert.doesNotMatch(executable, /SKIP LOCKED|ALTER POLICY|DISABLE TRIGGER|CREATE POLICY/);
});
test('transfer is deterministic, before deletion, and deletion cannot target another actor or band', () => {
  assert.match(executable, /membership.role = 'admin' AND NOT EXISTS/);
  assert.match(executable, /ORDER BY bm.created_at ASC, bm.id ASC LIMIT 1/);
  assert.match(executable, /IF successor_id IS NULL[\s\S]*ERRCODE = 'PBL01'/);
  assert.ok(executable.indexOf("SET role = 'admin'") < executable.indexOf('DELETE FROM public.band_members'));
  assert.match(executable, /WHERE id = membership.id AND band_id = p_band_id AND user_id = actor/);
  assert.match(executable, /WHERE id = successor_id AND band_id = p_band_id AND role = 'member'/);
  assert.equal((executable.match(/IF affected <> 1/g) ?? []).length, 2);
  assert.doesNotMatch(executable, /DELETE FROM public\.tasks|UPDATE public\.tasks|EXCEPTION WHEN OTHERS/);
});

function fixture(options = {}) {
  const state = { confirm: true, user: 'self', calls: [], busy: [], left: 0, redirects: [],
    response: { data: { status: 'left', administration_transferred: false }, error: null },
    membership: { data: { id: 'mine' }, error: null }, ...options };
  const slots = []; let cursor = 0;
  const client = {
    auth: { async getUser() { return { data: { user: state.user ? { id: state.user } : null }, error: null }; } },
    async rpc(name, args) { state.calls.push({ name, args }); if (state.throwRpc) throw Error('network');
      if (state.waitRpc) await state.waitRpc; return state.response; },
    from(table) { const read = { table, filters: [] }; state.calls.push(read); return {
      select() { return this; }, eq(...args) { read.filters.push(args); return this; },
      async maybeSingle() { return state.membership; },
    }; },
  };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/leave-band-button.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, window: {
    confirm() { state.confirmations = (state.confirmations ?? 0) + 1; return state.confirm; },
    location: { replace(url) { state.redirects.push(url); } },
  }, require(name) {
    if (name === 'react') return { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = v; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    };
    if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
    return require(name);
  } });
  function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes);
    return [tree, ...nodes(tree.props?.children)]; }
  function render() { cursor = 0; return nodes(mod.exports.default({ bandId: 'band-a', disabled: state.disabled,
    onBusyChange: v => state.busy.push(v), onLeft: () => state.left++ })); }
  return { state, render, click: () => render().find(n => n.type === 'button').props.onClick() };
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
test('explicit confirmation, cancellation, disabled action and signed-out authorization', async () => {
  for (const options of [{ confirm: false }, { disabled: true }, { user: null }]) {
    const f = fixture(options); f.click(); await settle();
    assert.equal(f.state.calls.length, 0); assert.equal(f.state.left, 0);
  }
});
test('confirmed success sends band only, clears page and fully reloads personal area', async () => {
  const f = fixture(); f.click(); await settle();
  assert.deepEqual(f.state.calls.map(c => JSON.parse(JSON.stringify(c))), [{ name: 'bandup_leave_band', args: { p_band_id: 'band-a' } }]);
  assert.equal(f.state.left, 1); assert.deepEqual(f.state.redirects, ['/dashboard']);
  assert.deepEqual(f.state.busy, [true, false]);
});
test('in-flight guard rejects duplicate clicks even before React rerenders', async () => {
  let release; const waitRpc = new Promise(resolve => { release = resolve; });
  const f = fixture({ waitRpc }); const button = f.render().find(n => n.type === 'button');
  button.props.onClick(); button.props.onClick(); await settle();
  assert.equal(f.state.calls.length, 1); assert.equal(f.render().find(n => n.type === 'button').props.disabled, true);
  release(); await settle(); assert.equal(f.state.left, 1);
});
for (const code of ['PBL01', '42501', '55P03', '40001', '40P01', '25000', 'PGRST202']) {
  test(`definitive database error ${code} never claims success`, async () => {
    const f = fixture({ response: { data: null, error: { code } } }); f.click(); await settle();
    assert.equal(f.state.left, 0); assert.equal(f.state.calls.length, 1);
    assert.ok(f.render().some(n => n.props?.role === 'alert'));
    const message = f.render().find(n => n.props?.role === 'alert').props.children;
    if (['55P03', '40001', '40P01'].includes(code)) {
      assert.match(message, /outra alteração em andamento/);
      assert.doesNotMatch(message, /autorizar/);
    }
    if (code === '42501') assert.match(message, /autorizar sua saída ou a banda está indisponível/);
    if (code === '25000') assert.match(message, /configuração da transação/);
    assert.equal(f.render().find(n => n.type === 'button').props.children, 'Sair da banda');
  });
}
test('ambiguous response checks only own association in the selected band', async () => {
  const f = fixture({ response: { data: null, error: null }, membership: { data: null, error: null } });
  f.click(); await settle(); assert.equal(f.state.left, 1);
  assert.equal(JSON.stringify(f.state.calls[1]), JSON.stringify({ table: 'band_members', filters: [['band_id', 'band-a'], ['user_id', 'self']] }));
});
test('remaining association or failed verification never retries the mutation automatically', async () => {
  for (const membership of [{ data: { id: 'mine' }, error: null }, { data: null, error: { code: 'network' } }]) {
    const f = fixture({ response: { data: { status: 'unexpected' }, error: null }, membership });
    f.click(); await settle(); f.click(); await settle();
    assert.equal(f.state.calls.filter(c => c.name).length, 1); assert.equal(f.state.left, 0);
    assert.equal(f.render().find(n => n.type === 'button').props.children, 'Verificar meu acesso');
  }
});
test('network failure stays uncertain; changed identity cannot reconcile another account', async () => {
  const f = fixture({ throwRpc: true }); f.click(); await settle();
  f.state.user = 'another'; f.click(); await settle();
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.left, 0);
});
