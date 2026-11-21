/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const React = require("react");
const ts = require("typescript");

function fixture() {
  const calls = [];
  const state = { result: { data: [], error: null }, confirm: true };
  const client = {
    async rpc(name, args) {
      calls.push(["rpc", name, JSON.parse(JSON.stringify(args))]);
      return state.result;
    },
    from(table) {
      calls.push(["from", table]);
      return {
        select(...args) { calls.push(["select", ...args]); return this; },
        eq(...args) { calls.push(["eq", ...args]); return this; },
        order(column) { calls.push(["order", column]); return this; },
        abortSignal(signal) { calls.push(["abortSignal", signal]); return this; },
        insert(values) { calls.push(["insert", JSON.parse(JSON.stringify(values))]); return this; },
        update(values) { calls.push(["update", JSON.parse(JSON.stringify(values))]); return this; },
        delete() { calls.push(["delete"]); return this; },
        async maybeSingle() { return state.result; },
        async single() { return state.result; },
        then(resolve, reject) { return Promise.resolve(state.result).then(resolve, reject); },
      };
    },
  };
  const hookSlots = [];
  let index = 0;
  let effects = [];
  const react = {
    ...React,
    useState(initial) {
      const slot = index++;
      hookSlots[slot] ??= { value: initial };
      return [hookSlots[slot].value, next => {
        hookSlots[slot].value = typeof next === "function" ? next(hookSlots[slot].value) : next;
      }];
    },
    useRef(value) { return hookSlots[index++] ??= { current: value }; },
    useEffect(effect, dependencies) {
      const slot = index++;
      const previous = hookSlots[slot];
      if (previous && dependencies.every((value, i) => value === previous.dependencies[i])) return;
      effects.push(() => {
        previous?.cleanup?.();
        hookSlots[slot] = { dependencies, cleanup: effect() };
      });
    },
  };

  const modules = new Map();
  function load(file) {
    if (!modules.has(file)) {
      const mod = { exports: {} };
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText, {
        module: mod, exports: mod.exports, URL, AbortController, window: { confirm: () => state.confirm },
        require(name) {
          if (name === "react") return react;
          if (name === "next/link") return { default: "a", __esModule: true };
          if (name === "@/lib/supabase/client") return { getSupabaseBrowserClient: () => client };
          if (name === "@/components/navigation-icon") return load("src/components/navigation-icon.tsx");
          if (name.startsWith("@/lib/")) return load(`src/lib/${name.split("/").at(-1)}.ts`);
          return require(name);
        },
      });
      modules.set(file, mod.exports);
    }
    return modules.get(file);
  }
  function renderManager(isAdmin = true) {
    const manager = load("src/components/band-public-links.tsx").default({ bandId: "band", isAdmin });
    return renderWithHooks(() => manager.type(manager.props));
  }
  function renderWithHooks(render) {
    index = 0;
    effects = [];
    const tree = render();
    effects.forEach(effect => effect());
    return tree;
  }
  function unmount() {
    hookSlots.forEach(slot => slot.cleanup?.());
    hookSlots.length = 0;
  }
  return { calls, state, load, renderManager, renderWithHooks, unmount, api: load("src/lib/band-public-links.ts") };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function text(tree) {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree?.props ? text(tree.props.children) : "";
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const input = { platform: "custom", label: null, url: "https://example.com" };
const link = { ...input, position: 1, id: "link" };

function openMenu(renderManager, name) {
  const trigger = nodes(renderManager()).find(node => node.type === "button" && node.props["aria-label"] === `Ações do link ${name}`);
  assert.equal(trigger.props["aria-expanded"], false);
  trigger.props.onClick();
  const tree = nodes(renderManager());
  assert.equal(tree.find(node => node.props?.["aria-controls"] === trigger.props["aria-controls"]).props["aria-expanded"], true);
  const panel = tree.find(node => node.props?.id === trigger.props["aria-controls"]);
  assert.equal(panel.props.hidden, false);
  return nodes(panel).filter(node => node.type === "button");
}

test("public links normalize HTTPS and enforce the migration's platform, host and length rules", () => {
  const { api } = fixture();
  for (const [platform, url] of [
    ["spotify", "https://open.spotify.com/track/abc"],
    ["instagram", "https://www.instagram.com/example"],
    ["youtube", "https://youtu.be/abc"],
    ["tiktok", "https://vm.tiktok.com/abc"],
    ["custom", "https://example.com/a%20b?x=1"],
  ]) assert.equal(api.getBandPublicLinkUrl(url, platform), url);
  assert.equal(api.getBandPublicLinkUrl(" HTTPS://EXAMPLE.COM/path ", "custom"), "https://example.com/path");
  for (const url of ["http://example.com", "https://user@example.com", "https://example.com:443", "https://localhost",
    "https://127.0.0.1", "https://example.com/%GG", "https://example.com/a b", "https://example.com\\foo",
    "https://example.com/a\n", "https://example.com/" + "a".repeat(2048)]) {
    assert.equal(api.getBandPublicLinkUrl(url, "custom"), null, url);
  }
  assert.equal(api.getBandPublicLinkUrl("https://open.spotify.com.example.com", "spotify"), null);
  assert.equal(api.getBandPublicLinkUrl("https://example.com", "facebook"), null);
  assert.equal(api.validateBandPublicLink({ ...input, label: "  " }).label, null);
  assert.equal(api.validateBandPublicLink({ ...input, label: "🎵".repeat(80) }).label.length, 160);
  assert.throws(() => api.validateBandPublicLink({ ...input, label: "a".repeat(81) }), /80 caracteres/);
  assert.throws(() => api.validateBandPublicLink({ ...input, label: "a\nb" }), /uma única linha/);
});

test("CRUD is scoped by band and link, and a zero-row mutation fails safely", async () => {
  const { api, calls, state } = fixture();
  const signal = new AbortController().signal;
  await api.listBandPublicLinks("band", signal);
  assert.deepEqual(calls, [["from", "band_public_links"], ["select", "id, platform, label, url, position"],
    ["eq", "band_id", "band"], ["order", "position"], ["abortSignal", signal]]);

  state.result = { data: { id: "link" }, error: null };
  calls.length = 0;
  await api.saveBandPublicLink("band", input, [link]);
  assert.deepEqual(calls[1], ["insert", { ...input, band_id: "band", position: 2 }]);
  calls.length = 0;
  await api.saveBandPublicLink("band", { ...input, label: "Edited" }, [link], "link");
  assert.deepEqual(calls.slice(1), [["update", { ...input, label: "Edited" }], ["eq", "band_id", "band"], ["eq", "id", "link"], ["select", "id"]]);
  calls.length = 0;
  await api.deleteBandPublicLink("band", "link");
  assert.deepEqual(calls.slice(1), [["delete"], ["eq", "band_id", "band"], ["eq", "id", "link"], ["select", "id"]]);

  state.result = { data: null, error: null };
  await assert.rejects(api.saveBandPublicLink("band", input, [link], "link"), /confirmar a edição/);
  await assert.rejects(api.deleteBandPublicLink("band", "link"), /confirmar a exclusão/);
});

test("the ninth insert is skipped, gaps can be reused, and a position conflict is surfaced", async () => {
  const { api, calls, state } = fixture();
  const full = Array.from({ length: 8 }, (_, i) => ({ ...link, position: i + 1 }));
  await assert.rejects(api.saveBandPublicLink("band", input, full), /limite de 8/);
  assert.ok(!calls.some(([action]) => action === "insert"));
  state.result = { data: null, error: { code: "23505" } };
  await assert.rejects(api.saveBandPublicLink("band", input, full.filter(item => item.position !== 4)), /ocupada em outra sessão/);
  assert.equal(calls.find(([action]) => action === "insert")[1].position, 4);
});

test("members can load their own band's links without mutation controls", async () => {
  const { calls, state, renderManager } = fixture();
  state.result.data = [link, { ...link, id: "second", position: 2 }];
  assert.match(text(renderManager(false)), /Carregando links públicos/);
  await tick();
  const tree = renderManager(false);
  assert.match(text(tree), /2\/8 links utilizados/);
  assert.equal(nodes(tree).filter(node => node.type === "a").length, 2);
  assert.equal(nodes(tree).filter(node => node.type === "button").length, 0);
  assert.ok(calls.some(([action, key, value]) => action === "eq" && key === "band_id" && value === "band"));
  assert.ok(!calls.some(([action]) => ["rpc", "insert", "update", "delete"].includes(action)));
});

test("a fresh client mount reads updated links after the previous manager unmounts", async () => {
  const { calls, state, renderManager, unmount } = fixture();
  renderManager();
  await tick();
  assert.match(text(renderManager()), /0\/8 links utilizados/);
  state.result.data = [{ ...link, label: "Novo site" }];
  assert.doesNotMatch(text(renderManager()), /Novo site/);
  unmount();
  renderManager();
  await tick();
  assert.match(text(renderManager()), /Novo site/);
  assert.equal(calls.filter(([action, table]) => action === "from" && table === "band_public_links").length, 2);
});

test("admin sees loading, a recoverable error, the empty state and capacity", async () => {
  const { state, renderManager } = fixture();
  state.result = { data: null, error: { code: "42501" } };
  assert.match(text(renderManager()), /Carregando links públicos/);
  await tick();
  const failed = renderManager();
  assert.match(text(failed), /Não foi possível carregar/);
  const retry = nodes(failed).find(node => node.type === "button" && text(node) === "Tentar novamente");
  assert.ok(retry);
  state.result = { data: [], error: null };
  retry.props.onClick();
  assert.match(text(renderManager()), /Carregando links públicos/);
  await tick();
  const empty = renderManager();
  assert.match(text(empty), /0\/8 links utilizados/);
  assert.match(text(empty), /Nenhum link público cadastrado/);

  const full = fixture();
  full.state.result.data = Array.from({ length: 8 }, (_, index) => ({ ...link, id: String(index), position: index + 1 }));
  full.renderManager();
  await tick();
  const fullTree = full.renderManager();
  assert.match(text(fullTree), /8\/8 links utilizados/);
  assert.equal(nodes(fullTree).find(node => node.type === "button" && text(node) === "Adicionar link").props.disabled, true);
});

test("the links manager opens the existing add form", async () => {
  const { calls, renderManager } = fixture();
  renderManager();
  await tick();
  nodes(renderManager()).find(node => node.type === "button" && text(node) === "Adicionar link").props.onClick();
  assert.ok(nodes(renderManager()).some(node => node.type === "form" && node.props["aria-label"] === "Adicionar link público"));
  assert.ok(!calls.some(([action]) => action === "insert"));
});

test("section rows expose independent primary actions and menus with temporary organization", () => {
  const { load, calls, renderWithHooks } = fixture();
  const Sections = load("src/components/band-public-sections.tsx").default;
  const linksManager = React.createElement("div", null, "Existing manager");
  const render = () => renderWithHooks(() => Sections({ isAdmin: true, linksManager }));
  const trigger = (label) => nodes(render()).find(node => node.props["aria-label"] === label);
  const panel = (id) => nodes(render()).find(node => node.props.id === id);
  const action = (id) => nodes(panel(id)).find(node => node.type === "button");
  const rowHeader = (label) => nodes(render()).find(node =>
    node.type === "li" && nodes(node.props.children[0]).some(child => child.props["aria-label"] === `Ações de ${label}`))
    .props.children[0];

  assert.doesNotMatch(text(render()), /Editar perfil/);
  for (const label of ["Links", "Loja", "Eventos", "Ingressos", "Música", "Fotos"]) {
    const header = rowHeader(label);
    const [primary, menu] = header.props.children;
    assert.match(header.props.className, /rounded-2xl border border-nav-border bg-surface/);
    assert.match(primary.props.children.props.children[0].props.className, /rounded-xl bg-accent-soft p-2/);
    assert.equal(nodes(menu).find(node => node.type === "button").props.children.props.name, "Ellipsis");
    if (label !== "Links") {
      assert.equal(primary.type, "span");
      assert.match(text(primary), /Em breve/);
    }
  }

  const add = trigger("Adicionar seção");
  add.props.onClick();
  assert.match(text(panel(add.props["aria-controls"])), /Todas as seções/);
  const shop = trigger("Ações de Loja");
  shop.props.onClick();
  assert.equal(panel(add.props["aria-controls"]).props.hidden, true);
  const shopPanel = panel(shop.props["aria-controls"]);
  assert.equal(shopPanel.props.hidden, false);
  assert.match(shopPanel.props.className, /13rem\+env\(safe-area-inset-bottom\)/);
  action(shop.props["aria-controls"]).props.onClick();
  assert.equal(trigger("Ações de Loja"), undefined);
  trigger("Adicionar seção").props.onClick();
  assert.equal(text(action(add.props["aria-controls"])), "Adicionar LojaEm breve");
  action(add.props["aria-controls"]).props.onClick();
  assert.ok(trigger("Ações de Loja"));

  const links = trigger("Ações de Links");
  links.props.onClick();
  let focused = false;
  const linksRow = nodes(render()).find(node => node.type === "li" && nodes(node).some(child => child.props["aria-controls"] === links.props["aria-controls"]));
  linksRow.props.onKeyDown({ key: "Escape", preventDefault() {}, currentTarget: { querySelector: () => ({ focus: () => { focused = true; } }) } });
  assert.equal(focused, true);
  assert.equal(panel(links.props["aria-controls"]).props.hidden, true);

  const linksShortcut = () => rowHeader("Links").props.children[0];
  assert.equal(linksShortcut().type, "button");
  assert.equal(linksShortcut().props["aria-expanded"], false);
  const managerId = linksShortcut().props["aria-controls"];
  assert.notEqual(managerId, links.props["aria-controls"]);
  linksShortcut().props.onClick();
  assert.equal(linksShortcut().props["aria-expanded"], true);
  assert.equal(trigger("Ações de Links").props["aria-expanded"], false);
  assert.equal(panel(managerId).props.hidden, false);
  linksShortcut().props.onClick();

  links.props.onClick();
  assert.equal(panel(managerId).props.hidden, true);
  action(links.props["aria-controls"]).props.onClick();
  assert.equal(linksShortcut().props["aria-expanded"], true);
  assert.equal(panel(managerId).props.hidden, false);
  assert.equal(panel(managerId).props.children, linksManager);
  assert.deepEqual(calls, []);
});

test("admin move controls call a single scoped RPC and update the confirmed order", async () => {
  const { calls, state, renderManager } = fixture();
  const first = { ...link, label: "Primeiro" };
  const second = { ...link, id: "second", position: 3, label: "Segundo" };
  state.result.data = [first, second];
  renderManager();
  await tick();
  const unavailable = openMenu(renderManager, "Primeiro").find(node => node.props["aria-label"] === "Subir link Primeiro");
  assert.equal(unavailable.props["aria-disabled"], true);
  unavailable.props.onClick();
  assert.ok(!calls.some(([action]) => action === "rpc"));

  state.result = { data: null, error: null };
  openMenu(renderManager, "Segundo").find(node => node.props["aria-label"] === "Subir link Segundo").props.onClick();
  await tick();
  assert.deepEqual(calls.filter(([action]) => action === "rpc"), [["rpc", "bandup_swap_public_link_positions", {
    p_band_id: "band", p_first_id: "second", p_first_position: 3, p_second_id: "link", p_second_position: 1,
  }]]);
  const updated = renderManager();
  assert.match(text(updated), /Ordem dos links atualizada/);
  assert.match(text(updated), /Segundo[\s\S]*Primeiro/);
});

test("stale positions trigger a fresh list and an accessible conflict message", async () => {
  const { calls, state, renderManager } = fixture();
  const neighbor = { ...link, id: "second", position: 2, label: "Segundo" };
  state.result.data = [link, neighbor];
  renderManager();
  await tick();
  const move = openMenu(renderManager, "Segundo").find(node => node.props["aria-label"] === "Subir link Segundo");
  state.result = { data: null, error: { code: "PT409" } };
  move.props.onClick();
  await tick();
  state.result = { data: [neighbor], error: null };
  const reloading = renderManager();
  assert.match(text(nodes(reloading).find(node => node.props?.role === "alert")), /A ordem ou a lista mudou/);
  await tick();
  assert.match(text(renderManager()), /1\/8 links utilizados/);
  assert.equal(calls.filter(([action]) => action === "order").length, 2);
});

test("delete waits for confirmation and reports success after a confirmed response", async () => {
  const { calls, state, renderManager } = fixture();
  state.result.data = [link];
  renderManager();
  await tick();
  const remove = openMenu(renderManager, "Personalizado").find(node => text(node) === "Excluir");
  state.confirm = false;
  remove.props.onClick();
  assert.ok(!calls.some(([action]) => action === "delete"));
  state.confirm = true;
  state.result = { data: { id: "link" }, error: null };
  remove.props.onClick();
  await tick();
  state.result = { data: [], error: null };
  renderManager();
  await tick();
  assert.match(text(renderManager()), /Link excluído/);
});

test("row menus close with Escape and open the existing edit form", async () => {
  const { renderManager, state } = fixture();
  state.result.data = [link];
  renderManager();
  await tick();
  const collapsed = nodes(renderManager());
  assert.equal(collapsed.find(node => node.props?.id === "band-public-link-actions-link").props.hidden, true);
  assert.ok(!collapsed.some(node => node.type === "button" && text(node) === "Editar"));
  openMenu(renderManager, "Personalizado");
  const row = nodes(renderManager()).find(node => typeof node.props?.onKeyDown === "function" && node.type === "li");
  let restored = false;
  row.props.onKeyDown({ key: "Escape", preventDefault() {}, currentTarget: {
    querySelector: () => ({ focus() { restored = true; } }),
  } });
  assert.equal(restored, true);
  const actions = openMenu(renderManager, "Personalizado");
  assert.ok(actions.filter(node => ["Subir", "Descer"].includes(text(node))).every(node => node.props["aria-disabled"]));
  actions.find(node => text(node) === "Editar").props.onClick();
  const editing = nodes(renderManager());
  assert.equal(editing.find(node => node.props?.id === "band-public-link-actions-link").props.hidden, true);
  assert.ok(editing.some(node => node.type === "form" && node.props["aria-label"] === "Editar link público"));
});
