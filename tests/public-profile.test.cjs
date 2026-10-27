/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Exercise component handlers without a browser, network, or database writes.
function fixture(browser = {}, publication = {}) {
  const states = [], refs = [], effects = [];
  let cursor = 0, refCursor = 0, effectCursor = 0;
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) {
      const index = refCursor++;
      return refs[index] ??= { current: initial };
    },
    useEffect(effect) {
      const index = effectCursor++;
      if (!effects[index]) { effects[index] = true; effect(); }
    },
  };
  const memo = new Map();
  function load(relative) {
    const filename = path.resolve(__dirname, "..", relative);
    if (memo.has(filename)) return memo.get(filename).exports;
    const loadedModule = { exports: {} };
    memo.set(filename, loadedModule);
    const requireLocal = (name) => {
      if (name === "react") return hooks;
      if (name === "next/image") return { __esModule: true, default: ({ priority, unoptimized, ...props }) => {
        void priority; void unoptimized;
        return React.createElement("img", props);
      } };
      if (name === "next/link") return { __esModule: true, default: (props) => React.createElement("a", props) };
      if (name === "@/lib/band-publication") return {
        BandPublicationError: Error,
        getPublicProfilePath: (slug) => slug ? `/b/${encodeURIComponent(slug)}` : null,
        updateBandPublication: async () => { throw new Error("Unexpected write"); },
        ...publication,
      };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.resolve(__dirname, "../src", name.slice(2)) : path.resolve(path.dirname(filename), name);
        const file = [base + ".ts", base + ".tsx"].find(fs.existsSync);
        return load(path.relative(path.resolve(__dirname, ".."), file));
      }
      return require(name);
    };
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
    }).outputText;
    vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: requireLocal, URL, Error,
      navigator: browser, window: { location: { origin: "http://192.168.0.6:3002" } },
    }, { filename });
    return loadedModule.exports;
  }
  return { load, refs, render(component, props) { cursor = refCursor = effectCursor = 0; return component(props); } };
}

function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const button = (tree, text) => nodes(tree, (n) => n.type === "button" && n.props.children === text)[0];
const band = { slug: "banda", name: "Nome".repeat(100), description: "  ", image: null, links: [] };

test("public profile preserves long names, omits empty description and handles zero safe links", () => {
  const f = fixture();
  const Profile = f.load("src/components/public-band-profile.tsx").default;
  const tree = f.render(Profile, { band: { ...band, links: [{ id: "bad", platform: "other", url: "javascript:alert(1)" }] } });
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes(band.name));
  assert.ok(html.includes("overflow-wrap:anywhere"));
  assert.ok(html.includes("Ainda não há links públicos"));
  assert.equal(html.includes("nova aba"), false);
  assert.equal(html.includes("Em breve"), false);
  assert.equal(html.includes("<a "), false);
  assert.equal(nodes(tree, (n) => n.type === "p" && n.props.className.includes("whitespace-pre-wrap")).length, 0);
});

test("image failure falls back to initial and a new image can load", () => {
  const f = fixture();
  const Profile = f.load("src/components/public-band-profile.tsx").default;
  const withImage = { ...band, image: { src: "http://192.168.0.6:55321/storage/v1/object/public/a.png", alt: "Logo" } };
  let tree = f.render(Profile, { band: withImage });
  const image = nodes(tree, (n) => typeof n.props?.onError === "function")[0];
  assert.ok(image);
  image.props.onError();
  tree = f.render(Profile, { band: withImage });
  assert.equal(nodes(tree, (n) => n.props?.role === "img")[0].props.children, "N");
  tree = f.render(Profile, { band: { ...withImage, image: { src: "/new.png", alt: "Nova logo" } } });
  assert.equal(nodes(tree, (n) => typeof n.props?.onError === "function").length, 1);
});

