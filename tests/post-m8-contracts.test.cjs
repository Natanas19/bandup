/* eslint-disable @typescript-eslint/no-require-imports */
// Static generation/source checks only. No SQL/launcher execution or connection.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { read, contractBlock, functions, assertProtectedIfCases } = require('./publication-contracts.cjs');
const { columns, policies, canonicalPolicy, keys, foreign, checks, structuralBlock, postM8ReviewedContract, postM8Suite } = require('./post-m8-contracts.cjs');
const sql = read('supabase/tests/compatibility_post_m8.sql');

test('post-M8 artifact reuses the exact reviewed contract and stays in a gated read-only transaction', () => {
  assert.equal(sql, postM8Suite(), 'generated artifact must match reviewed sources');
  assert.ok(sql.includes(postM8ReviewedContract()));
  assert.equal((sql.match(/DO \$reviewed_contract\$/g) || []).length, 1);
  assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.ok(sql.indexOf('\\ir compatibility_lab_identity_check.sql') < sql.indexOf('DO $post_m8_structure$'));
  assert.match(sql, /ROLLBACK;\s*$/);
  const code = sql.replace(/--[^\n]*/g, '').replace(/'(?:''|[^'])*'/g, "''");
  assert.doesNotMatch(code, /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|COMMIT|TRUNCATE|EXECUTE|CALL|COPY)\b/i);
  assert.doesNotMatch(code, /\b(?:FROM|JOIN)\s+(?:public|auth|private)\./i);
  assert.doesNotMatch(code, /\bprivate\.\w+\s*\(/i);
  assert.doesNotMatch(sql, /\\(?:connect|!|gexec|copy)\b/i);
  let depth = 0;
  for (const char of code) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    assert.ok(depth >= 0, 'balanced parentheses');
  }
  assert.equal(depth, 0);
});

test('SQL CASE in IF conditions is protected from the PL/pgSQL THEN delimiter without changing contracts', () => {
  const original = contractBlock('bridge');
  const corrected = postM8ReviewedContract();
  // The source that caused the reported PostgreSQL failure must fail this regression.
  assert.throws(() => assertProtectedIfCases(original), /Unprotected CASE/);
  assert.doesNotThrow(() => assertProtectedIfCases(sql));
  const argumentCase = /\(CASE WHEN expected\.result_type='boolean'[\s\S]*?END ELSE '' END\)/;
  const inventoryCase = /\(CASE WHEN reader='bandup_public_reader'::regrole::oid THEN 3 ELSE 2 END\)/;
  assert.match(corrected, argumentCase);
  assert.match(corrected, inventoryCase);
  const unwrap = match => match.slice(1, -1);
  // Exactly four added parentheses: every operand, value and other token is identical.
  assert.equal(corrected.replace(argumentCase, unwrap).replace(inventoryCase, unwrap), original);
  for (const expression of [argumentCase, inventoryCase]) {
    assert.throws(() => assertProtectedIfCases(corrected.replace(expression, unwrap)), /Unprotected CASE/);
  }
});

test('columns/defaults derive from M1 plus exactly the nullable M5 event_id', () => {
  const rows = columns();
  assert.equal(rows.length, 40);
  assert.deepEqual(rows.filter(r => r[0] === 'tasks' && r[1] === 'event_id'), [['tasks','event_id','uuid',false,null]]);
  for (const table of ['bands','band_members','social_links','tasks','events']) {
    assert.deepEqual(rows.find(r => r[0] === table && r[1] === 'id').slice(2), ['uuid',true,'gen_random_uuid()']);
    assert.deepEqual(rows.find(r => r[0] === table && r[1] === 'created_at').slice(2), ['timestamp with time zone',true,'now()']);
  }
  assert.ok(!rows.some(r => r[1] === 'is_public'));
  for (const token of ['attnotnull', 'attgenerated', 'attidentity', 'attcollation', 'Unexpected source columns']) assert.ok(sql.includes(token));
});

