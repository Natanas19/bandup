/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const postcss = require("postcss");
const tailwind = require("tailwindcss");

const root = path.resolve(__dirname, "..");
function modules(globals = {}, react = React) {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const filename = path.join(root, name);
    const loadedModule = { exports: {} };
    cache.set(name, loadedModule);
    const localRequire = (id) => {
      if (id === "react") return react;
      if (id === "next/font/google") return { Inter: () => ({ variable: "font-inter" }) };
      // Dashboard theme fixtures start after the separately tested welcome flow.
      if (id === "@/components/welcome-onboarding" && globals.onboardingCompleted) return { __esModule: true, default: ({ children }) => children };
      if (id === "next/navigation") return { useRouter: () => ({ replace() {} }), useParams: () => ({ bandId: "theme-band" }), usePathname: () => globals.testPathname ?? "/bandas/theme-band" };
      if (id === "@/lib/supabase/client") return globals.supabaseMock ?? { getSupabaseBrowserClient() { throw new Error("Tests must not contact Auth"); } };
      if (id === "./globals.css") return {};
      if (id.startsWith("@/")) {
        const base = "src/" + id.slice(2);
        const target = [base + ".ts", base + ".tsx"].find((file) => fs.existsSync(path.join(root, file)));
        assert.ok(target, "Missing local dependency: " + id);
        return load(target);
      }
      if (id.startsWith("./")) {
        const base = path.join(path.dirname(name), id);
        const target = [base + ".ts", base + ".tsx"].find((file) => fs.existsSync(path.join(root, file)));
        if (target) return load(target);
      }
      return require(id);
    };
    const source = fs.readFileSync(filename, "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, { process: { env: { NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED: "true" } }, module: loadedModule, exports: loadedModule.exports, require: localRequire, URL, ...globals }, { filename });
    // Resolve the enabled wrapper as React would; clients stay mocked.
    if (typeof loadedModule.exports.default === "function") {
      const Component = loadedModule.exports.default;
      loadedModule.exports.default = (...args) => {
        const element = Component(...args);
        return typeof element?.type === "function" && element.type.name.startsWith("EnabledBand")
          ? element.type(element.props) : element;
      };
    }
    return loadedModule.exports;
  }
  return { load };
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const api = modules().load("src/lib/theme.ts");

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    dispatch(name, event = {}) { [...(listeners.get(name) ?? [])].forEach((fn) => fn(event)); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function environment(options = {}) {
  const state = { ...options };
  const values = new Map(options.saved === undefined ? [] : [[api.THEME_STORAGE_KEY, options.saved]]);
  const writes = [], attributes = new Map(), legacy = new Set();
  const media = { ...eventTarget(), matches: !!options.dark };
  if (options.legacy) {
    delete media.addEventListener; delete media.removeEventListener;
    media.addListener = (fn) => legacy.add(fn);
    media.removeListener = (fn) => legacy.delete(fn);
  }
  const storage = {
    getItem(key) { if (state.readFailure) throw new Error("Read unavailable"); return values.get(key) ?? null; },
    setItem(key, value) { if (state.writeFailure) throw new Error("Write unavailable"); writes.push([key, value]); values.set(key, value); },
  };
  const element = { setAttribute: (name, value) => attributes.set(name, value), style: {} };
  const page = { ...eventTarget(), documentElement: element, visibilityState: "visible" };
  const browser = { ...eventTarget(), matchMedia: (query) => { assert.equal(query, "(prefers-color-scheme: dark)"); return media; } };
  Object.defineProperty(browser, "localStorage", { get() { if (state.storageFailure) throw new Error("Storage denied"); return storage; } });
  if (options.noMedia) delete browser.matchMedia;
  function system(dark, notify = true) {
    media.matches = dark;
    if (notify) {
      if (options.legacy) [...legacy].forEach((fn) => fn({ matches: dark }));
      else media.dispatch("change", { matches: dark });
    }
  }
  return { browser, page, media, storage, state, writes, values, attributes, element, legacy, system };
}

function assertAppearance(env, preference, resolved) {
  assert.equal(env.attributes.get("data-appearance"), preference);
  assert.equal(env.attributes.get("data-theme"), resolved);
  assert.equal(env.element.style.colorScheme, resolved);
}

test("preference validation and resolution cover all three choices", () => {
  for (const value of [null, undefined, "", "auto", "bad", {}, "system"]) assert.equal(api.normalizeThemePreference(value), "system");
  assert.equal(api.normalizeThemePreference("light"), "light");
  assert.equal(api.normalizeThemePreference("dark"), "dark");
  for (const dark of [false, true]) {
    assert.equal(api.resolveTheme("light", dark), "light");
    assert.equal(api.resolveTheme("dark", dark), "dark");
    assert.equal(api.resolveTheme("system", dark), dark ? "dark" : "light");
  }
});

for (const saved of [undefined, "system", "invalid", "light", "dark"]) {
  for (const dark of [false, true]) {
    test(`inline initialization before hydration: saved=${saved}, systemDark=${dark}`, () => {
      const env = environment({ saved, dark });
      // Execute the actual script emitted into the head, with no module globals.
      vm.runInNewContext(api.THEME_INITIALIZATION_SCRIPT, { window: env.browser, document: env.page });
      const preference = saved === "light" || saved === "dark" ? saved : "system";
      assertAppearance(env, preference, api.resolveTheme(preference, dark));
      assert.equal(env.writes.length, 0, "initialization must not overwrite a stored choice");
    });
  }
}

test("storage contents are never interpolated as executable bootstrap source", () => {
  const env = environment({ saved: "</script><script>window.compromised=true</script>", dark: true });
  assert.equal(api.THEME_INITIALIZATION_SCRIPT.includes("compromised"), false);
  vm.runInNewContext(api.THEME_INITIALIZATION_SCRIPT, { window: env.browser, document: env.page });
  assertAppearance(env, "system", "dark");
  assert.equal(env.browser.compromised, undefined);
});

test("selection persists per origin and reloads; automatic mode is stored as a preference", () => {
  const env = environment();
  const controller = api.createThemeController(env.browser, env.page);
  controller.setPreference("dark"); assertAppearance(env, "dark", "dark");
  assert.equal(env.values.get(api.THEME_STORAGE_KEY), "dark");
  controller.dispose();
  const reload = api.createThemeController(env.browser, env.page);
  assert.deepEqual(plain(reload.getSnapshot()), { preference: "dark", resolvedTheme: "dark" });
  env.system(true);
  reload.setPreference("light"); assertAppearance(env, "light", "light");
  reload.setPreference("system"); assertAppearance(env, "system", "dark");
  assert.equal(env.values.get(api.THEME_STORAGE_KEY), "system");
  reload.dispose();
});

test("system changes affect automatic mode immediately and preserve explicit choices", () => {
  const env = environment(), controller = api.createThemeController(env.browser, env.page), seen = [];
  const unsubscribe = controller.subscribe((snapshot) => seen.push(plain(snapshot)));
  env.system(true); assertAppearance(env, "system", "dark");
  assert.equal(env.writes.length, 0);
  controller.setPreference("light");
  env.system(false); env.system(true); assertAppearance(env, "light", "light");
  controller.setPreference("dark"); env.system(false); assertAppearance(env, "dark", "dark");
  controller.setPreference("system"); assertAppearance(env, "system", "light");
  const stable = controller.getSnapshot(), count = seen.length;
  env.system(false); assert.equal(controller.getSnapshot(), stable); assert.equal(seen.length, count);
  unsubscribe(); env.system(true); assert.equal(seen.length, count);
  controller.dispose();
});

test("legacy Safari listeners receive system changes and are removed on cleanup", () => {
  const env = environment({ legacy: true });
  const controller = api.createThemeController(env.browser, env.page);
  assert.equal(env.legacy.size, 1);
  env.system(true); assertAppearance(env, "system", "dark");
  controller.dispose(); controller.dispose();
  assert.equal(env.legacy.size, 0); assert.equal(env.browser.listenerCount(), 0); assert.equal(env.page.listenerCount(), 0);
  const writes = env.writes.length;
  env.system(false); controller.setPreference("light");
  assertAppearance(env, "system", "dark"); assert.equal(env.writes.length, writes);
});

test("storage failures do not prevent initialization, switching or resume", () => {
  for (const failure of ["readFailure", "writeFailure", "storageFailure"]) {
    const env = environment({ dark: true, [failure]: true });
    vm.runInNewContext(api.THEME_INITIALIZATION_SCRIPT, { window: env.browser, document: env.page });
    const controller = api.createThemeController(env.browser, env.page);
    controller.setPreference("light"); assertAppearance(env, "light", "light");
    env.browser.dispatch("focus"); env.browser.dispatch("pageshow");
    assertAppearance(env, "light", "light");
    controller.setPreference("system"); env.system(false); assertAppearance(env, "system", "light");
    controller.dispose();
  }
});

test("failed writes retain the in-memory override even when an older choice remains readable", () => {
  const env = environment({ saved: "light", writeFailure: true });
  const controller = api.createThemeController(env.browser, env.page);
  controller.setPreference("dark");
  env.browser.dispatch("focus"); env.browser.dispatch("pageshow"); env.page.dispatch("visibilitychange");
  assertAppearance(env, "dark", "dark"); assert.equal(env.values.get(api.THEME_STORAGE_KEY), "light");
  controller.dispose();
});

test("missing media API falls back to light but still honors explicit dark mode", () => {
  const env = environment({ noMedia: true });
  vm.runInNewContext(api.THEME_INITIALIZATION_SCRIPT, { window: env.browser, document: env.page });
  assertAppearance(env, "system", "light");
  const controller = api.createThemeController(env.browser, env.page);
  controller.setPreference("dark"); assertAppearance(env, "dark", "dark"); controller.dispose();
});

test("cross-tab storage changes sync without writes; unrelated/session keys are ignored", () => {
  const env = environment(), controller = api.createThemeController(env.browser, env.page);
  env.browser.dispatch("storage", { key: "unrelated", newValue: "dark", storageArea: env.storage });
  assertAppearance(env, "system", "light");
  env.browser.dispatch("storage", { key: api.THEME_STORAGE_KEY, newValue: "dark", storageArea: {} });
  assertAppearance(env, "system", "light");
  env.values.set(api.THEME_STORAGE_KEY, "dark");
  env.browser.dispatch("storage", { key: api.THEME_STORAGE_KEY, newValue: "dark", storageArea: env.storage });
  assertAppearance(env, "dark", "dark"); assert.equal(env.writes.length, 0);
  env.values.clear(); env.system(true);
  env.browser.dispatch("storage", { key: null, newValue: null, storageArea: env.storage });
  assertAppearance(env, "system", "dark");
  controller.dispose();
});

test("resume reconciles suspended system events and storage changes, ignoring hidden pages", () => {
  const env = environment(), controller = api.createThemeController(env.browser, env.page);
  env.page.visibilityState = "hidden"; env.system(true, false);
  env.page.dispatch("visibilitychange"); assertAppearance(env, "system", "light");
  env.page.visibilityState = "visible"; env.page.dispatch("visibilitychange"); assertAppearance(env, "system", "dark");
  env.values.set(api.THEME_STORAGE_KEY, "light"); env.browser.dispatch("pageshow"); assertAppearance(env, "light", "light");
  env.values.set(api.THEME_STORAGE_KEY, "system"); env.browser.dispatch("focus"); assertAppearance(env, "system", "dark");
  controller.dispose(); assert.equal(env.media.listenerCount(), 0);
});

test("server render keeps content visible and selector neutral until hydration", () => {
  const loader = modules();
  const { ThemeProvider } = loader.load("src/components/theme-provider.tsx");
  const Selector = loader.load("src/components/theme-selector.tsx").default;
  const html = renderToStaticMarkup(React.createElement(ThemeProvider, null,
    React.createElement("p", null, "Conteúdo visível"), React.createElement(Selector)));
  assert.ok(html.includes("Conteúdo visível"));
  assert.match(html, /<select[^>]*disabled=""/);
  assert.match(html, /<option value="system" selected="">Automático<\/option>/);
  assert.ok(html.includes("Claro") && html.includes("Escuro") && html.includes("Aparência"));
  const label = html.match(/<label[^>]*for="([^"]+)"/)[1];
  assert.ok(html.includes(`id="${label}"`));
  assert.throws(() => renderToStaticMarkup(React.createElement(Selector)), /ThemeProvider/);
});

test("root emits a synchronous inline initializer in head before visible body content", () => {
  const loader = modules({ testPathname: "/" });
  const Layout = loader.load("src/app/layout.tsx").default;
  const tree = Layout({ children: React.createElement("p", null, "Página") });
  assert.equal(tree.type, "html"); assert.equal(tree.props.suppressHydrationWarning, true);
  const html = renderToStaticMarkup(tree);
  assert.ok(html.indexOf('id="bandup-theme-init"') < html.indexOf("<body"));
  assert.ok(html.includes(api.THEME_INITIALIZATION_SCRIPT));
  const script = html.match(/<script[^>]*id="bandup-theme-init"[^>]*>/)[0];
  assert.equal(/\b(src|async|defer|type)=/.test(script), false);
  assert.ok(html.includes("Página"));
});

test("provider, selector and listeners stay in sync through mounting, switching and cleanup", () => {
  const env = environment({ saved: "dark" }), states = [], refs = [], effects = [];
  let stateIndex = 0, refIndex = 0, context;
  const hooks = { ...React,
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = initial;
      return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; },
    useEffect(effect) { effects.push(effect); }, useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useContext: () => context, useId: () => "appearance-test",
  };
  const loader = modules({ window: env.browser, document: env.page }, hooks);
  const { ThemeProvider } = loader.load("src/components/theme-provider.tsx");
  const Selector = loader.load("src/components/theme-selector.tsx").default;
  function render() { stateIndex = refIndex = 0; context = ThemeProvider({ children: "Visible" }).props.value; return Selector({}); }
  let selector = render(); assert.equal(selector.props.children[1].props.disabled, true);
  const cleanup = effects[0]();
  selector = render(); assert.equal(selector.props.children[1].props.value, "dark"); assert.equal(selector.props.children[1].props.disabled, false);
  selector.props.children[1].props.onChange({ target: { value: "system" } });
  selector = render(); assert.equal(selector.props.children[1].props.value, "system"); assert.equal(context.resolvedTheme, "light");
  env.system(true); render(); assert.equal(context.resolvedTheme, "dark"); assertAppearance(env, "system", "dark");
  cleanup(); assert.equal(env.browser.listenerCount(), 0); assert.equal(env.media.listenerCount(), 0);
  // React Strict Mode may set up the same effect again after cleanup.
  const secondCleanup = effects[0](); assert.equal(env.browser.listenerCount(), 3);
  secondCleanup(); assert.equal(env.browser.listenerCount(), 0); assert.equal(env.page.listenerCount(), 0);
});

test("CSS has identical semantic token sets, preserves light colors and provides system fallback", () => {
  const ast = postcss.parse(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"));
  const tokens = (selector) => {
    const rule = ast.nodes.flatMap((node) => node.type === "atrule" ? node.nodes ?? [] : [node]).find((node) => node.selector === selector);
    return Object.fromEntries(rule.nodes.filter((node) => node.type === "decl" && node.prop.startsWith("--") && !node.prop.startsWith("--font")).map((node) => [node.prop, node.value]));
  };
  const light = tokens(":root"), dark = tokens(':root[data-theme="dark"]');
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
  assert.equal(light["--background"], "#faf9ff"); assert.equal(light["--foreground"], "#211b35");
  assert.deepEqual(tokens(":root:not([data-theme])"), dark);
  const fallback = ast.nodes.find((node) => node.type === "atrule" && node.params === "(prefers-color-scheme: dark)");
  assert.ok(fallback.nodes.some((node) => node.selector === ":root:not([data-theme])"));
  function rgb(value) { return value.startsWith("#") ? value.slice(1).match(/../g).map((v) => parseInt(v, 16)) : value.split(" ").map(Number); }
  function luminance(value) { return rgb(value).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0); }
  for (const palette of [light, dark]) {
    const pairs = [["foreground", "background"], ["content", "surface"], ["content-muted", "surface"], ["content-subtle", "surface"], ["on-primary", "primary"], ["accent", "accent-soft"],
      ...["danger", "warning", "success", "info"].map((kind) => [kind + "-text", kind + "-bg"])];
    for (const [text, surface] of pairs) {
      const a = luminance(palette["--" + text]), b = luminance(palette["--" + surface]);
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `Low text contrast: ${text}/${surface}`);
    }
  }
});

test("Tailwind emits semantic selector utilities and opacity variants without modern color functions", async () => {
  const config = modules().load("tailwind.config.ts").default;
  const selector = fs.readFileSync(path.join(root, "src/components/theme-selector.tsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const result = await postcss([tailwind({ ...config, content: [{ raw: selector + ' bg-surface/70 text-accent bg-primary hover:bg-primary-hover text-on-primary shadow-app-card' }] })]).process(css, { from: undefined });
  for (const variable of ["surface", "content-muted", "primary", "on-primary", "focus"]) assert.ok(result.css.includes(`var(--${variable})`));
  assert.match(result.css, /rgb\(var\(--surface\) \/ 0\.7\)/);
  assert.equal(result.css.includes("light-dark("), false); assert.equal(result.css.includes("color-mix("), false);
});


test("appearance is configured inside personal and band settings routes", () => {
  const personal = fs.readFileSync(path.join(root, "src/app/dashboard/[section]/page.tsx"), "utf8");
  const band = fs.readFileSync(path.join(root, "src/app/bandas/[bandId]/perfil-publico/page.tsx"), "utf8");
  assert.match(personal, /section === "configuracoes"[\s\S]*ThemeSelector/);
  assert.match(band, /ThemeSelector/);
  for (const file of ["src/app/page.tsx", "src/app/login/page.tsx", "src/app/cadastro/page.tsx", "src/app/descobrir/page.tsx", "src/app/b/[slug]/layout.tsx", "src/components/band-navigation.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /ThemeSelector|Aparência/, file);
  }
});

test("login form retains mobile sizing, accessible fields, errors and busy state", () => {
  const values = ["musico@example.com", "secret", "Falha de teste", true, false];
  let index = 0;
  const hooks = { ...React, useState: () => [values[index++], () => {}], useRef: value => ({ current: value }), useEffect() {} };
  const loader = modules({}, hooks);
  const { ThemeProvider } = loader.load("src/components/theme-provider.tsx");
  const Login = loader.load("src/app/login/page.tsx").default;
  // Construct the page first so the provider's state does not consume form fixtures.
  const page = Login();
  const html = renderToStaticMarkup(React.createElement(ThemeProvider, null, page));
  for (const id of ["email", "password"]) {
    assert.ok(html.includes(`for="${id}"`));
    assert.match(html, new RegExp(`<input[^>]*id="${id}"[^>]*text-base md:text-sm`));
  }
  assert.match(html, /role="alert"[^>]*class="[^"]*text-danger/);
  assert.match(html, /<button[^>]*disabled=""/);
  assert.match(html, /Entrando/);
  assert.match(html, /motion-reduce:animate-none/);
});

test("tokens retain the approved light palette and generate Safari 15 compatible CSS", async () => {
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const ast = postcss.parse(css);
  const light = ast.nodes.find((node) => node.selector === ":root");
  const expected = { "content-label": "63 63 70", "content-faint": "109 109 119", brand: "91 33 182", "brand-highlight": "139 92 246", "input-focus": "139 92 246", "input-ring": "237 233 254", "nav-border": "237 233 254", "nav-dot": "212 212 216", "disabled-surface": "244 244 245" };
  for (const [token, value] of Object.entries(expected)) assert.equal(light.nodes.find((node) => node.prop === "--" + token)?.value, value);
  const config = modules().load("tailwind.config.ts").default;
  const sources = ["src/app/page.tsx", "src/app/login/page.tsx", "src/components/band-navigation.tsx"].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  const result = await postcss([tailwind({ ...config, content: [{ raw: sources + " bg-nav-dot bg-disabled-surface" }] })]).process(css, { from: undefined });
  for (const token of Object.keys(expected)) assert.ok(result.css.includes(`var(--${token})`), token);
  assert.match(result.css, /rgb\(var\(--primary\) \/ 0\.2\)/);
  assert.equal(/color-mix\(|light-dark\(|oklch\(/.test(result.css), false);
});



function renderWorkspace(file, states) {
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; return [i < states.length ? states[i] : initial, () => {}]; },
    useEffect() {},
    useRef(initial) { return { current: initial }; },
  };
  const loader = modules({ onboardingCompleted: file === "src/app/dashboard/page.tsx" }, hooks);
  const Page = loader.load(file).default;
  const page = Page();
  const { ThemeProvider } = loader.load("src/components/theme-provider.tsx");
  return renderToStaticMarkup(React.createElement(ThemeProvider, null, page));
}

test("dashboard themes cover loading, signed out, empty, populated and error states without Auth calls", () => {
  const file = "src/app/dashboard/page.tsx";
  const user = { id: "test-user", email: "test@example.com" };
  for (const [states, expected] of [
    [[null, [], true, "", null, null, "", null, "", 0], "Carregando seu espaço..."],
    [[null, [], false, "", null, null, "", null, "", 0], 'href="/login"'],
    [[user, [], false, "", [], 0, "", [], "", 0], 'href="/bandas/nova"'],
    [[user, [{ role: "admin", band: { id: "theme-band", name: "Theme Band" } }], false, "", [], 0, "", [], "", 0], 'href="/dashboard/bandas"'],
    [[null, [], false, "Load error", null, null, "", null, "", 0], 'role="alert"'],
  ]) {
    const html = renderWorkspace(file, states);
    assert.ok(html.includes(expected), expected);
    assert.match(html, /bg-surface/);
    assert.match(html, /rounded-panel/);
    assert.equal((html.match(/<select /g) ?? []).length, 0);
    assert.equal(/(?:bg-white|text-zinc-|text-violet-)/.test(html), false);
  }
});

test("overview has no secondary mobile header and preserves band identity and bottom navigation", () => {
  const name = "Band name preserved in content";
  const html = renderWorkspace("src/app/bandas/[bandId]/page.tsx", [
    { id: "theme-band", name, role: "member", description: "Description" },
    "ready", { tasks: null, event: null, members: null },
    { tasks: "loading", event: "loading", members: "loading" }, [], 0,
  ]);
  assert.doesNotMatch(html, /<header|Band<span/);
  assert.match(html, new RegExp(`<h1[^>]*>${name}</h1>`));
  assert.ok(html.includes("Visão geral"));
  assert.match(html, /fixed inset-x-0 bottom-0[^\"]*md:hidden/);
  for (const route of ["", "/tarefas", "/agenda", "/membros"]) {
    assert.ok(html.includes(`href="/bandas/theme-band${route}"`));
  }
});

test("overview themes cover all page states, summary states and admin/member controls", () => {
  const file = "src/app/bandas/[bandId]/page.tsx";
  for (const state of ["loading", "unauthenticated", "unavailable", "error"]) {
    const html = renderWorkspace(file, [null, state]);
    assert.ok(html.includes('href="/dashboard"'));
    assert.equal(/(?:bg-white|text-zinc-|text-violet-)/.test(html), false);
    assert.match(html, state === "error" ? /bg-danger-surface/ : /bg-surface/);
  }
  for (const role of ["admin", "member"]) {
    for (const state of ["loading", "error", "ready"]) {
      const band = { id: "theme-band", name: "Theme Band", description: "Description", slug: "theme-band", is_public: false, role };
      const summary = { tasks: { total: 3, pending: 2, completed: 1, overdue: 0 }, event: { title: "Rehearsal", event_type: "rehearsal", start_at: "2030-10-26T20:00:00Z", location: "Studio" }, members: 2 };
      const html = renderWorkspace(file, [band, "ready", summary, { tasks: state, event: state, members: state }, [], 0]);
      assert.equal(html.includes("<aside"), false);
      assert.equal((html.match(/<article /g) ?? []).length, 3);
      assert.equal((html.match(/<select /g) ?? []).length, 0);
      assert.equal(html.includes('role="switch"'), false);
      assert.equal(/(?:bg-white|text-zinc-|text-violet-)/.test(html), false);
      assert.equal(html.includes('id="public-profile-url"'), false);
      if (state === "ready") assert.ok(html.includes("Rehearsal") && html.includes("Studio"));
      if (state === "error") assert.match(html, /text-danger/);
    }
  }
});

test("workspace tokens preserve light colors and accessible dark text on panels and interactive surfaces", () => {
  const ast = postcss.parse(fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8"));
  function palette(selector) {
    const rule = ast.nodes.find((node) => node.selector === selector);
    return Object.fromEntries(rule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]));
  }
  const light = palette(":root"), dark = palette(':root[data-theme="dark"]');
  assert.equal(light["--accent-strong"], "124 58 237");
  assert.equal(light["--accent-outline-hover"], "196 181 253");
  assert.equal(light["--brand-hover"], "46 16 101");
  assert.equal(light["--warning-strong"], "120 53 15");
  assert.equal(light["--shadow-dashboard"], "0 20px 60px -32px rgba(54, 36, 104, 0.28)");
  const luminance = (channels) => channels.split(" ").map(Number).map((x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
  for (const surface of ["surface", "surface-muted", "accent-soft"]) {
    for (const text of ["content", "content-label", "content-muted", "content-subtle", "brand", "brand-hover", "accent", "accent-strong"]) {
      const a = luminance(dark["--" + surface]), b = luminance(dark["--" + text]);
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${text}/${surface}`);
    }
  }
});


function assertThemedPlanningPage(html) {
  assert.equal(/(?:bg-white|(?:text|border|bg|ring)-(?:zinc|violet|red|rose|emerald|amber|sky)-)/.test(html), false);
  assert.match(html, /bg-surface/);
}

test("task themes cover page states, empty lists, all badges, editing, disabled assignee and feedback", () => {
  const file = "src/app/bandas/[bandId]/tarefas/page.tsx";
  for (const state of ["loading", "unauthenticated", "unavailable", "error"]) {
    const html = renderWorkspace(file, [state, "Band", false, [], [], [], false, null, false, "Load error"]);
    assertThemedPlanningPage(html);
    if (state === "error") assert.match(html, /role="alert"/);
  }
  const tasks = ["todo", "in_progress", "done"].map((status, i) => ({ id: "task-" + i, title: "Task " + i, description: "Details https://example.com/task", status, priority: ["low", "medium", "high"][i], due_date: "2030-11-01", assigned_to: "test-user", event_id: "event-1", created_at: "2030-10-26T20:00:00Z", created_by: "author" }));
  const events = [{ id: "event-1", title: "Rehearsal", start_at: "2030-11-01T20:00:00Z" }];
  const members = [{ userId: "test-user", label: "Member" }];
  const empty = renderWorkspace(file, ["ready", "Band", false, [], events, members]);
  assertThemedPlanningPage(empty); assert.equal(empty.includes("<article"), false);
  for (const admin of [true, false]) {
    const html = renderWorkspace(file, ["ready", "Band", admin, tasks, events, members, true, "task-0", true, "", "Form error", "Saved", "Delete error", null, "Task", "Description", "todo", "medium", "2030-11-01", "test-user", "event-1", "test-user"]);
    assertThemedPlanningPage(html);
    assert.equal((html.match(/<article /g) ?? []).length, 3);
    for (const badge of ["bg-disabled-surface", "bg-warning-badge", "bg-success-badge", "bg-info-surface", "bg-accent-soft", "bg-danger-soft"]) assert.ok(html.includes(badge), badge);
    for (const tag of html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? []) {
      assert.match(tag, /bg-surface/);
      assert.match(tag, /text-base/);
    }
    assert.match(html, /<select[^>]*id="task-assignee"[^>]*disabled=""/);
    assert.match(html, /type="date"/);
    assert.match(html, /bg-danger-surface/); assert.match(html, /bg-success-surface/);
    assert.equal(html.includes("Excluir"), admin);
    assert.match(html, /href="https:\/\/example.com\/task"[^>]*[\s\S]*?text-accent/);
  }
});

test("agenda themes cover page states, empty lists, past and upcoming events, related tasks and custom type form", () => {
  const file = "src/app/bandas/[bandId]/agenda/page.tsx";
  const now = Date.parse("2030-10-26T12:00:00Z");
  for (const state of ["loading", "unauthenticated", "unavailable", "error"]) {
    const html = renderWorkspace(file, [state, now, "Band", false, [], {}, false, null, "", false, "Load error"]);
    assertThemedPlanningPage(html);
  }
  const events = ["2030-10-25T20:00:00Z", "2030-11-01T20:00:00Z"].map((start_at, i) => ({ id: "event-" + i, title: "Event " + i, description: "Details https://example.com/event", event_type: "rehearsal", start_at, end_at: "2030-11-02T01:00:00Z", location: "Studio", created_at: "2030-10-20T20:00:00Z", created_by: "test-user" }));
  const related = { "event-0": [{ id: "task-0", event_id: "event-0", title: "Related task", status: "in_progress", priority: "high" }] };
  const empty = renderWorkspace(file, ["ready", now, "Band", false, [], {}]);
  assertThemedPlanningPage(empty); assert.equal(empty.includes("<article"), false);
  for (const editing of [null, "event-1"]) {
    const html = renderWorkspace(file, ["ready", now, "Band", true, events, related, true, editing, "2030-10-26T10:00", true, "", "Form error", "Saved", "Delete error", null, "Event", "Description", "other", "Podcast", "2030-11-01T17:00", "2030-11-02T10:00", "Studio", "test-user"]);
    assertThemedPlanningPage(html);
    assert.equal((html.match(/<article /g) ?? []).length, 2);
    assert.match(html, /ring-input-ring/); assert.match(html, /bg-surface-muted/);
    assert.ok(html.includes("Related task")); assert.ok(html.includes("Podcast"));
    assert.match(html, /bg-danger-surface/); assert.match(html, /bg-success-surface/);
    const fields = html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [];
    for (const tag of fields) { assert.match(tag, /bg-surface/); assert.match(tag, /text-base/); }
    const start = fields.find((tag) => tag.includes('id="event-start"'));
    const end = fields.find((tag) => tag.includes('id="event-end"'));
    assert.match(start, /type="datetime-local"/); assert.match(end, /min="2030-11-01T17:00"/);
    assert.equal(start.includes('min="2030-10-26T10:00"'), editing === null);
    assert.ok(html.indexOf("Event 1") < html.indexOf("Event 0"), "upcoming events stay first");
  }
});

test("planning palette keeps the exact light badges and provides dark contrast and WebKit compatible utilities", async () => {
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const ast = postcss.parse(css);
  const palette = (selector) => Object.fromEntries(ast.nodes.find((node) => node.selector === selector).nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]));
  const light = palette(":root"), dark = palette(':root[data-theme="dark"]');
  const expected = { "content-strong": "39 39 42", "outline-subtle": "244 244 245", "warning-badge-bg": "254 243 199", "success-badge-bg": "209 250 229", "danger-soft-bg": "255 241 242", "danger-emphasis": "190 18 60" };
  for (const [key, value] of Object.entries(expected)) assert.equal(light["--" + key], value);
  assert.equal(light["--shadow-form"], "0 16px 48px -32px rgba(54, 36, 104, 0.35)");
  const luminance = (channels) => channels.split(" ").map(Number).map((x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
  for (const [text, bg] of [["warning-text", "warning-badge-bg"], ["success-text", "success-badge-bg"], ["danger-emphasis", "danger-soft-bg"], ["content-label", "disabled-surface"], ["content-label", "outline"], ["content-strong", "surface-muted"], ["info-text", "info-bg"], ["accent", "surface"]]) {
    const a = luminance(dark["--" + text]), b = luminance(dark["--" + bg]);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${text}/${bg}`);
  }
  const files = ["src/app/bandas/[bandId]/tarefas/page.tsx", "src/app/bandas/[bandId]/agenda/page.tsx", "src/components/linkified-text.tsx"];
  const config = modules().load("tailwind.config.ts").default;
  const result = await postcss([tailwind({ ...config, content: files.map((file) => ({ raw: fs.readFileSync(path.join(root, file), "utf8") })) })]).process(css, { from: undefined });
  assert.equal(/color-mix\(|light-dark\(|oklch\(/.test(result.css), false);
  // The divider token remains in the palette but is no longer used by these cards.
  for (const key of [...Object.keys(expected), "shadow-form"].filter((key) => key !== "outline-subtle")) assert.ok(result.css.includes(`var(--${key})`), key);
  assert.match(result.css, /rgb\(var\(--primary\) \/ 0\.15\)/);
});

test("description link variants use semantic colors while preserving safe URLs and light appearance", () => {
  const { LinkifiedText } = modules().load("src/components/linkified-text.tsx");
  const text = "Details https://example.com/notes.";
  const original = renderToStaticMarkup(React.createElement(LinkifiedText, { text }));
  const themed = renderToStaticMarkup(React.createElement(LinkifiedText, { text, variant: "themed" }));
  assert.match(original, /text-accent/); assert.match(themed, /text-accent/);
  for (const html of [original, themed]) {
    assert.match(html, /href="https:\/\/example.com\/notes"/);
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.ok(html.endsWith("</a>."));
  }
});


test("members themes cover loading, access failures, empty list and both member roles", () => {
  const file = "src/app/bandas/[bandId]/membros/page.tsx";
  for (const state of ["loading", "unauthenticated", "unavailable", "error", "ready"]) {
    const html = renderWorkspace(file, [state, "Band", []]);
    assertThemedPlanningPage(html);
    if (state === "error") assert.match(html, /role="alert"/);
  }
  const html = renderWorkspace(file, ["ready", "Band", [{ user_id: "one", role: "admin", label: "Admin" }, { user_id: "two", role: "member", label: "Member" }]]);
  assertThemedPlanningPage(html);
  assert.equal((html.match(/<article /g) ?? []).length, 2);
  assert.match(html, /bg-disabled-surface text-content-label|bg-disabled-surface[^\"]*text-content-label/);
  assert.ok(html.includes("Administrador") && html.includes("Membro"));
});

test("links themes preserve member/admin controls, publication states, custom fields and feedback", () => {
  const file = "src/app/bandas/[bandId]/links/page.tsx";
  for (const state of ["loading", "unauthenticated", "unavailable", "error", "ready"]) {
    const html = renderWorkspace(file, [state, "Band", "band", false, false, null, "", "", false, [], false, false, null, "Load error"]);
    assertThemedPlanningPage(html);
  }
  const links = [
    { id: "one", platform: "website", url: "https://example.com/band", is_public: true },
    { id: "two", platform: "other", url: "javascript:alert(1)", is_public: false },
  ];
  for (const admin of [true, false]) for (const isPublic of [true, false]) {
    const html = renderWorkspace(file, ["ready", "Band", "band", isPublic, true, "one", "Publication error", "Saved", admin, links, true, false, null, "", "Form error", "Delete error", "other", "SoundCloud", "https://example.com"]);
    assertThemedPlanningPage(html);
    assert.equal(html.includes('role="switch"'), admin);
    assert.equal(html.includes("<form"), admin);
    assert.equal(html.includes('id="custom-platform"'), admin);
    assert.equal((html.match(/<article /g) ?? []).length, 2);
    assert.match(html, /bg-danger-surface/);
    assert.match(html, /href="https:\/\/example.com\/band" target="_blank" rel="noopener noreferrer"/);
    assert.equal(html.includes('href="javascript:'), false);
    if (admin) {
      for (const tag of html.match(/<(?:input|select)\b[^>]*>/g) ?? []) {
        if (tag.includes('type="checkbox"')) { assert.match(tag, /accent-primary/); continue; }
        assert.match(tag, /bg-surface/); assert.match(tag, /text-base/);
      }
      assert.match(html, /aria-busy="true"/);
    }
  }
});

test("public profile and every public route state leave appearance controls to settings", () => {
  const loader = modules();
  const { ThemeProvider } = loader.load("src/components/theme-provider.tsx");
  const Layout = loader.load("src/app/b/[slug]/layout.tsx").default;
  const Profile = loader.load("src/components/public-band-profile.tsx").default;
  const band = { slug: "band", name: "Band", description: "Details https://example.com/about", image: null, links: [
    { id: "one", platform: "website", label: "Website", url: "https://example.com/band" },
    { id: "bad", platform: "other", label: "Unsafe", url: "javascript:alert(1)" },
  ] };
  const wrap = (child) => renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(Layout, null, child)));
  for (const links of [band.links, []]) {
    const html = wrap(React.createElement(Profile, { band: { ...band, links } }));
    assertThemedPlanningPage(html);
    assert.equal((html.match(/<select /g) ?? []).length, 0);
    assert.match(html, /from-decorative-start via-decorative-end/);
    assert.match(html, /bg-decorative-glow\/60/);
    assert.match(html, /border-surface bg-decorative-start/);
    assert.equal(html.includes('href="javascript:'), false);
    assert.match(html, /href="https:\/\/example.com\/about"/);
  }
  for (const name of ["loading", "not-found", "error"]) {
    const Component = loader.load(`src/app/b/[slug]/${name}.tsx`).default;
    const html = wrap(React.createElement(Component, { reset() {} }));
    assert.equal((html.match(/<select /g) ?? []).length, 0);
    assert.equal(/bg-white|text-zinc-|text-violet-/.test(html), false);
    if (name === "loading") assert.match(html, /role="status"/);
    if (name === "error") assert.match(html, /role="alert"/);
  }
});

test("public profiles never override visitor preferences, including automatic mode and reload", () => {
  const loader = modules();
  const Profile = loader.load("src/components/public-band-profile.tsx").default;
  const band = { slug: "band", name: "Band", description: "", image: null, links: [], appearance: "light", theme: "light" };
  for (const preference of ["light", "dark", "system"]) {
    const env = environment({ saved: preference, dark: true });
    let controller = api.createThemeController(env.browser, env.page);
    controller.setPreference(preference);
    const html = renderToStaticMarkup(React.createElement(Profile, { band }));
    assert.equal(/data-(?:theme|appearance)=/.test(html), false);
    assertAppearance(env, preference, preference === "light" ? "light" : "dark");
    controller.dispose();
    controller = api.createThemeController(env.browser, env.page);
    assert.equal(controller.getSnapshot().preference, preference);
    assertAppearance(env, preference, preference === "light" ? "light" : "dark");
    controller.dispose();
  }
});

test("public gradients, avatar and interaction utilities preserve light colors and support Safari 15", async () => {
  const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
  const ast = postcss.parse(css);
  const light = Object.fromEntries(ast.nodes.find((node) => node.selector === ":root").nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]));
  for (const [key, value] of Object.entries({ "decorative-start": "237 233 254", "decorative-end": "245 243 255", "decorative-glow": "250 232 255", "shadow-tint": "76 29 149" })) assert.equal(light["--" + key], value);
  const config = modules().load("tailwind.config.ts").default;
  const files = ["src/components/public-band-profile.tsx", "src/app/bandas/[bandId]/membros/page.tsx", "src/app/bandas/[bandId]/links/page.tsx"];
  const result = await postcss([tailwind({ ...config, content: files.map((file) => ({ raw: fs.readFileSync(path.join(root, file), "utf8") })) })]).process(css, { from: undefined });
  for (const token of ["decorative-start", "decorative-end", "decorative-glow", "shadow-tint", "surface", "primary", "content-strong", "accent-outline-hover"]) assert.ok(result.css.includes(`var(--${token})`), token);
  assert.match(result.css, /rgb\(var\(--surface\) \/ 0\.7\)/);
  assert.equal(/color-mix\(|light-dark\(|oklch\(/.test(result.css), false);
});


test("new band page uses semantic surfaces and fields in loading, signed out, ready, busy and error states", () => {
  const user = { id: "test-user" };
  for (const states of [
    [null, true, false, "", "", ""],
    [null, false, false, "", "", ""],
    [user, false, false, "Band", "Description", ""],
    [user, false, true, "Band", "Description", ""],
    [user, false, false, "Band", "Description", "Creation error"],
  ]) {
    const html = renderWorkspace("src/app/bandas/nova/page.tsx", states);
    assertThemedPlanningPage(html);
    assert.match(html, /shadow-app-dashboard/);
    assert.match(html, /href="\/dashboard"/);
    assert.equal(html.includes("<form"), !!states[0] && !states[1]);
    if (states[0] && !states[1]) {
      assert.match(html, /<input[^>]*id="band-name"[^>]*required=""[^>]*maxLength="100"/);
      assert.match(html, /<textarea[^>]*id="band-description"[^>]*rows="4"[^>]*maxLength="500"/);
      for (const tag of html.match(/<(?:input|textarea)\b[^>]*>/g) ?? []) {
        assert.match(tag, /bg-surface/); assert.match(tag, /text-base md:text-sm/);
        assert.match(tag, /focus:border-input-focus/);
      }
      assert.equal(/<button[^>]*disabled=""/.test(html), states[2]);
    }
    if (states[5]) { assert.match(html, /role="alert"/); assert.match(html, /bg-danger-surface/); }
  }
});

test("UI color audit permits fixed palette only in the approved login and signup artwork", () => {
  const fixed = /(?:[a-z-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|outline|decoration|accent|fill|stroke|shadow|from|via|to)-(?:white|black|(?:zinc|slate|gray|neutral|stone|violet|purple|indigo|fuchsia|red|rose|emerald|green|amber|yellow|sky|blue|pink|cyan|teal|orange|lime)-\d+)(?:\/\d+)?/g;
  const allowedLogin = new Set(["from-violet-700", "via-violet-800", "to-indigo-950", "text-white", "border-white/15", "focus:ring-violet-200", "text-violet-300", "text-violet-200", "text-violet-100/80", "text-violet-200/75"]);
  function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(filename) : filename.endsWith(".tsx") ? [filename] : [];
    });
  }
  for (const file of walk(path.join(root, "src"))) {
    const colors = fs.readFileSync(file, "utf8").match(fixed) ?? [];
    const authArtwork = ["src/app/login/page.tsx", "src/app/cadastro/page.tsx"].some(relative => file === path.join(root, relative));
    for (const color of colors) assert.ok(authArtwork && allowedLogin.has(color), `${path.relative(root, file)}: ${color}`);
  }
});


test("shared band layout reserves desktop space and retains a fixed sidebar across all internal sections", async () => {
  for (const section of ["", "tarefas", "agenda", "membros", "links", "perfil-publico"]) {
    const loader = modules({ testPathname: `/bandas/theme-band${section ? "/" + section : ""}` });
    const Layout = loader.load("src/app/bandas/[bandId]/layout.tsx").default;
    const { ThemeProvider } = loader.load("src/components/theme-provider.tsx");
    const tree = await Layout({ params: Promise.resolve({ bandId: "theme-band" }), children: React.createElement("main", null, "Page content") });
    assert.equal(tree.key, "theme-band");
    const html = renderToStaticMarkup(React.createElement(ThemeProvider, null, tree));
    assert.match(html, /md:pl-64 lg:pl-72/);
    assert.match(html, /<aside[^>]*fixed inset-y-0 left-0[^>]*hidden w-64[^>]*overflow-y-auto[^>]*md:flex lg:w-72/);
    assert.equal((html.match(/<aside /g) ?? []).length, 1);
    assert.ok(html.includes("Page content"));
    if (section === "links") {
      assert.equal(html.includes('aria-current="page"'), false);
      assert.equal(html.includes(`href="/bandas/theme-band/${section}"`), false);
      assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 12);
    } else if (section === "perfil-publico") {
      assert.match(html, /aria-current="page"[^>]*href="\/bandas\/theme-band\/perfil-publico"/);
      assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 12);
    } else {
      assert.match(html, new RegExp(`aria-current="page"[^>]*href="/bandas/theme-band${section ? "/" + section : ""}"`));
    }
    assert.equal((html.match(/<select /g) ?? []).length, 0);
  }
});

test("profile management exists only in the dedicated route with the original admin/member controls", () => {
  const profileFile = "src/app/bandas/[bandId]/perfil-publico/page.tsx";
  for (const state of ["loading", "unauthenticated", "unavailable", "error"]) {
    const html = renderWorkspace(profileFile, [state, null]);
    assertThemedPlanningPage(html);
    assert.equal(html.includes('id="public-profile-heading"'), false);
  }
  for (const admin of [true, false]) {
    const html = renderWorkspace(profileFile, ["ready", { name: "Band", slug: "band", is_public: true, role: admin ? "admin" : "member" }]);
    assertThemedPlanningPage(html);
    assert.equal((html.match(/id="public-profile-heading"/g) ?? []).length, 1);
    assert.equal(html.includes('role="switch"'), admin);
    assert.match(html, /id="public-profile-url"/);
    if (admin) assert.match(html, /href="\/bandas\/theme-band\/links">Gerenciar links<\/a>/);
    const links = renderWorkspace("src/app/bandas/[bandId]/links/page.tsx", ["ready", "Band", "band", true, false, null, "", "", admin, [], false, false, null, "", "", "", "instagram", "", ""]);
    assert.equal(links.includes('id="public-profile-heading"'), false);
  }
});

test("card details start collapsed, expose a native keyboard summary and keep description links safe", () => {
  const Details = modules().load("src/components/card-details.tsx").default;
  const html = renderToStaticMarkup(React.createElement(Details, { title: "Task", description: "Details https://example.com/notes" }, React.createElement("p", null, "Related task")));
  assert.match(html, /<details[^>]*data-card-details/);
  assert.equal(/<details[^>]*\sopen(?:=|\s|>)/.test(html), false);
  assert.match(html, /<summary[^>]*aria-label="Detalhes de Task"[^>]*min-h-11/);
  assert.match(html, /group-open:hidden/); assert.match(html, /group-open:inline/);
  assert.match(html, /href="https:\/\/example.com\/notes" target="_blank" rel="noopener noreferrer"/);
  assert.ok(html.includes("Related task"));
  assert.equal(renderToStaticMarkup(React.createElement(Details, { title: "Empty", description: "  " })), "");
  assert.match(renderToStaticMarkup(React.createElement(Details, { title: "Related only", description: null }, React.createElement("p", null, "Task"))), /<details/);
});

test("card clicks toggle independently and ignore actions, links, native summary and text selection", () => {
  const { toggleCardDetails } = modules().load("src/components/card-details.tsx");
  const one = { open: false }, two = { open: false };
  const event = (details, { protectedTarget = false, selected = false, defaultPrevented = false } = {}) => ({
    defaultPrevented,
    target: { closest(selector) {
      for (const token of ["a", "button", "input", "select", "textarea", "label", "summary", "[role='switch']"]) assert.ok(selector.includes(token));
      return protectedTarget ? {} : null;
    } },
    currentTarget: { querySelector: () => details, ownerDocument: { defaultView: { getSelection: () => ({ isCollapsed: !selected }) } } },
  });
  toggleCardDetails(event(one)); assert.equal(one.open, true); assert.equal(two.open, false);
  toggleCardDetails(event(two)); assert.equal(two.open, true);
  toggleCardDetails(event(one)); assert.equal(one.open, false); assert.equal(two.open, true);
  for (const flags of [{ protectedTarget: true }, { selected: true }, { defaultPrevented: true }]) {
    toggleCardDetails(event(one, flags)); assert.equal(one.open, false);
  }
  assert.doesNotThrow(() => toggleCardDetails(event(null)));
});


test("only band sidebar navigation includes disabled upcoming sections", () => {
  const loader = modules();
  const Navigation = loader.load("src/components/band-navigation.tsx").default;
  const { ThemeProvider } = loader.load("src/components/theme-provider.tsx");
  for (const variant of ["sidebar", "expandable"]) {
    const html = renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(Navigation, { bandId: "band", activeSection: "agenda", variant })));
    assert.match(html, /aria-current="page"[^>]*href="\/bandas\/band\/agenda"/);
    assert.equal(/href="\/bandas\/band\/(links|perfil-publico|loja|ingressos)"/.test(html), false);
    const sidebar = variant === "sidebar";
    assert.equal((html.match(/Em breve/g) ?? []).length, sidebar ? 4 : 0);
    assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, sidebar ? 4 : 0);
    for (const label of sidebar ? ["Perfil público", "Links", "Loja", "Ingressos"] : []) assert.ok(html.includes(label));

    assert.ok((html.match(/<svg /g) ?? []).length >= 4);
    for (const svg of html.match(/<svg[^>]*>/g)) {
      assert.match(svg, /aria-hidden="true"/); assert.match(svg, /focusable="false"/); assert.match(svg, /stroke="currentColor"/);
    }
    assert.match(html, variant === "sidebar" ? /bg-accent-soft text-brand/ : /bg-primary text-on-primary/);
  }
});

test("band bottom navigation contains only the four active destinations", () => {
  const loader = modules();
  const Navigation = loader.load("src/components/band-navigation.tsx").default;
  const { ThemeProvider } = loader.load("src/components/theme-provider.tsx");
  const html = renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(Navigation, { bandId: "band", activeSection: "agenda", variant: "bottom" })));
  assert.match(html, /aria-current="page"[^>]*href="\/bandas\/band\/agenda"/);
  for (const href of ["/bandas/band", "/bandas/band/tarefas", "/bandas/band/agenda", "/bandas/band/membros"]) {
    assert.equal((html.match(new RegExp(`href="${href}"`, "g")) ?? []).length, 1);
  }
  assert.equal((html.match(/aria-disabled="true"/g) ?? []).length, 0);
  assert.equal((html.match(/Em breve/g) ?? []).length, 0);
  assert.match(html, /fixed inset-x-0 bottom-0[^\"]*md:hidden/);
});

test("band settings menu shows upcoming band sections only in the mobile band menu", () => {
  const loader = modules();
  const { WorkspaceSettingsMenu } = loader.load("src/components/workspace-settings.tsx");
  const bandHtml = renderToStaticMarkup(React.createElement(WorkspaceSettingsMenu, {
    href: "/bandas/band/settings", showBandFeatures: true,
  }));
  const personalHtml = renderToStaticMarkup(React.createElement(WorkspaceSettingsMenu, {
    href: "/dashboard/configuracoes",
  }));
  assert.equal((bandHtml.match(/aria-disabled="true"/g) ?? []).length, 6);
  assert.equal((personalHtml.match(/aria-disabled="true"/g) ?? []).length, 2);
  assert.ok(bandHtml.includes("Notifica"));
  assert.ok(bandHtml.includes("Privacidade"));
  for (const label of ["Perfil público", "Links", "Loja", "Ingressos"]) {
    assert.ok(bandHtml.includes(label), `missing ${label} from band settings`);
    assert.equal(bandHtml.includes(`>${label}</a>`), false);
    assert.equal(personalHtml.includes(label), false);
    assert.equal(new RegExp(`<a[^>]*>[\\s\\S]*?${label}[\\s\\S]*?<\\/a>`).test(bandHtml), false);
  }
  assert.match(bandHtml, /max-h-\[calc\(100dvh-6rem\)\][^\"]*overflow-y-auto/);
  assert.equal(/tabindex=/i.test(bandHtml), false);
  assert.equal(/onclick=/i.test(bandHtml), false);
  assert.match(fs.readFileSync(path.join(root, "src/components/workspace-settings.tsx"), "utf8"), /showBandFeatures && bandComingSoonItems\.map\(item => <span key=\{item\.label\} aria-disabled="true"/);
});

function linksInteractionFixture(options = {}) {
  const record = { id: "link-one", platform: "SoundCloud", url: "https://example.com/old", is_public: true, created_at: "2030-01-01T00:00:00Z" };
  const states = ["ready", "Band", "band", true, false, null, "", "", options.admin !== false, [record], false, false, null, "", "", "", "instagram", "", "", null];
  const refs = [], calls = [], effects = [];
  let cursor = 0, refCursor = 0;
  const client = {
    auth: { getUser: async () => { calls.push("getUser"); return { data: { user: { id: "user" } } }; } },
    from(table) {
      calls.push(["from", table]);
      let values, operation;
      const query = {
        update(value) { operation = "update"; values = value; calls.push([operation, value]); return this; },
        insert(value) { operation = "insert"; values = value; calls.push([operation, value]); return this; },
        select() { return this; },
        eq(key, value) { calls.push(["eq", key, value]); return this; },
        async maybeSingle() {
          if (table === "band_members") return { data: { role: options.freshRole ?? "admin" } };
          if (options.writeFailure) return { data: null, error: { message: "denied" } };
          if (options.noWriteRow) return { data: null };
          return { data: { ...record, ...values, id: operation === "insert" ? "new-link" : record.id } };
        },
        async single() { return this.maybeSingle(); },
      };
      return query;
    },
  };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refCursor++; return refs[i] ??= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
  };
  const loader = modules({ supabaseMock: { getSupabaseBrowserClient: () => client } }, hooks);
  const Page = loader.load("src/app/bandas/[bandId]/links/page.tsx").default;
  return { calls, states, refs, effects, record, render() { cursor = refCursor = 0; effects.length = 0; return Page(); } };
}

function uiNodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => uiNodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...uiNodes(tree.props?.children, predicate)];
}

test("Links opens its form directly after the header and focuses it without a manual scroll", () => {
  const f = linksInteractionFixture();
  const initial = f.render();
  uiNodes(initial, (n) => n.type === "button" && n.props.children === "+ Adicionar link")[0].props.onClick();
  const tree = f.render();
  const form = uiNodes(tree, (n) => n.props?.id === "link-form")[0];
  const actions = [];
  form.props.ref.current = { focus: (value) => actions.push(["focus", value.preventScroll]), scrollIntoView: (value) => actions.push(["scroll", value.block, value.behavior]) };
  f.effects[0]();
  assert.deepEqual(actions, [["focus", true], ["scroll", "start", "auto"]]);
  assert.equal(form.props.tabIndex, -1);
  const children = tree.props.children.props.children.filter(Boolean);
  const header = children.findIndex((node) => node.type === "header");
  assert.equal(children[header + 1].props.id, "link-form");
  assert.equal(f.states[19], null);
});

test("link editing revalidates admin access, preserves publication and handles rejected or empty updates", async () => {
  for (const options of [{}, { freshRole: "member" }, { writeFailure: true }, { noWriteRow: true }]) {
    const f = linksInteractionFixture(options);
    uiNodes(f.render(), (n) => n.type === "button" && n.props.children === "Editar")[0].props.onClick();
    let tree = f.render();
    assert.equal(f.states[19], "link-one");
    assert.equal(f.states[16], "other"); assert.equal(f.states[17], "SoundCloud");
    assert.equal(uiNodes(tree, (n) => n.props?.type === "checkbox").length, 0);
    uiNodes(tree, (n) => n.props?.id === "link-url")[0].props.onChange({ target: { value: "https://example.com/new" } });
    tree = f.render();
    await uiNodes(tree, (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
    assert.ok(f.calls.includes("getUser"));
    if (options.freshRole) {
      assert.equal(f.calls.some((call) => call[0] === "update"), false);
      assert.ok(f.states[14]);
    } else {
      const update = f.calls.find((call) => call[0] === "update");
      assert.deepEqual(Object.keys(update[1]).sort(), ["platform", "url"]);
      assert.equal(update[1].url, "https://example.com/new");
      assert.ok(f.calls.some((call) => call[0] === "eq" && call[1] === "band_id" && call[2] === "theme-band"));
      if (options.writeFailure || options.noWriteRow) {
        assert.ok(f.states[14]); assert.equal(f.states[9][0].url, f.record.url);
      } else {
        assert.equal(f.states[9][0].url, "https://example.com/new");
        assert.equal(f.states[9][0].is_public, true); assert.equal(f.states[10], false);
      }
    }
  }
});

test("new links remain private and invalid URLs cannot reach the write operation", async () => {
  for (const url of ["javascript:alert(1)", "https://example.com/new"]) {
    const f = linksInteractionFixture();
    uiNodes(f.render(), (n) => n.type === "button" && n.props.children === "+ Adicionar link")[0].props.onClick();
    uiNodes(f.render(), (n) => n.props?.id === "link-url")[0].props.onChange({ target: { value: url } });
    await uiNodes(f.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
    const insert = f.calls.find((call) => call[0] === "insert");
    if (url.startsWith("https:")) { assert.equal(insert[1].is_public, false); assert.equal(f.states[9].length, 2); }
    else { assert.equal(insert, undefined); assert.ok(f.states[14]); }
  }
});


test("internal profile checks the visitor session and band membership before loading profile data", async () => {
  for (const scenario of ["anonymous", "not-member", "member", "admin", "session-error"]) {
    const states = [], effects = [], calls = [];
    let cursor = 0;
    const hooks = { ...React,
      useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
      useEffect(fn) { effects.push(fn); },
    };
    const client = {
      auth: { getSession: async () => ({ data: { session: scenario === "anonymous" ? null : { user: { id: "visitor" } } }, error: scenario === "session-error" ? new Error("unavailable") : null }) },
      from(table) {
        calls.push(table);
        return { select() { return this; }, eq() { return this; }, async maybeSingle() {
          return { data: table === "band_members" ? scenario === "not-member" ? null : { role: scenario === "admin" ? "admin" : "member" } : { name: "Band", slug: "band", is_public: true } };
        } };
      },
    };
    const loader = modules({ supabaseMock: { getSupabaseBrowserClient: () => client } }, hooks);
    const Page = loader.load("src/app/bandas/[bandId]/perfil-publico/page.tsx").default;
    Page(); effects[0](); await new Promise(setImmediate);
    if (scenario === "anonymous") { assert.equal(states[0], "unauthenticated"); assert.deepEqual(calls, []); }
    else if (scenario === "session-error") { assert.equal(states[0], "error"); assert.deepEqual(calls, []); }
    else if (scenario === "not-member") { assert.equal(states[0], "unavailable"); assert.deepEqual(calls, ["band_members"]); }
    else { assert.equal(states[0], "ready"); assert.equal(states[1].role, scenario); assert.deepEqual(calls, ["band_members", "bands"]); }
  }
});
