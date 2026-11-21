/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

// Uses the same fixtures as task-assignees-activation.sql, after its assertions.
const admin = '10000000-0000-0000-0000-000000000001';
const first = '10000000-0000-0000-0000-000000000002';
const second = '10000000-0000-0000-0000-000000000003';
const band = '20000000-0000-0000-0000-000000000001';
const event = '30000000-0000-0000-0000-000000000001';
const task = '40000000-0000-0000-0000-000000000003';
const origin = 'https://task-integration.example';
const quote = value => "'" + value.replaceAll("'", "''") + "'";

function load(name, dependencies = {}) {
  const testModule = { exports: {} };
  const file = path.join(__dirname, '../../src/lib', name + '.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  vm.runInNewContext(outputText, {
    module: testModule, exports: testModule.exports, process: { env: {} },
    require: id => dependencies[id] ?? require(id),
  });
  return testModule.exports;
}

module.exports = async function rehearse(sql) {
  const api = load('task-assignees');
  const { loadPersonalTasks } = load('personal-tasks', { '@/lib/task-assignees': api });
  const signature = 'public.bandup_save_task_v2(uuid,uuid,bigint,text,text,text,text,timestamptz,uuid,uuid[])';
  const contract = JSON.parse(sql(`SELECT jsonb_build_object('args', proargnames, 'returns', pg_get_function_result(oid))
    FROM pg_proc WHERE oid = ${quote(signature)}::regprocedure;`));
  assert.equal(contract.returns, 'jsonb');
  assert.equal(api.multipleTaskAssigneesEnabled(), false);
  sql(`INSERT INTO public.band_members(band_id,user_id,role) VALUES ('${band}','${first}','member');`);

  // The SDK generates actual HTTP requests. The fixture translates only these
  // known requests to SQL in the disposable cluster, without a PostgREST server.
  const writes = [];
  function clientFor(actor) {
    const asActor = query => sql(`SET ROLE authenticated; SET request.jwt.claim.role TO 'authenticated';
      SET request.jwt.claim.sub TO ${quote(actor)}; ${query}`);
    const client = createClient(origin, 'fixture-public-key', {
      auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(input);
        assert.equal(url.origin, origin);
        const { pathname, searchParams: params } = url;
        if (init.method === 'POST') {
          assert.equal(pathname, '/rest/v1/rpc/bandup_save_task_v2');
          assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + actor);
          const payload = JSON.parse(init.body);
          writes.push(payload);
          assert.deepEqual(Object.keys(payload).sort(), [...contract.args].sort());
          // Hex keeps the JSON body verbatim and independent of SQL quoting.
          const body = Buffer.from(init.body).toString('hex');
          try {
            const result = asActor(`SELECT public.bandup_save_task_v2(
              p_band_id => p.p_band_id, p_task_id => p.p_task_id,
              p_expected_revision => p.p_expected_revision, p_title => p.p_title,
              p_description => p.p_description, p_status => p.p_status, p_priority => p.p_priority,
              p_due_date => p.p_due_date, p_event_id => p.p_event_id, p_assignee_ids => p.p_assignee_ids)
              FROM jsonb_to_record(convert_from(decode('${body}','hex'),'UTF8')::jsonb) AS p(
                p_band_id uuid, p_task_id uuid, p_expected_revision bigint, p_title text,
                p_description text, p_status text, p_priority text, p_due_date timestamptz,
                p_event_id uuid, p_assignee_ids uuid[]);`);
            return Response.json(JSON.parse(result));
          } catch (error) {
            if (!error.code) throw error;
            return Response.json({ code: error.code, message: 'SQL rejected request' },
              { status: error.code === '42501' ? 403 : 400 });
          }
        }
        assert.equal(init.method, 'GET');
        if (pathname === '/rest/v1/band_members') {
          assert.equal(params.get('user_id'), 'eq.' + actor);
          return Response.json(JSON.parse(asActor(`SELECT jsonb_agg(q) FROM (
            SELECT m.band_id, m.role, jsonb_build_object('id', b.id, 'name', b.name) AS band
            FROM public.band_members m JOIN public.bands b ON b.id = m.band_id
            WHERE m.user_id = ${quote(actor)}) q;`)) ?? []);
        }
        assert.equal(pathname, '/rest/v1/tasks');
        if (params.get('select') === 'task_revision') {
          assert.equal(params.get('band_id'), 'eq.' + band);
          assert.equal(params.get('limit'), '1');
          return Response.json(JSON.parse(asActor(`SELECT jsonb_agg(q) FROM (
            SELECT task_revision FROM public.tasks WHERE band_id = '${band}' LIMIT 1) q;`)) ?? []);
        }
        assert.match(params.get('select'), /task_assignees!inner\(user_id\)/);
        assert.equal(params.get('task_assignees.user_id'), 'eq.' + actor);
        assert.equal(params.get('band_id'), 'in.(' + band + ')');
        assert.equal(params.get('order'), 'due_date.asc.nullslast,created_at.desc,id.asc');
        assert.equal(params.get('limit'), '51');
        assert.equal(params.get('offset'), '0');
        assert.match(new Headers(init.headers).get('Prefer'), /count=exact/);
        const rows = JSON.parse(asActor(`SELECT coalesce(jsonb_agg(q),'[]') FROM (
          SELECT t.id, t.band_id, t.title, t.status, t.priority, t.due_date, t.created_at,
            jsonb_build_array(jsonb_build_object('user_id', a.user_id)) AS task_assignees
          FROM public.tasks t JOIN public.task_assignees a ON (a.band_id,a.task_id) = (t.band_id,t.id)
          WHERE t.band_id = '${band}' AND a.user_id = ${quote(actor)}
          ORDER BY due_date ASC NULLS LAST, created_at DESC, id ASC LIMIT 51) q;`));
        return Response.json(rows, { headers: { 'Content-Range': '*/' + rows.length } });
      } },
    });
    return { from: client.from.bind(client), rpc: client.rpc.bind(client),
      auth: { async getUser() { return { data: { user: { id: actor } } }; } } };
  }

  const clients = new Map([admin, first, second].map(actor => [actor, clientFor(actor)]));
  const fields = { title: "Ensaio d'Água", description: null, status: 'todo', priority: 'low',
    due_date: '2027-01-03T03:00:00Z', event_id: event };
  const save = (actor, revision, ids) =>
    api.saveTaskV2(clients.get(actor), band, task, revision, fields, ids, 'Bearer ' + actor);
  assert.equal(await api.readTaskWriteMode(clients.get(admin), band), 'v2');
  assert.equal((await save(admin, null, [])).revision, 0);
  assert.equal((await save(admin, null, [first])).alreadyExists, true);
  assert.equal((await save(admin, 0, [first])).revision, 1);
  assert.equal((await save(admin, 1, [first, second])).revision, 2);
  assert.equal((await save(admin, 2, [admin, first, second])).revision, 3);
  await assert.rejects(save(admin, 2, []), { code: '40001' });
  await assert.rejects(save(first, 3, []), { code: '42501' });
  assert.equal((await save(first, 3, null)).revision, 4);
  assert.equal(writes.length, 8);

  for (const actor of [admin, first, second]) {
    const page = await loadPersonalTasks(clients.get(actor));
    assert.ok(page.tasks.some(item => item.id === task && item.title === fields.title));
    assert.equal(page.totalCount, actor === second ? 2 : 1);
  }
  assert.equal(sql(`SELECT event_id FROM public.tasks WHERE id = '${task}';`), event);
  assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(recipient_id ORDER BY recipient_id)
    FROM public.notifications WHERE content_id = '${task}';`)), [first, second]);
  assert.equal(sql(`SELECT count(*) FROM public.task_assignees WHERE task_id = '${task}';`), '3');
  console.log('PASS SDK request/response mapped to PostgreSQL 17 RPC, RLS, personal tasks, event and notifications');
};
