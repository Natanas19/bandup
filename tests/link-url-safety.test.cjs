/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");

// All backend calls are in-memory fixtures; no Auth, HTTP or database access.
function modules(client, react = React) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const localRequire = (id) => {
      if (id === "react") return react;
      if (id === "next/navigation") return { useParams: () => ({ bandId: "band" }) };
      if (id === "next/link") return { __esModule: true, default: (props) => React.createElement("a", props) };
      if (id === "next/image") return { __esModule: true, default: () => null };
      if (id === "@/components/band-navigation" || id === "@/components/band-workspace") return { __esModule: true, default: () => null, BandWorkspaceInfo: () => null };
      if (id === "@/lib/supabase/client") return { getSupabaseBrowserClient() { assert.ok(client, "Unexpected backend call"); return client; } };
      if (id.startsWith("@/") || id.startsWith(".")) {
        const base = id.startsWith("@/") ? "src/" + id.slice(2) : path.join(path.dirname(file), id);
        const resolved = [base + ".ts", base + ".tsx"].find((name) => fs.existsSync(path.join(root, name)));
        assert.ok(resolved, id); return load(resolved);
      }
      return require(id);
    };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: localRequire, URL, process: { env: { NODE_ENV: "test", NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED: "true" } } }, { filename: file });
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

const unsafe = ["https://user:secret@example.com", "https://user@example.com", "http://:secret@example.com", "https://u%73er:p%40ss@example.com", "javascript:alert(1)", "data:text/html,test", "file:///tmp/a", "ftp://example.com", "//example.com", "https:example.com", "https:/example.com", "", "not a URL", "https://", "https://exam\nple.com", "\thttps://example.com", "https://example.com\r", "https://example.com/\u007f"];
const valid = ["https://example.com", "http://example.com/music?q=one#listen", "https://example.com/path%20name", "HTTPS://Example.COM/Path", "  https://example.com/path  "];
const api = modules().load("src/lib/social-links.ts");

test("one URL rule rejects credentials, unsafe protocols, parser-repaired schemes and raw controls", () => {
  for (const value of unsafe) assert.equal(api.getSafeExternalUrl(value), null, JSON.stringify(value));
  for (const value of valid) assert.equal(api.getSafeExternalUrl(value), new URL(value.trim()).href);
});

function publicationFixture(options = {}) {
  const calls = [];
  const band = { id: "band", slug: "band", is_public: options.bandPublic ?? false };
  const links = (options.links ?? [{ id: "one", band_id: "band", url: "https://example.com", is_public: false }]).map((row) => ({ ...row }));
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
    from(table) {
      calls.push(["from", table]);
      let values = null; const filters = [];
      const run = (single) => {
        if (!values && options.readFailure === table) return { data: null, error: { message: "read failed" } };
        if (table === "band_members") return { data: { role: options.role ?? "admin" } };
        if (values && options.raceUrl && table === "social_links") links[0].url = options.raceUrl;
        const rows = (table === "bands" ? [band] : links).filter((row) => filters.every(([key, value]) => row[key] === value));
        if (values) rows.forEach((row) => Object.assign(row, values));
        return { data: single ? rows[0] ?? null : rows };
      };
      const query = {
        select(fields) { calls.push(["select", table, fields]); return this; },
        eq(key, value) { filters.push([key, value]); calls.push(["eq", table, key, value]); return this; },
        update(value) { values = value; calls.push(["update", table, value]); return this; },
        async maybeSingle() { return run(true); },
        then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject); },
      };
      return query;
    },
  };
  return { calls, links, band, api: modules(client).load("src/lib/band-publication.ts") };
}

test("shared publication validates the stored URL and rejects every unsafe selected link", async () => {
  for (const url of unsafe) {
    const f = publicationFixture({ links: [{ id: "one", band_id: "band", url, is_public: false }] });
    await assert.rejects(f.api.updateLinkPublication("band", "one", false, true), /URL insegura/);
    assert.equal(f.calls.some((call) => call[0] === "update"), false);
    assert.equal(f.links[0].is_public, false);
  }
});

test("valid publication preserves admin checks, band scope and URL snapshot; concurrent URL replacement fails", async () => {
  const f = publicationFixture();
  const result = await f.api.updateLinkPublication("band", "one", false, true);
  assert.equal(result.is_public, true);
  assert.ok(f.calls.some((call) => call[0] === "eq" && call[1] === "social_links" && call[2] === "url" && call[3] === "https://example.com"));
  const race = publicationFixture({ raceUrl: unsafe[0] });
  await assert.rejects(race.api.updateLinkPublication("band", "one", false, true));
  assert.equal(race.links[0].is_public, false);
  const denied = publicationFixture({ role: "member" });
  await assert.rejects(denied.api.updateLinkPublication("band", "one", false, true));
  assert.equal(denied.calls.some((call) => call[0] === "update"), false);
});

