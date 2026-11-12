/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");

// In-memory component harness: no network, authentication changes or DB writes.
function fixture(initialStates = {}, cryptoSource = { randomUUID: () => "12345678-1234-4234-8234-123456789abc" }, options = {}) {
  const states = { ...initialStates }, calls = [], cache = new Map();
  let cursor = 0;
  const client = {
    auth: {
      getUser: async () => { calls.push("getUser"); return { data: { user: { id: "user" } } }; },
      getSession: async () => { calls.push("getSession"); return { data: { session: options.signedOut ? null : { user: { id: "user" } } } }; },
    },
    from(table) {
      calls.push(["from", table]);
      let saved = table === "band_members"
        ? options.nonMember ? null : { user_id: "user", role: options.role ?? "admin" }
        : options.record ?? { id: "existing", created_by: "user", assigned_to: "user" };
      let writing = false;
      const query = {
        insert(values) { writing = true; calls.push(["insert", table, values]); saved = { ...saved, id: "new", ...values }; return this; },
        update(values) { writing = true; calls.push(["update", table, values]); saved = { ...saved, id: "existing", ...values }; return this; },
        delete() { writing = true; calls.push(["delete", table]); return this; },
        select(columns) { calls.push(["select", table, columns]); return this; }, eq(column, value) { calls.push(["eq", table, column, value]); return this; },
        maybeSingle: async () => writing && (options.writeError || options.noWriteRow)
          ? { data: null, error: options.writeError ?? null } : { data: saved },
        single: async () => ({ data: saved }),
      };
      return query;
    },
  };
  function load(relative) {
    const filename = path.resolve(__dirname, "..", relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} }; cache.set(filename, loadedModule);
    const localRequire = (name) => {
      if (name === "react") return { ...React,
        useState: (initial) => { const i = cursor++; if (!(i in states)) states[i] = initial;
          return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
        useEffect: () => {},
        useRef: (initial) => { const i = cursor++; return states[i] ??= { current: initial }; },
      };
      if (name === "next/navigation") return { useParams: () => ({ bandId: "band" }), useRouter: () => ({ replace: (url) => calls.push(["navigate", url]), refresh() {} }) };
      if (name === "next/link") return { __esModule: true, default: () => null };
      if (name === "@/lib/supabase/client") return { getSupabaseBrowserClient: () => client };
      if (name === "@/lib/band-logo-upload") return { BandLogoError: class extends Error {}, bandPhotoSession: async () => ({ scoped: client, verify: async () => {} }) };
      if (name.startsWith("@/components/")) return { __esModule: true, default: () => null, LinkifiedText: () => null };
      if (name.startsWith("@/lib/")) return load("src/" + name.slice(2) + ".ts");
      return require(name);
    };
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
    }).outputText;
    vm.runInNewContext(code, { process: { env: { NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED: "true" } }, module: loadedModule, exports: loadedModule.exports, require: localRequire,
      crypto: cryptoSource, Uint8Array, Error, Date, Intl, URL, AbortController,
      window: { confirm: () => true, scrollTo: () => {}, setTimeout, clearTimeout },
    }, { filename });
    return loadedModule.exports;
  }
  return { load, calls, states, render(Component) { cursor = 0; return Component(); } };
}

function findForm(tree) {
  if (!tree || typeof tree !== "object") return null;
  if (Array.isArray(tree)) return tree.map(findForm).find(Boolean);
  return tree.type === "form" ? tree : findForm(tree.props?.children);
}

test("required text rejects empty/whitespace values and accepts meaningful text unchanged", () => {
  const { requiredTextError } = fixture().load("src/lib/form-validation.ts");
  for (const value of ["", " ", "\t\r\n", "\u00a0\u2003\u3000"]) {
    assert.equal(requiredTextError(value, "o nome da banda"), "Informe o nome da banda.");
  }
  for (const value of ["Banda", "  São João 🎵  ", "A B", "東京"]) {
    assert.equal(requiredTextError(value, "o nome da banda"), null);
  }
});

