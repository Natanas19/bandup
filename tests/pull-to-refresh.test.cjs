/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function load(file, globals = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, require, ...globals });
  return module.exports;
}

const { installPullToRefresh, usesServerRefresh } = load("src/lib/pull-to-refresh.ts");

function fixture(pathname = "/dashboard") {
  const listeners = new Map();
  const styles = new Set(), pulls = [];
  let updates = 0;
  const root = { classList: { add: name => styles.add(name), remove: name => styles.delete(name) } };
  const body = { parentElement: root };
  const doc = {
    documentElement: root, body, scrollingElement: { scrollTop: 0 }, activeElement: null,
    querySelector() { return null; },
    addEventListener(type, fn, options) { listeners.set(type, { fn, options }); },
    removeEventListener(type, fn) { if (listeners.get(type)?.fn === fn) listeners.delete(type); },
  };
  const browser = {
    scrollY: 0, navigator: { maxTouchPoints: 1 }, CSS: { supports: () => true },
    location: { pathname, href: "https://example.invalid" + pathname },
    getComputedStyle: node => ({ overflowY: node.overflowY ?? "visible" }),
  };
  const target = { parentElement: body, closest: () => null };
  const touch = (x, y) => ({ identifier: 1, clientX: x, clientY: y });
  function send(type, touches, options = {}) {
    let prevented = false;
    listeners.get(type)?.fn({
      touches, changedTouches: [], target, cancelable: true,
      preventDefault() { prevented = true; }, ...options,
    });
    return prevented;
  }
  const start = options => send("touchstart", [touch(0, 0)], options);
  const move = (x, y, options) => send("touchmove", [touch(x, y)], options);
  const end = (x, y) => send("touchend", [], { changedTouches: [touch(x, y)] });
  return { doc, browser, listeners, styles, pulls, target, start, move, end, send,
    install: () => installPullToRefresh(doc, browser, {
      isRefreshing: () => updates > 0,
      onPull: (distance, ready) => pulls.push([distance, ready]),
      onRefresh: () => { updates++; },
    }),
    updates: () => updates,
  };
}

test("an intentional top-only touch pull claims the gesture once and blocks a parallel refresh", () => {
  const f = fixture();
  const dispose = f.install();
  assert.ok(f.styles.has("overscroll-y-none"));
  assert.equal(f.listeners.get("touchmove").options.passive, false);
  f.start();
  assert.equal(f.move(0, 24), true);
  assert.equal(f.move(2, 90), true);
  assert.deepEqual(f.pulls, [[24, false], [90, true]]);
  assert.equal(f.updates(), 0);
  f.end(2, 90);
  f.start(); f.move(0, 90); f.end(0, 90);
  assert.deepEqual(f.pulls.at(-1), [0, false]);
  assert.equal(f.updates(), 1);
  dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.styles.size, 0);
});

test("short, sideways, upward, cancelled and noncancelable gestures do not refresh", () => {
  const f = fixture();
  f.install();
  for (const [x, y] of [[0, 35], [90, 90], [0, -90]]) {
    f.start(); f.move(x, y); f.end(x, y);
  }
  f.start(); f.move(0, 90, { cancelable: false }); f.end(0, 90);
  f.start(); f.move(0, 90); f.send("touchcancel", []); f.end(0, 90);
  f.start(); f.move(0, 90, { touches: [{ identifier: 1 }, { identifier: 2 }] }); f.end(0, 90);
  f.start(); f.move(0, 90); f.end(0, 35);
  assert.equal(f.updates(), 0);
});

test("nested scroll, form or menu touches, editing focus, dialogs and scrolled documents are excluded", () => {
  const f = fixture();
  f.install();
  function attempt(options) {
    f.start(options);
    assert.equal(f.move(0, 90), false);
    f.end(0, 90);
  }
  attempt({ target: { ...f.target, parentElement: { overflowY: "auto", parentElement: f.doc.body } } });
  for (const selector of ["form", "button", "[data-no-pull-refresh]"]) {
    attempt({ target: { ...f.target, closest: selectors => selectors.split(", ").includes(selector) ? {} : null } });
  }
  f.doc.activeElement = { closest: () => ({}) };
  attempt();
  f.doc.activeElement = null;
  f.doc.querySelector = () => ({});
  attempt();
  f.doc.querySelector = () => null;
  f.doc.scrollingElement.scrollTop = 40;
  attempt();
  assert.equal(f.updates(), 0);
});

test("desktop and browsers without overscroll control retain native behavior", () => {
  for (const [touches, supported] of [[0, true], [1, false]]) {
    const f = fixture();
    f.browser.navigator.maxTouchPoints = touches;
    f.browser.CSS.supports = () => supported;
    assert.equal(f.install(), undefined);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.styles.size, 0);
  }
});

test("the global control uses Next refresh for server profiles and document reload for client queries", () => {
  for (const pathname of ["/b/demo", "/dashboard", "/bandas/demo/perfil-publico", "/descobrir", "/login"]) {
    const f = fixture(pathname);
    const frames = [];
    const requests = [];
    f.browser.location.reload = () => requests.push("reload");
    let slots = [], index, effects, refreshCallback;
    let pending = false;
    const { default: PullToRefresh } = load("src/components/pull-to-refresh.tsx", {
      window: f.browser, document: f.doc,
      requestAnimationFrame: callback => frames.push(callback),
      require(name) {
        if (name === "@/lib/pull-to-refresh") return {
          usesServerRefresh,
          installPullToRefresh(doc, browser, callbacks) { refreshCallback = callbacks; },
        };
        if (name === "next/navigation") return { useRouter: () => ({ refresh: () => requests.push("server") }) };
        if (name === "react") return {
          useTransition: () => [pending, callback => { pending = true; callback(); }],
          useRef: value => slots[index++] ??= { current: value },
          useState(value) {
            const slot = index++;
            if (!(slot in slots)) slots[slot] = value;
            return [slots[slot], next => { slots[slot] = next; }];
          },
          useEffect: fn => effects.push(fn),
        };
        return require(name);
      },
    });
    function render() {
      index = 0; effects = [];
      PullToRefresh();
      effects.forEach(effect => effect());
    }
    render();
    refreshCallback.onRefresh();
    assert.equal(refreshCallback.isRefreshing(), true);
    render();
    while (frames.length) frames.shift()();
    assert.deepEqual(requests, [pathname === "/b/demo" ? "server" : "reload"]);
    if (pathname === "/b/demo") {
      assert.equal(refreshCallback.isRefreshing(), true);
      pending = false;
      render();
      assert.equal(refreshCallback.isRefreshing(), false);
    }
  }
});
