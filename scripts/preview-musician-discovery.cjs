/* eslint-disable @typescript-eslint/no-require-imports */
/* Standalone offline component harness. Does not run Next or read .env files. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.next', 'musician-visual');

async function prepare() {
  if (process.env.NODE_ENV === 'production') throw Error('Visual preview is disabled in production');
  fs.mkdirSync(output, { recursive: true });
  for (const [source, target] of [
    ['src/components/musician-discovery.tsx', 'generated-discovery.cjs'],
    ['src/components/profile-avatar.tsx', 'generated-avatar.cjs'],
  ]) fs.writeFileSync(path.join(output, target), ts.transpileModule(fs.readFileSync(path.join(root, source), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText);
  for (const file of ['musician-entry.cjs', 'musician-fixtures.cjs']) fs.copyFileSync(path.join(root, 'tests/visual', file), path.join(output, file));
  // Avatar never receives a photo in this harness. Fail if that contract changes.
  fs.writeFileSync(path.join(output, 'no-image.cjs'), 'module.exports = function () { throw Error("Unexpected image in offline preview"); };');
  const webpack = require('next/dist/compiled/webpack/webpack'); webpack.init();
  const stats = await new Promise((resolve, reject) => webpack.webpack({
    mode: 'development', devtool: false, context: root, entry: path.join(output, 'musician-entry.cjs'),
    output: { path: output, filename: 'preview.js' },
    resolve: { alias: {
      '@/components/profile-avatar': path.join(output, 'generated-avatar.cjs'),
      '@/lib/supabase/client': path.join(output, 'musician-fixtures.cjs'),
      '@/lib/musician-discovery': path.join(output, 'musician-fixtures.cjs'),
      'next/image': path.join(output, 'no-image.cjs'),
    } },
  }, (error, result) => error ? reject(error) : resolve(result)));
  if (stats.hasErrors()) throw Error(stats.toString({ all: false, errors: true }));
  const modules = JSON.stringify(stats.toJson({ all: false, modules: true }).modules);
  if (/supabase-js|supabase\\[/\\\\]client|src\\[/\\\\]lib/.test(modules)) throw Error('Unexpected application service in preview bundle');
  const postcss = require('postcss');
  const css = await postcss([require('tailwindcss')(path.join(root, 'tailwind.config.ts')), require('autoprefixer')])
    .process(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
  fs.writeFileSync(path.join(output, 'preview.css'), css.css);
  console.log('Preview bundle ready; no real service modules included.');
}
async function main() {
  await prepare();
  if (process.argv.includes('--check')) return;
  const port = 4317;
  const server = http.createServer((request, response) => {
    if (request.headers.host !== `127.0.0.1:${port}` || request.method !== 'GET') { response.writeHead(403); response.end(); return; }
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
    response.setHeader('Cache-Control', 'no-store');
    const files = { '/preview.js': ['preview.js', 'text/javascript'], '/preview.css': ['preview.css', 'text/css'] };
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia local · Descobrir músicos</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>');
    } else if (Object.hasOwn(files, request.url)) {
      const [file, type] = files[request.url]; response.setHeader('Content-Type', `${type}; charset=utf-8`); response.end(fs.readFileSync(path.join(output, file)));
    } else { response.writeHead(404); response.end(); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Open http://127.0.0.1:${port} — synthetic data only. Ctrl+C to stop.`));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare };
