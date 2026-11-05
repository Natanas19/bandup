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
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, require(name) {
      if (name in overrides) return overrides[name];
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
      if (name === 'next/navigation') return { usePathname: () => '/meu-perfil/agenda', notFound: () => { throw Error('not-found'); } };
      if (name === '@/components/theme-selector') return { __esModule: true, default: () => React.createElement('span', null, 'Tema') };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient() { throw Error('No live access in tests'); } };
      if (name.startsWith('@/')) {
        const base = path.join('src', name.slice(2));
        return load([base + '.ts', base + '.tsx'].find(file => fs.existsSync(file)));
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

function overviewMarkup(data, error = '') {
  let cursor = 0;
  const values = [data, error, 0];
  const Page = loader({ react: { ...React, useState: () => [values[cursor++], () => {}], useEffect() {} } })('src/app/meu-perfil/page.tsx').default;
  return renderToStaticMarkup(Page());
}

test('overview shows genuine account summary and band workspace links; zero bands still has a profile', () => {
  const html = overviewMarkup({ name: 'Ana Silva', emailConfirmed: true, bands: [{ role: 'member', band: { id: 'b', name: 'Minha banda' } }] });
  for (const value of ['Ana Silva', 'E-mail confirmado', 'Minha banda', 'href="/bandas/b"', 'href="/dashboard"', 'Abrir workspace']) assert.ok(html.includes(value));
  assert.ok(html.includes('sm:grid-cols-2'));
  const empty = overviewMarkup({ name: null, emailConfirmed: true, bands: [] });
  assert.ok(empty.includes('Seu perfil pessoal já está disponível'));
  assert.ok(empty.includes('nome de exibição ainda não foi informado'));
  assert.equal(empty.includes('href="/bandas/'), false);
});

test('loading and errors never present fabricated counts or bands', () => {
  const loading = overviewMarkup(null);
  assert.ok(loading.includes('role="status"')); assert.equal(loading.includes('Bandas das quais participa'), false);
  const error = overviewMarkup(null, 'Falha ao carregar');
  for (const value of ['role="alert"', 'Tentar novamente', 'href="/login"']) assert.ok(error.includes(value));
  assert.equal(error.includes('Bandas das quais participa'), false);
});

test('sidebar includes all seven destinations, current section, existing icons and theme selector', () => {
  const { PersonalNavigation } = loader()('src/components/personal-workspace.tsx');
  const html = renderToStaticMarkup(React.createElement(PersonalNavigation, { sidebar: true }));
  for (const label of ['Visão geral', 'Tarefas', 'Agenda', 'Links', 'Perfil público', 'Configurações', 'Minhas bandas', 'Tema']) assert.ok(html.includes(label));
  assert.match(html, /href="\/meu-perfil\/agenda" aria-current="page"/);
  assert.ok(html.includes('href="/dashboard"'));
  assert.ok(html.includes('min-h-11')); assert.ok(html.includes('<svg'));
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test('mobile menu expands, closes on Escape or navigation and exposes accessible controls', () => {
  let open = false;
  const { PersonalNavigation } = loader({ react: { ...React,
    useState: () => [open, value => { open = typeof value === 'function' ? value(open) : value; }],
    useId: () => 'menu-id', useRef: () => ({ current: null }),
  } })('src/components/personal-workspace.tsx');
  const render = () => nodes(PersonalNavigation({}));
  let tree = render(); const button = tree.find(n => n.type === 'button');
  assert.equal(button.props['aria-controls'], 'menu-id'); assert.equal(button.props['aria-expanded'], false);
  button.props.onClick(); tree = render();
  assert.equal(tree.find(n => n.props?.id === 'menu-id').props.hidden, false);
  tree.find(n => n.type === 'nav').props.onKeyDown({ key: 'Escape', preventDefault() {} });
  assert.equal(open, false);
  button.props.onClick(); render().find(n => n.props?.href === '/dashboard').props.onClick();
  assert.equal(open, false);
});

test('unimplemented sections show coming soon only; unknown paths return not found', async () => {
  const Page = loader()('src/app/meu-perfil/[section]/page.tsx').default;
  for (const section of ['tarefas', 'agenda', 'links', 'perfil-publico', 'configuracoes']) {
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ section }) }));
    assert.ok(html.includes('Em breve')); assert.ok(html.includes('href="/meu-perfil"'));
    assert.equal(html.includes('<form'), false);
  }
  await assert.rejects(Page({ params: Promise.resolve({ section: 'qualquer' }) }), /not-found/);
});
