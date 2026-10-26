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
const origin = "https://example.supabase.co";
const row = (overrides = {}) => ({
  name: "Magijos", slug: "magijos", description: "Descrição",
  logo_url: null, links: [{ platform: "spotify", url: "https://open.spotify.com/artist/example" }],
  ...overrides,
});

// Compile in memory with installed TypeScript. Every network path is mocked.
function fixture({ data = row(), error = null, env = {}, transportThrows = false } = {}) {
  const calls = [];
  let clientOptions;
  const chain = {
    select(fields) { calls.push(["select", fields]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    abortSignal(signal) { calls.push(["signal", signal]); return this; },
    async maybeSingle() {
      if (transportThrows) throw new Error("PRIVATE backend payload");
      return { data, error };
    },
  };
  const memo = new Map();
  const fakeSupabase = {
    createClient(url, key, options) {
      calls.push(["client", url, key]);
      clientOptions = options;
      return { from(name) { calls.push(["from", name]); return chain; } };
    },
  };
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (memo.has(filename)) return memo.get(filename).exports;
    const loadedModule = { exports: {} };
    memo.set(filename, loadedModule);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 },
    }).outputText;
    const localRequire = (name) => {
      if (name === "server-only") return {};
      if (name === "@supabase/supabase-js") return fakeSupabase;
      if (name === "react") return { ...React, cache: (fn) => fn };
      if (name === "next/navigation") return { notFound() { throw new Error("NOT_FOUND"); } };
      if (name === "@/components/public-band-profile") return { __esModule: true, default: () => null };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(filename), name);
        const resolved = [base, base + ".ts", base + ".tsx"].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
        return load(path.relative(root, resolved));
      }
      return require(name);
    };
    vm.runInNewContext(code, {
      module: loadedModule, exports: loadedModule.exports, require: localRequire,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", ...env } },
      Buffer, URL, AbortController, setTimeout, clearTimeout,
      fetch: async (input, init) => {
        calls.push(["fetch", input, init]);
        return { mocked: true };
      },
    }, { filename });
    return loadedModule.exports;
  }
  return { load, calls, get options() { return clientOptions; } };
}

test("projects public fields and discards unexpected internal fields", async () => {
  const f = fixture({ data: row({ members: ["PRIVATE"], secret: "PRIVATE" }) });
  const band = await f.load("src/lib/public-bands.ts").getPublicBandBySlug("magijos");
  assert.deepEqual(Object.keys(band).sort(), ["description", "image", "links", "name", "slug"]);
  assert.equal(JSON.stringify(band).includes("PRIVATE"), false);
  assert.equal(band.links[0].platform, "spotify");
});

test("queries only the public view by slug with explicit projection and timeout", async () => {
  const f = fixture();
  await f.load("src/lib/public-bands.ts").getPublicBandBySlug("magijos");
  assert.deepEqual(f.calls.find((c) => c[0] === "from"), ["from", "public_band_profiles"]);
  assert.deepEqual(f.calls.find((c) => c[0] === "select"), ["select", "name,slug,description,logo_url,links"]);
  assert.deepEqual(f.calls.find((c) => c[0] === "eq"), ["eq", "slug", "magijos"]);
  assert.ok(f.calls.find((c) => c[0] === "signal")[1] instanceof AbortSignal);
  assert.equal(f.options.auth.persistSession, false);
  assert.equal(f.options.auth.autoRefreshToken, false);
  assert.equal(f.options.auth.detectSessionInUrl, false);
  await f.options.global.fetch("mock://view", { cache: "force-cache" });
  assert.equal(f.calls.find((c) => c[0] === "fetch")[2].cache, "no-store");
});

test("absent and private profiles both map to null; no fallback query", async () => {
  for (const scenario of ["absent", "private"]) {
    const f = fixture({ data: null });
    assert.equal(await f.load("src/lib/public-bands.ts").getPublicBandBySlug(scenario), null);
    assert.equal(f.calls.filter((c) => c[0] === "from").length, 1);
  }
});

test("invalid slugs do not query Supabase", async () => {
  const f = fixture();
  for (const slug of ["", "   ", "bad\u0000slug", "x".repeat(2049)]) {
    assert.equal(await f.load("src/lib/public-bands.ts").getPublicBandBySlug(slug), null);
  }
  assert.equal(f.calls.length, 0);
});

test("null fields and unknown platforms have safe fallbacks", async () => {
  const f = fixture({ data: row({ description: null, logo_url: null, links: [{ platform: "__proto__", url: "https://example.org" }] }) });
  const band = await f.load("src/lib/public-bands.ts").getPublicBandBySlug("magijos");
  assert.equal(band.description, "");
  assert.equal(band.image, null);
  assert.equal(band.links[0].platform, "other");
  assert.equal(band.links[0].id, "public-link-0");
});

test("unsafe links are omitted and malformed responses fail closed", async () => {
  const f = fixture({ data: row({ links: [
    { platform: "website", url: "javascript:alert(1)" },
    { platform: "website", url: "https://user:pass@example.org" },
  ] }) });
  const band = await f.load("src/lib/public-bands.ts").getPublicBandBySlug("magijos");
  assert.equal(band.links.length, 0);
  for (const value of [undefined, {}, row({ slug: "another-band" }), row({ links: {} }), row({ links: [null] })]) {
    const bad = fixture({ data: value });
    const transform = bad.load("src/lib/public-band-data.ts").toPublicBand;
    assert.throws(() => transform(value, "magijos", origin), /Não foi possível/);
  }
});