test("native slug keeps the existing normalization and eight-hexadecimal suffix", () => {
  const { createBandSlug } = fixture().load("src/lib/band-slug.ts");
  assert.equal(createBandSlug("  São João & Amigos!  "), "sao-joao-amigos-12345678");
  assert.equal(createBandSlug("🎵 東京"), "banda-12345678");
  for (const value of ["", " \t\n", "\u00a0"]) assert.throws(() => createBandSlug(value), /Informe o nome da banda/);
});

test("HTTP fallback uses four cryptographic bytes and preserves leading zeros and fresh entropy", () => {
  let requests = 0;
  const { createBandSlug } = fixture({}, {
    getRandomValues(bytes) {
      assert.equal(bytes.length, 4);
      bytes.set(requests++ === 0 ? [0, 1, 128, 255] : [16, 32, 48, 64]);
      return bytes;
    },
  }).load("src/lib/band-slug.ts");
  assert.equal(createBandSlug("Banda"), "banda-000180ff");
  assert.equal(createBandSlug("Banda"), "banda-10203040");
  assert.equal(requests, 2);
});

test("slug never falls back to weak randomness when crypto is unavailable or fails", () => {
  const { createBandSlug } = fixture({}, undefined).load("src/lib/band-slug.ts");
  assert.throws(() => createBandSlug("Banda", {}), /endereço seguro/);
  assert.throws(() => createBandSlug("Banda", { getRandomValues() { throw new Error("unavailable"); } }), /unavailable/);
});

const forms = [
  { name: "band", file: "src/app/bandas/nova/page.tsx", title: 3, error: 5, initial: { 0: { id: "user" }, 1: false }, message: "Informe o nome da banda.", table: "bands" },
  { name: "task", file: "src/app/bandas/[bandId]/tarefas/page.tsx", title: 14, error: 10, initial: { 0: "ready", 6: true }, message: "Informe o título da tarefa.", table: "tasks", editing: 7 },
  { name: "event", file: "src/app/bandas/[bandId]/agenda/page.tsx", title: 15, error: 11, initial: { 0: "ready", 6: true, 19: "2099-12-31T18:00" }, message: "Informe o título do evento.", table: "events", editing: 7 },
];

for (const form of forms) {
  for (const editing of form.editing ? [false, true] : [false]) {
    test(`${form.name} ${editing ? "edit" : "create"}: invalid required text never reaches Supabase`, async () => {
      for (const value of ["", "   ", "\t\n", "\u00a0\u3000"]) {
        const f = fixture({ ...form.initial, [form.title]: value, ...(editing ? { [form.editing]: "existing" } : {}) });
        const Component = f.load(form.file).default;
        await findForm(f.render(Component)).props.onSubmit({ preventDefault() {} });
        assert.equal(f.states[form.error], form.message);
        assert.equal(f.calls.length, 0);
        assert.equal(f.states[form.title], value, "validation must preserve the input");
      }
    });

    test(`${form.name} ${editing ? "edit" : "create"}: valid text is trimmed only at submission`, async () => {
      const originals = editing ? (form.name === "task"
        ? { 3: [{ id: "existing", due_date: null }] }
        : { 4: [{ id: "existing", start_at: "2099-12-31T18:00:00Z", end_at: null }] }) : {};
      const f = fixture({ ...form.initial, ...originals, [form.title]: "  São João 🎵  ", ...(editing ? { [form.editing]: "existing" } : {}) });
      const Component = f.load(form.file).default;
      await findForm(f.render(Component)).props.onSubmit({ preventDefault() {} });
      const write = f.calls.find((call) => call[0] === (editing ? "update" : "insert"));
      assert.ok(write);
      assert.equal(write[1], form.table);
      assert.equal(write[2][form.name === "band" ? "name" : "title"], "São João 🎵");
      if (form.name === "band") {
        assert.equal(write[2].slug, "sao-joao-12345678");
        assert.equal("id" in write[2], false, "database must still generate the UUID");
      }
    });
  }
}