test('constraint contracts include all keys, ten FKs, five checks and M4/M5 replacements', () => {
  assert.equal(keys.length, 8);
  assert.equal(foreign.length, 10);
  assert.equal(checks.length, 5);
  assert.deepEqual(foreign.find(r => r[1] === 'tasks_event_same_band_fkey'),
    ['tasks','tasks_event_same_band_fkey','band_id,event_id','public.events','band_id,id','n','event_id']);
  assert.deepEqual(foreign.find(r => r[1] === 'tasks_assigned_to_band_member_fkey').slice(2),
    ['band_id,assigned_to','public.band_members','band_id,user_id','a',null]);
  assert.ok(checks.some(r => r[1] === 'events_event_type_not_empty_check'));
  assert.ok(!checks.some(r => r[1] === 'events_event_type_check'));
  const m4 = read('supabase/migrations/20261002190800_events_custom_event_type.sql');
  const m5 = read('supabase/migrations/20261002200000_tasks_optional_event_link.sql');
  const initial = read('supabase/migrations/20261001000000_initial_bandup_schema.sql');
  const compact = text => text.toLowerCase().replace(/\s+/g, '');
  for (const [table, name, cols, target, refcols, action] of foreign) {
    const body = initial.match(new RegExp('CREATE TABLE public\\.' + table + ' \\(([\\s\\S]*?)\\n\\);'))[1];
    if (name === 'tasks_event_same_band_fkey' || name === 'tasks_assigned_to_band_member_fkey') {
      const source = name === 'tasks_event_same_band_fkey' ? m5 : body;
      assert.ok(compact(source).includes(compact(`CONSTRAINT ${name} FOREIGN KEY (${cols}) REFERENCES ${target} (${refcols})`)));
    } else {
      assert.equal(name, table + '_' + cols + '_fkey');
      const line = body.split('\n').find(line => line.startsWith('  ' + cols + ' UUID'));
      assert.ok(compact(line).includes(compact(`REFERENCES ${target} (${refcols}) ON DELETE ${action === 'c' ? 'CASCADE' : 'SET NULL'}`)));
    }
  }
  for (const [, , expression] of checks.slice(0, 3)) {
    const match = expression.match(/^(\w+) = ANY \(ARRAY\[(.+)\]\)$/);
    const values = match[2].replaceAll('::text', '');
    assert.ok(compact(initial).includes(compact(`CHECK (${match[1]} IN (${values}))`)));
  }
  assert.match(m4, /CHECK \(length\(btrim\(event_type\)\) > 0\)/);
  assert.match(m5, /ON DELETE SET NULL \(event_id\)/);
  for (const token of ['convalidated', 'condeferrable', 'conkey', 'confkey', 'confrelid',
    'confdeltype', 'confupdtype', 'confmatchtype', 'confdelsetcols', 'indisvalid', 'indexprs', 'Unexpected source constraints']) assert.ok(sql.includes(token));
});

test('all twenty policies derive from M1-M3 with immutable administrative deletes', () => {
  const rows = policies();
  assert.equal(rows.length, 20);
  for (const table of ['bands','band_members','social_links','tasks','events']) {
    assert.equal(rows.filter(r => r[0] === table).length, 4);
    assert.deepEqual(rows.filter(r => r[0] === table).map(r => r[2]).sort(), ['a','d','r','w']);
  }
  for (const table of ['tasks', 'events']) {
    const deletion = rows.find(r => r[0] === table && r[2] === 'd');
    assert.equal(deletion[1], table + '_delete_for_admins');
    assert.equal(canonicalPolicy(deletion[3]), '(private.is_band_member(band_id)andprivate.is_band_admin(band_id))');
    assert.equal(deletion[4], null);
  }
  assert.equal(canonicalPolicy('((SELECT auth.uid()) IS NOT NULL)'), '((selectauth.uid()asuid)isnotnull)');
  assert.notEqual(canonicalPolicy('(a AND b) OR c'), canonicalPolicy('a AND (b OR c)'));
  assert.throws(() => canonicalPolicy('a; SELECT evil()'), /Unsupported policy syntax/);
  for (const p of rows) for (const expr of p.slice(3)) canonicalPolicy(expr);
  assert.ok(sql.includes("'authenticated'::regrole::oid"));
  assert.ok(sql.includes('Unexpected source policies'));
  assert.match(structuralBlock(), /pg_get_expr\(actual.polqual,actual.polrelid,false\)\),'\[\[:space:\]\]'/);
});

test('M8 body and all eight trigger semantics come from the existing contract, never behavioral writes', () => {
  const m8 = functions(read('supabase/migrations/20261023000000_tasks_ownership_immutable.sql'))[0];
  const old = functions(read('supabase/migrations/20261001000000_initial_bandup_schema.sql'))
    .find(fn => fn.name === 'prevent_task_author_or_band_change');
  const hash = fn => createHash('md5').update(fn.body).digest('hex');
  assert.ok(sql.includes(hash(m8)));
  assert.ok(!sql.includes(hash(old)));
  assert.match(m8.body, /tasks_ownership_immutable/);
  assert.doesNotMatch(m8.body, /is_band_admin/);
  for (const token of ["tgtype=expected.trigger_type", "tgenabled='O'", 'tgqual IS NULL',
    "tgattr=''", 'tgnargs=0', "tgargs=''", 'tgfoid', 'tgconstraint=0',
    'tgoldtable IS NULL', 'tgnewtable IS NULL', "::regclass))<>8"]) assert.ok(sql.includes(token), token);
});

test('schema, phase, table ACL and ownership checks are explicit and PostM8 is not wrapped in a write transaction', () => {
  for (const token of ['Wrong phase', 'relowner=owner_oid', 'relrowsecurity', 'NOT relforcerowsecurity',
    'pg_inherits', 'aclexplode', 'attacl', 'a.is_grantable', 'pg_auth_members',
    'Source ACL differs', 'Schema owner differs', 'Unexpected schema ACL']) assert.ok(sql.includes(token), token);
  const launcher = read('supabase/tests/Invoke-CompatibilityLab.ps1');
  assert.match(launcher, /'PostM8'/);
  assert.match(launcher, /PostM8 = 'tests\/compatibility_post_m8.sql'/);
  const wrap = launcher.match(/\$wrapTransaction =[^\n]+/)[0];
  assert.ok(!wrap.includes('PostM8'));
  assert.ok(launcher.indexOf("'-f',$identityPath") < launcher.indexOf("'-f',$sqlPath"));
});