test("custom titles render escaped with consistent icons and safe outbound links", () => {
  const f = fixture();
  const Profile = f.load("src/components/public-band-profile.tsx").default;
  const html = renderToStaticMarkup(f.render(Profile, { band: { ...band, description: "Descrição",
    links: [{ id: "1", platform: "other", label: "SoundCloud <live>", url: "https://soundcloud.com/band" }] } }));
  assert.ok(html.includes("SoundCloud &lt;live&gt;"));
  assert.ok(html.includes("<svg"));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test("sharing supports native success, cancellation, missing APIs and failures", async () => {
  const { shareProfileAddress, copyProfileAddress } = fixture().load("src/lib/profile-sharing.ts");
  const url = "http://192.168.0.6:3002/b/banda";
  const copied = [], shared = [];
  const clipboard = { writeText: async (value) => { copied.push(value); } };
  assert.equal(await shareProfileAddress(url, { clipboard, share: async (data) => { shared.push(data.url); } }), "shared");
  assert.deepEqual(shared, [url]);
  assert.equal(copied.length, 0);
  assert.equal(await shareProfileAddress(url, { clipboard }), "copied");
  assert.equal(await shareProfileAddress(url, { clipboard, share: async () => { throw new Error("denied"); } }), "copied");
  assert.equal(await shareProfileAddress(url, {}), "manual");
  assert.equal(await copyProfileAddress(url, { clipboard: { writeText: async () => { throw new Error("denied"); } } }), "manual");
  const cancelled = new Error("cancel"); cancelled.name = "AbortError";
  const count = copied.length;
  assert.equal(await shareProfileAddress(url, { clipboard, share: async () => { throw cancelled; } }), "cancelled");
  assert.equal(copied.length, count);
  assert.equal(await shareProfileAddress("", { clipboard }), "manual");
});

test("settings select the full address for manual copying when APIs are unavailable", async () => {
  const f = fixture();
  const Settings = f.load("src/components/band-public-profile-settings.tsx").default;
  const props = { bandId: "1", initialSlug: "banda", initiallyPublic: true, isAdmin: true };
  f.render(Settings, props);
  const tree = f.render(Settings, props);
  const input = nodes(tree, (n) => n.type === "input")[0];
  const actions = [];
  input.props.ref.current = { focus: () => actions.push("focus"), select: () => actions.push("select"),
    setSelectionRange: (start, end) => actions.push([start, end]) };
  await button(tree, "Compartilhar").props.onClick();
  // React onClick intentionally returns void; allow the async handler to settle.
  await new Promise(setImmediate);
  assert.deepEqual(actions, ["focus", "select", [0, input.props.value.length]]);
  const html = renderToStaticMarkup(f.render(Settings, props));
  assert.ok(html.includes("use Copiar no menu do navegador"));
  assert.ok(input.props.className.includes("text-base"));
});

test("sharing does not publish a private profile; publication still confirms or reports failure", async () => {
  let writes = 0;
  const f = fixture({}, { updateBandPublication: async (id, next) => { writes++; return { id, slug: "banda", is_public: next }; } });
  const Settings = f.load("src/components/band-public-profile-settings.tsx").default;
  const props = { bandId: "1", initialSlug: "banda", initiallyPublic: false, isAdmin: true };
  f.render(Settings, props);
  let tree = f.render(Settings, props);
  assert.equal(button(tree, "Compartilhar"), undefined);
  await button(tree, "Copiar endereço").props.onClick();
  await new Promise(setImmediate);
  assert.equal(writes, 0);
  await nodes(f.render(Settings, props), (n) => n.props?.role === "switch")[0].props.onClick();
  await new Promise(setImmediate);
  tree = f.render(Settings, props);
  assert.equal(writes, 1);
  assert.equal(nodes(tree, (n) => n.props?.role === "switch")[0].props["aria-checked"], true);
  assert.ok(button(tree, "Compartilhar"));
  const failed = fixture({}, { updateBandPublication: async () => { throw new Error("Falha confirmada"); } });
  const FailedSettings = failed.load("src/components/band-public-profile-settings.tsx").default;
  failed.render(FailedSettings, props);
  await nodes(failed.render(FailedSettings, props), (n) => n.props?.role === "switch")[0].props.onClick();
  await new Promise(setImmediate);
  const failedTree = failed.render(FailedSettings, props);
  assert.equal(nodes(failedTree, (n) => n.props?.role === "switch")[0].props["aria-checked"], false);
  assert.ok(renderToStaticMarkup(failedTree).includes("Falha confirmada"));
});

test("pending sharing prevents duplicate requests and publication changes", async () => {
  let complete, shares = 0, writes = 0;
  const f = fixture({ share: () => { shares++; return new Promise((resolve) => { complete = resolve; }); } },
    { updateBandPublication: async () => { writes++; } });
  const Settings = f.load("src/components/band-public-profile-settings.tsx").default;
  const props = { bandId: "1", initialSlug: "banda", initiallyPublic: true, isAdmin: true };
  f.render(Settings, props);
  const tree = f.render(Settings, props);
  button(tree, "Compartilhar").props.onClick();
  button(tree, "Compartilhar").props.onClick();
  nodes(tree, (n) => n.props?.role === "switch")[0].props.onClick();
  assert.equal(shares, 1);
  assert.equal(writes, 0);
  assert.equal(button(f.render(Settings, props), "Copiar endereço").props.disabled, true);
  complete();
  await new Promise(setImmediate);
  assert.equal(button(f.render(Settings, props), "Copiar endereço").props.disabled, false);
});

test("members cannot toggle publication and invalid addresses cannot be shared", () => {
  const props = { bandId: "1", initialSlug: "banda", initiallyPublic: true, isAdmin: false };
  const member = fixture();
  const Settings = member.load("src/components/band-public-profile-settings.tsx").default;
  assert.equal(nodes(member.render(Settings, props), (n) => n.props?.role === "switch").length, 0);
  const invalid = fixture();
  const InvalidSettings = invalid.load("src/components/band-public-profile-settings.tsx").default;
  const tree = invalid.render(InvalidSettings, { ...props, initialSlug: null, initiallyPublic: false, isAdmin: true });
  assert.equal(nodes(tree, (n) => n.props?.role === "switch")[0].props.disabled, true);
  assert.equal(button(tree, "Copiar endereço"), undefined);
  assert.equal(button(tree, "Compartilhar"), undefined);
});


test("publication notifies the Links page only after confirmation and preserves the management anchor", async () => {
  for (const fail of [false, true]) {
    const notifications = [];
    const f = fixture({}, { updateBandPublication: async (id, next) => {
      if (fail) throw new Error("Publication failed");
      return { id, slug: "confirmed-band", is_public: next };
    } });
    const Settings = f.load("src/components/band-public-profile-settings.tsx").default;
    const props = { bandId: "1", initialSlug: "band", initiallyPublic: false, isAdmin: true,
      linksHref: "#band-links", onPublicationChange: (value) => notifications.push(value) };
    f.render(Settings, props);
    const tree = f.render(Settings, props);
    nodes(tree, (n) => n.props?.role === "switch")[0].props.onClick();
    await new Promise(setImmediate);
    const updated = f.render(Settings, props);
    assert.equal(notifications.length, fail ? 0 : 1);
    if (!fail) {
      assert.equal(notifications[0].is_public, true);
      assert.equal(notifications[0].slug, "confirmed-band");
    }
    assert.ok(renderToStaticMarkup(updated).includes('href="#band-links"'));
    assert.equal(nodes(updated, (n) => n.props?.role === "switch")[0].props["aria-checked"], !fail);
  }
});