test("band creation works without randomUUID and does not insert if secure randomness is missing", async () => {
  for (const available of [true, false]) {
    const f = fixture({ 0: { id: "user" }, 1: false, 3: "Banda" }, available ? {
      getRandomValues(bytes) { bytes.set([1, 2, 3, 4]); return bytes; },
    } : {});
    await findForm(f.render(f.load("src/app/bandas/nova/page.tsx").default)).props.onSubmit({ preventDefault() {} });
    const insert = f.calls.find((call) => call[0] === "insert");
    assert.equal(Boolean(insert), available);
    if (available) assert.equal(insert[2].slug, "banda-01020304");
    else {
      assert.ok(f.states[5].includes("Não foi possível criar a banda"));
      assert.equal(f.states[3], "Banda");
    }
  }
});

test("event custom type and required schedule validation remain active", async () => {
  for (const extra of [{ 17: "other", 18: "   " }, { 19: "" }]) {
    const f = fixture({ 0: "ready", 6: true, 15: "Show", 19: "2099-12-31T18:00", ...extra });
    await findForm(f.render(f.load("src/app/bandas/[bandId]/agenda/page.tsx").default)).props.onSubmit({ preventDefault() {} });
    assert.equal(f.calls.length, 0);
    assert.ok(f.states[11].startsWith("Informe"));
  }
});

function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const actionButton = (tree, text) => nodes(tree, (node) => node.type === "button" && node.props.children === text)[0];
const taskRecord = { id: "existing", title: "Repertório", description: null, created_by: "author", assigned_to: "assignee",
  status: "todo", priority: "medium", due_date: null, event_id: null, created_at: "2026-01-01T12:00:00Z" };
const eventRecord = { id: "existing", title: "Show", description: null, created_by: "author", event_type: "show",
  start_at: "2099-12-31T18:00:00Z", end_at: null, location: null, created_at: "2026-01-01T12:00:00Z" };
for (const supportsEvents of [false, true]) {
  for (const editing of [false, true]) {
    test(`task ${editing ? 'edit and complete' : 'create'} uses the detected event support: ${supportsEvents}`, async () => {
      const record = { ...taskRecord, created_by: 'user', assigned_to: null,
        ...(supportsEvents ? { event_id: 'event' } : {}) };
      if (!supportsEvents) delete record.event_id;
      const f = fixture({ 0: 'ready', 2: true, 3: [record],
        4: [{ id: 'event', title: 'Show', start_at: '2099-01-01T12:00:00Z' }],
        6: true, 7: editing ? 'existing' : null, 14: 'Task', 16: 'done',
        20: supportsEvents ? 'event' : '', 21: 'user', 22: supportsEvents },
      undefined, { record });
      const tree = f.render(f.load('src/app/bandas/[bandId]/tarefas/page.tsx').default);
      assert.equal(nodes(tree, n => n.props?.id === 'task-event')[0].props.disabled, !supportsEvents);
      await findForm(tree).props.onSubmit({ preventDefault() {} });
      const writes = f.calls.filter(call => ['insert', 'update'].includes(call[0]));
      assert.equal(writes.length, 1, 'writes must never be retried');
      assert.equal(writes[0][2].status, 'done');
      assert.equal('event_id' in writes[0][2], supportsEvents);
      if (supportsEvents) assert.equal(writes[0][2].event_id, 'event');
      const returned = f.calls.filter(call => call[0] === 'select' && call[1] === 'tasks').at(-1);
      assert.equal(returned[2].includes('event_id'), supportsEvents);
      assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'band_members' && call[2] === 'band_id' && call[3] === 'band'));
      if (editing) assert.ok(f.calls.some(call => call[0] === 'eq' && call[1] === 'tasks' && call[2] === 'band_id' && call[3] === 'band'));
    });
  }
}

test('task rejects an attempted event association without schema support before writing', async () => {
  const f = fixture({ 0: 'ready', 6: true, 14: 'Task', 20: 'event', 21: 'user', 22: false });
  await findForm(f.render(f.load('src/app/bandas/[bandId]/tarefas/page.tsx').default))
    .props.onSubmit({ preventDefault() {} });
  assert.ok(f.states[10].includes('não permite vincular'));
  assert.equal(f.calls.some(call => ['insert', 'update'].includes(call[0])), false);
});

const profiles = [
  { name: "admin", role: "admin", creator: "author", assignee: "assignee", taskEdit: true, eventEdit: true, remove: true },
  { name: "author", role: "member", creator: "user", assignee: "assignee", taskEdit: true, eventEdit: true, remove: false },
  { name: "assignee", role: "member", creator: "author", assignee: "user", taskEdit: true, eventEdit: false, remove: false },
  { name: "other member", role: "member", creator: "author", assignee: "assignee", taskEdit: false, eventEdit: false, remove: false },
  { name: "outsider even if author/assignee", role: null, creator: "user", assignee: "user", taskEdit: false, eventEdit: false, remove: false },
];

test("permission predicates match installed RLS, including task WITH CHECK after reassignment", () => {
  const p = fixture().load("src/lib/record-permissions.ts");
  for (const profile of profiles) {
    const access = p.getBandAccess("user", profile.role);
    const record = { created_by: profile.creator, assigned_to: profile.assignee };
    assert.equal(p.canEditTask(access, record), profile.taskEdit, profile.name);
    assert.equal(p.canEditEvent(access, record), profile.eventEdit, profile.name);
    assert.equal(p.canSaveTask(access, record, profile.assignee), profile.taskEdit, profile.name);
    assert.equal(p.canSaveTask(access, record, null), profile.eventEdit, profile.name);
    assert.equal(p.canSaveTask(access, record, "another-member"), profile.eventEdit, profile.name);
  }
  assert.equal(p.getBandAccess(null, "admin"), null);
  assert.equal(p.getBandAccess("user", "unknown"), null);
});