test("images require approved HTTPS origin and public storage path", () => {
  const transform = fixture().load("src/lib/public-band-data.ts").toPublicBand;
  for (const logo_url of [null, "javascript:alert(1)", "https://other.example/a.png", origin + "/private/a.png", origin + "/storage/v1/object/public/a.svg", origin + "/storage/v1/object/public/a.png?token=secret"]) {
    assert.equal(transform(row({ logo_url }), "magijos", origin).image, null);
  }
  const image = origin + "/storage/v1/object/public/bands/a.png";
  assert.equal(transform(row({ logo_url: image }), "magijos", origin).image.src, image);
});

test("custom platform names survive public projection and unsafe URLs remain omitted", () => {
  const transform = fixture().load("src/lib/public-band-data.ts").toPublicBand;
  const band = transform(row({ name: "B".repeat(400), description: null, links: [
    { platform: " SoundCloud ", url: "https://soundcloud.com/band" },
    { platform: "SoundCloud", url: "javascript:alert(1)" },
    { platform: "instagram", url: "https://instagram.com/band" },
  ] }), "magijos", origin);
  assert.equal(band.name.length, 400);
  assert.equal(band.description, "");
  assert.equal(band.links.length, 2);
  assert.equal(band.links[0].label, "SoundCloud");
  assert.equal(band.links[0].platform, "other");
  assert.equal(band.links[1].platform, "instagram");
});

test("query failures expose only a generic error", async () => {
  for (const config of [{ error: { message: "PRIVATE", code: "secret" } }, { transportThrows: true }]) {
    const f = fixture(config);
    await assert.rejects(f.load("src/lib/public-bands.ts").getPublicBandBySlug("magijos"),
      (e) => e.message === "Não foi possível carregar a página pública." && !e.cause);
  }
});

test("privileged keys and unsafe backend URLs are rejected before client creation", async () => {
  const jwt = (role) => "header." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".signature";
  for (const env of [
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@example.org" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://remote.example" },
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" },
  ]) {
    const f = fixture({ env });
    await assert.rejects(f.load("src/lib/public-bands.ts").getPublicBandBySlug("magijos"));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({ env: { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("anon") } });
  await f.load("src/lib/public-bands.ts").getPublicBandBySlug("magijos");
  assert.ok(f.calls.length > 0);
});

test("URL validation blocks unsafe protocols, credentials and control characters", () => {
  const { getSafeExternalUrl } = fixture().load("src/lib/social-links.ts");
  for (const value of ["javascript:alert(1)", "data:text/html,test", "//example.org", "https://a:b@example.org", "https://exam\nple.org"]) {
    assert.equal(getSafeExternalUrl(value), null);
  }
  assert.equal(getSafeExternalUrl("https://example.org"), "https://example.org/");
});

test("description links reuse URL safety and preserve escaped text", () => {
  const { LinkifiedText } = fixture().load("src/components/linkified-text.tsx");
  const markup = renderToStaticMarkup(React.createElement(LinkifiedText, {
    text: '<script>alert(1)</script> https://user:pass@example.org https://example.org/path).',
  }));
  assert.equal(markup.includes("<script>"), false);
  assert.equal((markup.match(/<a /g) || []).length, 1);
  assert.ok(markup.includes('rel="noopener noreferrer"'));
  assert.ok(markup.includes('href="https://example.org/path"'));
});

test("page and metadata handle absence, failure and publication without persistent cache", async () => {
  const props = { params: Promise.resolve({ slug: "magijos" }) };
  const page = fixture().load("src/app/b/[slug]/page.tsx");
  assert.equal(page.dynamic, "force-dynamic");
  assert.equal(page.revalidate, 0);
  assert.equal(page.fetchCache, "force-no-store");
  assert.equal((await page.generateMetadata(props)).title, "Magijos | BandUp");
  const absent = fixture({ data: null }).load("src/app/b/[slug]/page.tsx");
  await assert.rejects(absent.default(props), /NOT_FOUND/);
  assert.equal((await absent.generateMetadata(props)).title, "Página indisponível | BandUp");
  const failed = fixture({ error: { message: "PRIVATE" } }).load("src/app/b/[slug]/page.tsx");
  assert.equal(JSON.stringify(await failed.generateMetadata(props)).includes("PRIVATE"), false);
  await assert.rejects(failed.default(props), /Não foi possível/);
});

test("fresh reads reflect withdrawal instead of persisting published data", async () => {
  const first = await fixture().load("src/lib/public-bands.ts").getPublicBandBySlug("magijos");
  const withdrawn = await fixture({ data: null }).load("src/lib/public-bands.ts").getPublicBandBySlug("magijos");
  assert.ok(first);
  assert.equal(withdrawn, null);
});

test("text slugs are not restricted to lowercase ASCII or hyphens", async () => {
  const slug = "Banda_ São.Paulo";
  const f = fixture({ data: row({ slug }) });
  const band = await f.load("src/lib/public-bands.ts").getPublicBandBySlug(slug);
  assert.equal(band.slug, slug);
  assert.deepEqual(f.calls.find((c) => c[0] === "eq"), ["eq", "slug", slug]);
});

test("backend configuration paths are normalized like the existing browser client", async () => {
  const f = fixture({ env: { NEXT_PUBLIC_SUPABASE_URL: origin + "/rest/v1" } });
  await f.load("src/lib/public-bands.ts").getPublicBandBySlug("magijos");
  assert.equal(f.calls.find((c) => c[0] === "client")[1], origin);
});