test("withdrawing a legacy unsafe link or the band stays possible", async () => {
  const f = publicationFixture({ bandPublic: true, links: [{ id: "one", band_id: "band", url: unsafe[0], is_public: true }] });
  assert.equal((await f.api.updateLinkPublication("band", "one", true, false)).is_public, false);
  assert.equal((await f.api.updateBandPublication("band", false)).is_public, false);
  assert.equal(f.calls.some((call) => call[0] === "select" && call[1] === "social_links" && call[2] === "url"), false);
});

test("band activation blocks unsafe legacy selections, ignores private links and fails closed on read errors", async () => {
  for (const url of unsafe) {
    const f = publicationFixture({ links: [{ id: "one", band_id: "band", url, is_public: true }] });
    await assert.rejects(f.api.updateBandPublication("band", true), /URL insegura/);
    assert.equal(f.calls.some((call) => call[0] === "update"), false);
  }
  const safe = publicationFixture({ links: [{ id: "one", band_id: "band", url: valid[1], is_public: true }, { id: "two", band_id: "band", url: unsafe[0], is_public: false }] });
  assert.equal((await safe.api.updateBandPublication("band", true)).is_public, true);
  const failed = publicationFixture({ readFailure: "social_links" });
  await assert.rejects(failed.api.updateBandPublication("band", true));
  assert.equal(failed.calls.some((call) => call[0] === "update"), false);
});

function pageFixture({ input = "", editing = false, records = [] } = {}) {
  const states = ["ready", "Band", "band", true, false, null, "", "", true, records, true, false, null, "", "", "", "website", "", input, editing ? "one" : null];
  const calls = [], refs = []; let cursor = 0, refCursor = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
    from(table) {
      let values;
      const query = {
        select() { return this; }, eq() { return this; },
        insert(value) { values = value; calls.push(["insert", value]); return this; },
        update(value) { values = value; calls.push(["update", value]); return this; },
        async maybeSingle() { return { data: table === "band_members" ? { role: "admin" } : { id: "one", is_public: true, ...values } }; },
        async single() { return this.maybeSingle(); },
      }; return query;
    },
  };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refCursor++; return refs[i] ??= { current: initial }; }, useEffect() {},
  };
  const Page = modules(client, hooks).load("src/app/bandas/[bandId]/links/page.tsx").default;
  return { states, calls, render() { cursor = refCursor = 0; return Page(); } };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((node) => nodes(node, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}

test("create and edit reject raw unsafe input before any write and preserve valid URL text", async () => {
  for (const editing of [false, true]) {
    for (const input of [...unsafe, ...valid]) {
      const f = pageFixture({ input, editing });
      if (!editing) f.states[4] = true;
      await nodes(f.render(), (n) => n.type === "form")[0].props.onSubmit({ preventDefault() {} });
      if (unsafe.includes(input)) { assert.equal(f.calls.length, 0); assert.ok(f.states[14]); }
      else { assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].url, input.trim()); }
    }
  }
});

test("legacy unsafe URLs are text only; unsafe publication is blocked while withdrawal remains enabled", () => {
  for (const is_public of [false, true]) {
    const records = [{ id: "one", platform: "website", url: unsafe[0], is_public }];
    const f = pageFixture({ records }); const tree = f.render();
    assert.equal(nodes(tree, (n) => n.type === "a" && n.props.href === unsafe[0]).length, 0);
    assert.ok(nodes(tree, (n) => n.type === "p" && n.props.children === unsafe[0]).length);
    const publication = nodes(tree, (n) => n.props?.role === "switch")[0];
    assert.equal(publication.props.disabled, !is_public);
    if (!is_public) { publication.props.onClick(); assert.ok(f.states[6]); assert.equal(f.calls.length, 0); }
  }
});

test("valid internal links keep their visible text, appearance and external-link attributes", () => {
  const url = "https://example.com/Path?q=music#listen";
  const tree = pageFixture({ records: [{ id: "one", platform: "website", url, is_public: false }] }).render();
  const link = nodes(tree, (n) => n.type === "a" && n.props.href === url)[0];
  assert.equal(link.props.children, url); assert.equal(link.props.target, "_blank");
  assert.equal(link.props.rel, "noopener noreferrer"); assert.ok(link.props.className.includes("text-content-strong"));
});

test("public projection and public component omit legacy unsafe links without leaking credentials", () => {
  const loader = modules();
  const transform = loader.load("src/lib/public-band-data.ts").toPublicBand;
  const Profile = loader.load("src/components/public-band-profile.tsx").default;
  const row = { name: "Band", slug: "band", description: "", logo_url: null, links: [...unsafe, ...valid].map((url) => ({ platform: "website", url })) };
  const band = transform(row, "band", "https://example.com");
  assert.equal(band.links.length, valid.length);
  assert.equal(JSON.stringify(band).includes("secret"), false);
  const html = renderToStaticMarkup(React.createElement(Profile, { band: { ...band, links: row.links.map((link, i) => ({ ...link, id: "link-" + i })) } }));
  assert.equal(html.includes("secret"), false); assert.equal(html.includes("javascript:"), false);
  assert.ok(html.includes('href="http://example.com/music?q=one#listen"'));
});
