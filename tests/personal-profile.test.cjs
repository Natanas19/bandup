/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { test } = require('node:test');

function loader(overrides = {}) {
  const cache = new Map();
  function resolveFile(base) {
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
    return candidates.find(candidate => fs.existsSync(candidate));
  }
  function load(file) {
    const absoluteFile = path.resolve(file);
    if (cache.has(absoluteFile)) return cache.get(absoluteFile).exports;
    const mod = { exports: {} }; cache.set(absoluteFile, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(absoluteFile, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, require(name) {
      if (name in overrides) return overrides[name];
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
      if (name === 'next/navigation') return { usePathname: () => '/dashboard/agenda', notFound: () => { throw Error('not-found'); } };
      if (name === '@/components/theme-selector') return { __esModule: true, default: () => React.createElement('span', null, 'Aparência') };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient() { throw Error('No live access in tests'); } };
      if (name.startsWith('@/')) {
        const resolved = resolveFile(path.resolve('src', name.slice(2)));
        if (!resolved) throw Error(`Cannot resolve application import ${name}`);
        return load(resolved);
      }
      if (name.startsWith('./') || name.startsWith('../')) {
        const resolved = resolveFile(path.resolve(path.dirname(absoluteFile), name));
        if (!resolved) throw Error(`Cannot resolve relative import ${name} from ${absoluteFile}`);
        return load(resolved);
      }
      return require(name);
    } });
    return mod.exports;
  }
  return load;
}
function fixture(options = {}) {
  const calls = [];
  const client = {
    auth: { async getUser() { calls.push('auth'); return { data: { user: options.signedOut ? null : {
      id: options.userId ?? 'self', email_confirmed_at: 'date', user_metadata: { display_name: options.name ?? 'Ana Silva' },
    } }, error: options.authError }; } },
    from(table) {
      const call = { table }; calls.push(call);
      return { select(columns) { call.columns = columns; return this; }, async eq(key, value) {
        call.filter = [key, value];
        return { data: options.rows ?? [{ role: 'admin', band: { id: 'b', name: 'Minha banda' } }], error: options.queryError };
      } };
    },
  };
  return { client, calls };
}
const service = loader()('src/lib/personal-profile.ts');

test('personal overview reads only current account and own memberships, without email fallback or mutations', async () => {
  const f = fixture(); const data = await service.loadPersonalOverview(f.client);
  assert.equal(data.name, 'Ana Silva'); assert.equal(data.emailConfirmed, true);
  assert.equal(data.bands.length, 1);
  assert.equal(f.calls[0], 'auth');
  assert.equal(f.calls[1].table, 'band_members');
  assert.equal(f.calls[1].columns, 'role, band:bands!inner(id, name)');
  assert.equal(JSON.stringify(f.calls[1].filter), JSON.stringify(['user_id', 'self']));
  assert.equal((await service.loadPersonalOverview(fixture({ name: 'private@example.com', rows: [] }).client)).name, null);
});

test('missing authentication prevents membership reads and failures never expose service details', async () => {
  for (const options of [{ signedOut: true }, { authError: { message: 'secret' } }, { queryError: { message: 'secret' } }]) {
    const f = fixture(options);
    await assert.rejects(service.loadPersonalOverview(f.client), error => !error.message.includes('secret'));
    if (!options.queryError) assert.deepEqual(f.calls, ['auth']);
  }
});

test('different accounts always scope membership reads to their own verified identities', async () => {
  for (const userId of ['account-a', 'account-b']) {
    const f = fixture({ userId, rows: [] });
    const data = await service.loadPersonalOverview(f.client);
    assert.equal(data.bands.length, 0);
    assert.equal(JSON.stringify(f.calls[1].filter), JSON.stringify(['user_id', userId]));
  }
});

test('legacy profile route redirects into the single dashboard workspace', async () => {
  const legacy = loader({ 'next/navigation': { redirect: value => { throw Error(`redirect:${value}`); } } });
  const Page = legacy('src/app/meu-perfil/page.tsx').default;
  assert.throws(() => Page(), /redirect:\/dashboard/);
  const Section = legacy('src/app/meu-perfil/[section]/page.tsx').default;
  await assert.rejects(Section({ params: Promise.resolve({ section: 'tarefas' }) }), /redirect:\/dashboard\/tarefas/);
  await assert.rejects(Section({ params: Promise.resolve({ section: 'agenda' }) }), /redirect:\/dashboard\/agenda/);
});

test('sidebar navigation includes four contextual destinations without a separate appearance control', () => {
  const { PersonalNavigation } = loader()('src/components/personal-workspace.tsx');
  const html = renderToStaticMarkup(React.createElement(PersonalNavigation, { sidebar: true }));
  for (const label of ['Visão geral', 'Tarefas', 'Agenda', 'Minhas Bandas']) assert.ok(html.includes(label));
  assert.match(html, /href="\/dashboard\/agenda" aria-current="page"/);
  assert.ok(html.includes('href="/dashboard/bandas"'));
  assert.equal(html.includes('Aparência'), false);
  assert.ok(html.includes('min-h-11')); assert.ok(html.includes('<svg'));
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test('mobile personal navigation is a fixed four-tab bar without an expandable menu', () => {
  const { PersonalNavigation } = loader()('src/components/personal-workspace.tsx');
  const tree = nodes(PersonalNavigation({}));
  const navigation = tree.find(n => n.type === 'nav');
  assert.match(navigation.props.className, /fixed inset-x-0 bottom-0/);
  assert.match(navigation.props.className, /safe-area-inset-bottom/);
  assert.equal(navigation.props['aria-label'], 'Navegação inferior do Meu Painel');
  for (const href of ['/dashboard', '/dashboard/tarefas', '/dashboard/agenda', '/dashboard/bandas']) {
    assert.equal(tree.filter(n => n.props?.href === href).length, 1);
  }
  assert.equal(tree.some(n => n.type === 'button'), false);
});

test('dashboard section route keeps personal tasks and future sections', async () => {
  const load = loader(); const Page = load('src/app/dashboard/[section]/page.tsx').default;
  const tasks = await Page({ params: Promise.resolve({ section: 'tarefas' }) });
  assert.equal(tasks.type.name, 'PersonalTasks');
  const agenda = await Page({ params: Promise.resolve({ section: 'agenda' }) });
  assert.equal(agenda.type.name, 'PersonalAgenda');
  for (const section of ['links', 'perfil-publico']) {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ section }) }));
    assert.ok(html.includes('Em breve')); assert.ok(html.includes('href="/dashboard"'));
    assert.equal(html.includes('<form'), false);
  }
  const settings = renderToStaticMarkup(await Page({ params: Promise.resolve({ section: 'configuracoes' }) }));
  assert.ok(settings.includes('Preferências'));
  assert.ok(settings.includes('Aparência'));
  assert.ok(settings.includes('href="/dashboard"'));
  assert.equal(settings.includes('Em breve'), false);
  await assert.rejects(Page({ params: Promise.resolve({ section: 'qualquer' }) }), /not-found/);
});