for (const kind of ["task", "event"]) {
  const form = forms.find((candidate) => candidate.name === kind);
  const index = kind === "task" ? { records: 3, user: 21, open: 6, deletingError: 12, admin: 2 } : { records: 4, user: 22, open: 6, deletingError: 13, admin: 3 };
  function prepare(profile, options = {}, open = false) {
    const record = { ...(kind === "task" ? taskRecord : eventRecord), created_by: profile.creator,
      ...(kind === "task" ? { assigned_to: profile.assignee } : {}) };
    const initial = { 0: profile.role ? "ready" : "unavailable", [index.records]: [record], [index.user]: profile.role ? "user" : null,
      [index.admin]: profile.role === "admin", [index.open]: open,
      ...(kind === "task" ? { 5: [{ userId: "user", label: "Você" }, { userId: "assignee", label: "Responsável" }] } : { 1: Date.now() }),
    };
    const f = fixture(initial, undefined, { role: profile.role, nonMember: !profile.role, record, ...options });
    const Component = f.load(form.file).default;
    return { f, Component, record, render: () => f.render(Component) };
  }

  for (const profile of profiles) {
    test(`${kind}: ${profile.name} sees only permitted actions`, () => {
      const { render } = prepare(profile);
      const tree = render();
      assert.equal(Boolean(actionButton(tree, "Editar")), kind === "task" ? profile.taskEdit : profile.eventEdit);
      assert.equal(Boolean(actionButton(tree, "Excluir")), profile.remove);
      assert.equal(Boolean(actionButton(tree, kind === "task" ? "+ Nova tarefa" : "+ Novo evento")), !!profile.role);
      assert.equal(nodes(tree, (node) => node.type === "article").length, profile.role ? 1 : 0);
    });

    if (kind === "task" ? profile.taskEdit : profile.eventEdit) {
      test(`${kind}: ${profile.name} can save an authorized edit${kind === "task" ? " and conclude through status" : ""}`, async () => {
        const { f, render } = prepare(profile);
        actionButton(render(), "Editar").props.onClick();
        let tree = render();
        assert.ok(findForm(tree));
        if (kind === "task") {
          nodes(tree, (node) => node.props?.id === "task-status")[0].props.onChange({ target: { value: "done" } });
          const assignee = nodes(tree, (node) => node.props?.id === "task-assignee")[0];
          assert.equal(assignee.props.disabled, profile.name === "assignee");
          tree = render();
        }
        await findForm(tree).props.onSubmit({ preventDefault() {} });
        const update = f.calls.find((call) => call[0] === "update");
        assert.ok(update);
        if (kind === "task") assert.equal(update[2].status, "done");
        assert.ok(f.calls.some((call) => call[0] === "eq" && call[2] === "band_id" && call[3] === "band"));
        assert.equal("created_by" in update[2], false);
        assert.equal("band_id" in update[2], false);
      });
    }
  }

  test(`${kind}: fresh permission loss blocks a stale edit, including completion`, async () => {
    for (const options of [{ role: "member", record: kind === "task" ? taskRecord : eventRecord }, { nonMember: true }, { signedOut: true }]) {
      const { f, render } = prepare(profiles[0], options);
      actionButton(render(), "Editar").props.onClick();
      await findForm(render()).props.onSubmit({ preventDefault() {} });
      assert.equal(f.calls.some((call) => call[0] === "update"), false);
      assert.ok(f.states[form.error]);
      assert.equal(f.states[index.records].length, 1);
    }
  });

  test(`${kind}: RLS refusal and zero returned rows do not report successful edits`, async () => {
    for (const options of [{ writeError: { code: "42501" } }, { noWriteRow: true }]) {
      const { f, render } = prepare(profiles[0], options);
      actionButton(render(), "Editar").props.onClick();
      await findForm(render()).props.onSubmit({ preventDefault() {} });
      assert.ok(f.states[form.error].includes(options.writeError ? "permissão" : "removido"));
      assert.equal(f.states[index.open], true);
      assert.equal(f.states[index.records][0].title, kind === "task" ? "Repertório" : "Show");
    }
  });

  test(`${kind}: delete revalidates admin role and retains rows when denied`, async () => {
    for (const options of [{}, { role: "member" }, { nonMember: true }, { writeError: { code: "42501" } }, { noWriteRow: true }]) {
      const { f, render } = prepare(profiles[0], options);
      actionButton(render(), "Excluir").props.onClick();
      await new Promise(setImmediate);
      const allowed = Object.keys(options).length === 0;
      assert.equal(f.states[index.records].length, allowed ? 0 : 1);
      if (!allowed) assert.ok(f.states[index.deletingError]);
      if (options.role || options.nonMember) assert.equal(f.calls.some((call) => call[0] === "delete"), false);
    }
  });

  test(`${kind}: any member may create, outsiders cannot bypass the form`, async () => {
    for (const nonMember of [false, true]) {
      const f = fixture({ ...form.initial, [form.title]: "Novo registro" }, undefined, { role: "member", nonMember });
      await findForm(f.render(f.load(form.file).default)).props.onSubmit({ preventDefault() {} });
      assert.equal(f.calls.some((call) => call[0] === "insert"), !nonMember);
    }
  });
}

test("task assignee cannot bypass disabled reassignment field", async () => {
  const f = fixture({ 0: "ready", 3: [{ ...taskRecord, assigned_to: "user" }], 5: [{ userId: "assignee", label: "Outro" }],
    6: true, 7: "existing", 14: "Tarefa", 19: "assignee", 21: "user" }, undefined,
    { role: "member", record: { ...taskRecord, assigned_to: "user" } });
  await findForm(f.render(f.load(forms[1].file).default)).props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.some((call) => call[0] === "update"), false);
  assert.ok(f.states[10].includes("responsável selecionado"));
});

// Full form regressions: all writes below go only to the in-memory Supabase stub.
for (const phase of ["future", "started", "ended"]) {
  test(`event ${phase}: edit text without rewriting either timestamp`, async () => {
    const now = Date.now();
    const start = new Date(now + (phase === "future" ? 86_400_000 : -86_400_000)).toISOString().replace(/\.\d{3}Z$/, ".123456Z");
    const end = new Date(now + (phase === "ended" ? -43_200_000 : 172_800_000)).toISOString().replace(/\.\d{3}Z$/, ".654321Z");
    const record = { ...eventRecord, created_by: "user", start_at: start, end_at: end };
    const f = fixture({ 0: "ready", 1: now, 3: true, 4: [record], 22: "user" }, undefined, { record });
    const Component = f.load(forms[2].file).default;
    actionButton(f.render(Component), "Editar").props.onClick();
    let tree = f.render(Component);
    const input = nodes(tree, (node) => node.props?.id === "event-start")[0];
    assert.equal(input.props.min, undefined, "native min must not block editing old events");
    nodes(tree, (node) => node.props?.id === "event-title")[0].props.onChange({ target: { value: "Local atualizado" } });
    tree = f.render(Component);
    await findForm(tree).props.onSubmit({ preventDefault() {} });
    const write = f.calls.find((call) => call[0] === "update");
    assert.ok(write, f.states[11]);
    assert.equal(write[2].title, "Local atualizado");
    assert.equal("start_at" in write[2], false);
    assert.equal("end_at" in write[2], false);
    assert.equal(f.states[4][0].start_at, start);
    assert.equal(f.states[4][0].end_at, end);
  });
}

test("event form: changing original start to a different past date never writes", async () => {
  const record = { ...eventRecord, created_by: "user", start_at: "2020-01-01T18:00:30.123Z" };
  const f = fixture({ 0: "ready", 3: true, 4: [record], 22: "user" }, undefined, { record });
  const Component = f.load(forms[2].file).default;
  actionButton(f.render(Component), "Editar").props.onClick();
  const tree = f.render(Component);
  nodes(tree, (node) => node.props?.id === "event-start")[0].props.onChange({ target: { value: "2020-01-02T12:00" } });
  await findForm(f.render(Component)).props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.some((call) => call[0] === "update"), false);
  assert.match(f.states[11], /passado/);
});

test("event form: creating a new event in the past never writes", async () => {
  const f = fixture({ 0: "ready", 6: true, 15: "Evento", 19: "2020-01-01T12:00" });
  const Component = f.load(forms[2].file).default;
  await findForm(f.render(Component)).props.onSubmit({ preventDefault() {} });
  assert.equal(f.calls.length, 0);
  assert.match(f.states[11], /passado/);
});

test("task form: text-only edit and completion preserve original deadline precision", async () => {
  const due = "2020-01-01T00:00:30.123456Z";
  const record = { ...taskRecord, created_by: "user", due_date: due };
  const f = fixture({ 0: "ready", 2: true, 3: [record], 21: "user", 5: [{ userId: "assignee", label: "Integrante" }] }, undefined, { record });
  const Component = f.load(forms[1].file).default;
  actionButton(f.render(Component), "Editar").props.onClick();
  let tree = f.render(Component);
  assert.equal(nodes(tree, (node) => node.props?.id === "task-due-date")[0].props.value, "2019-12-31");
  nodes(tree, (node) => node.props?.id === "task-status")[0].props.onChange({ target: { value: "done" } });
  tree = f.render(Component);
  await findForm(tree).props.onSubmit({ preventDefault() {} });
  const write = f.calls.find((call) => call[0] === "update");
  assert.ok(write, f.states[10]);
  assert.equal("due_date" in write[2], false);
  assert.equal(write[2].status, "done");
  assert.equal(f.states[3][0].due_date, due);
});
