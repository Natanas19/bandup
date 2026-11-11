/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');

function fixture(pathname = '/dashboard/agenda') {
  let open = false, focused = 0;
  const pushed = [], refs = [];
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, require(name) {
      if (name === 'react') return { ...React,
        useState: initial => [typeof initial === 'boolean' ? open : initial, value => { open = typeof value === 'function' ? value(open) : value; }],
        useEffect() {},
        useId: () => 'area-menu', useRef: () => {
          const ref = { current: { open: true, focus() { focused++; } } };
          refs.push(ref);
          return ref;
        },
      };
      if (name === 'next/navigation') return { usePathname: () => pathname, useRouter: () => ({ push: value => pushed.push(value) }) };
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => ({}) };
      if (name === '@/lib/display-name') return { normalizeDisplayName: value => typeof value === 'string' && value.trim() ? value.trim() : null };
      if (name === '@/lib/development-lab') return { isLaboratoryHttpOrigin: origin => origin === 'http://192.168.0.6:55321' };
      if (name === '@/lib/public-band-data') return { safeBandLogo: value => value };
      throw Error('Unexpected dependency: ' + name);
    } });
    return mod.exports;
  }
  return { load, focused: () => focused, pushed, refs };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

for (const variant of ['sidebar', 'bottom', 'expandable']) {
  test(`band ${variant} navigation contains only band workspace destinations`, () => {
    const Navigation = fixture().load('src/components/band-navigation.tsx').default;
    const tree = nodes(Navigation({ bandId: 'band-a', activeSection: 'agenda', variant }));
    const links = tree.filter(node => node.props?.href);
    for (const route of ['', '/tarefas', '/agenda', '/membros']) {
      assert.equal(links.filter(node => node.props.href === `/bandas/band-a${route}`).length, 1);
    }
    assert.equal(links.filter(node => node.props['aria-current'] === 'page').length, 1);
    assert.equal(links.find(node => node.props['aria-current'] === 'page').props.href, '/bandas/band-a/agenda');
    assert.equal(links.some(node => /meu-perfil|\/links|perfil-publico|configuracoes/.test(node.props.href)), false);
    const comingSoon = tree.filter(node => node.props?.['aria-disabled'] === 'true');
    assert.equal(comingSoon.length, variant === 'sidebar' ? 4 : 0);
    if (variant === 'sidebar') {
      assert.deepEqual(comingSoon.map(node => node.props.children[0].props.children[1]), [
        'Perfil público', 'Links', 'Loja', 'Ingressos',
      ]);
      assert.ok(comingSoon.every(node => node.props.href === undefined && node.props.onClick === undefined));
      assert.ok(comingSoon.every(node => JSON.stringify(node.props.children).includes('Em breve')));
    }
    assert.equal(tree.find(node => node.props?.id === 'area-menu').props.hidden, variant === 'expandable');
    if (variant === 'bottom') {
      const navigation = tree.find(node => node.type === 'nav');
      assert.match(navigation.props.className, /fixed inset-x-0 bottom-0/);
      assert.match(navigation.props.className, /safe-area-inset-bottom/);
      assert.match(tree.find(node => node.type === 'ul').props.className, /grid-cols-4/);
    }
  });
}

test('band mobile menu closes on Escape and restores trigger focus', () => {
  const f = fixture(), Navigation = f.load('src/components/band-navigation.tsx').default;
  const render = () => nodes(Navigation({ bandId: 'b', activeSection: 'overview', variant: 'expandable' }));
  const trigger = render().find(node => node.type === 'button');
  trigger.props.onClick();
  assert.equal(render().find(node => node.props?.id === 'area-menu').props.hidden, false);
  let prevented = false;
  render().find(node => node.type === 'nav').props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(render().find(node => node.type === 'button').props['aria-expanded'], false);
  assert.equal(f.focused(), 1);
});

test('band navigation keeps coming-soon destinations non-interactive in every variant', () => {
  for (const variant of ['sidebar', 'bottom', 'expandable']) {
    const Navigation = fixture().load('src/components/band-navigation.tsx').default;
    const tree = nodes(Navigation({ bandId: 'band-a', activeSection: 'agenda', variant }));
    const expectedLabels = variant === 'sidebar' ? ['Perfil público', 'Links', 'Loja', 'Ingressos'] : [];
    assert.equal(tree.filter(node => node.props?.href).length, 4);
    for (const label of expectedLabels) {
      const item = tree.find(node => node.props?.['aria-disabled'] === 'true'
        && JSON.stringify(node.props.children).includes(label));
      assert.ok(item, `${variant}: missing ${label}`);
      assert.equal(item.type, 'span');
      assert.equal(item.props.href, undefined);
      assert.equal(item.props.onClick, undefined);
      assert.equal(item.props.tabIndex, undefined);
      assert.match(JSON.stringify(item.props.children), /Em breve/);
    }
  }
});

test('personal navigation exposes overview, tasks, agenda and bands on desktop and mobile', () => {
  const expected = ['/dashboard', '/dashboard/tarefas', '/dashboard/agenda', '/dashboard/bandas'];
  for (const sidebar of [false, true]) {
    const Navigation = fixture().load('src/components/personal-workspace.tsx').PersonalNavigation;
    const tree = nodes(Navigation({ sidebar }));
    const links = tree.filter(node => node.props?.href);
    for (const href of expected) assert.equal(links.filter(node => node.props.href === href).length, 1);
    assert.equal(links.find(node => node.props['aria-current'] === 'page').props.href, '/dashboard/agenda');
    assert.equal(new Set(links.map(node => node.props.href)).size, links.length);
    const navigation = tree.find(node => node.type === 'nav');
    if (sidebar) assert.match(navigation.props.className, /hidden md:block/);
    else {
      assert.match(navigation.props.className, /fixed inset-x-0 bottom-0/);
      assert.match(navigation.props.className, /safe-area-inset-bottom/);
      assert.equal(navigation.props['aria-label'], 'Navegação inferior do Meu Painel');
    }
  }
});

test('space switcher is present in both responsive workspaces and offers creation and discovery', () => {
  const switcher = source('src/components/space-switcher.tsx');
  assert.match(switcher, /aria-label="Alternar espaço"/);
  assert.match(switcher, /Meus perfis/);
  assert.match(switcher, />Meu perfil</);
  assert.match(switcher, />Minhas bandas</);
  assert.doesNotMatch(switcher, /Alternar perfil/);
  assert.match(switcher, /ProfileAvatar name=\{selectedName\}/);
  assert.match(switcher, /band:bands!inner\(id, name, logo_url\)/);
  assert.match(switcher, /<summary aria-label=\{/);
  assert.match(switcher, /max-h-64 flex-initial space-y-1 overflow-y-auto overscroll-contain/);
  assert.match(switcher, /<NavigationIcon name="Plus"/);
  assert.match(switcher, /<NavigationIcon name="Search"/);
  assert.match(switcher, /w-full items-center justify-center gap-2[\s\S]*Criar banda/);
  assert.match(switcher, /w-full items-center justify-center gap-2[\s\S]*Procurar banda/);
  assert.match(switcher, /href="\/bandas\/nova"/);
  assert.match(switcher, /href="\/descobrir"/);
  for (const file of ['src/components/personal-workspace.tsx', 'src/components/band-workspace.tsx']) {
    assert.match(source(file), /<SpaceSwitcherHeader/);
  }
});

test('profile selector keeps its identity header for personal and band contexts', () => {
  const load = fixture().load, Switcher = load('src/components/space-switcher.tsx').default;
  const personal = nodes(Switcher({})), band = nodes(Switcher({ bandId: 'band-current', bandName: 'Kimera ao Kaos' }));
  for (const [tree, selected] of [[personal, 'Meu Espaço'], [band, 'Kimera ao Kaos']]) {
    const summary = tree.find(node => node.type === 'summary');
    assert.ok(summary.props['aria-label'].includes(`Perfil selecionado: ${selected}`));
    assert.ok(tree.some(node => node.props?.children === 'Meus perfis'));
  }
  assert.ok(band.some(node => node.props?.children === 'Kimera ao Kaos'));
  assert.ok(personal.some(node => node.props?.href === '/dashboard'));
  assert.ok(band.some(node => node.props?.children === 'Kimera ao Kaos'));
  assert.ok(band.some(node => node.props?.href === '/bandas/nova'));
  assert.ok(band.some(node => node.props?.href === '/descobrir'));
  assert.ok(band.some(node => node.props?.href === '/descobrir' && JSON.stringify(node.props.children).includes('Procurar banda')));
});

test('space switcher closes after choosing create band or discover band', () => {
  for (const [href, label] of [['/bandas/nova', 'Criar banda'], ['/descobrir', 'Procurar banda']]) {
    const f = fixture(), Switcher = f.load('src/components/space-switcher.tsx').default;
    const tree = nodes(Switcher({}));
    const link = tree.find(node => node.props?.href === href
      && JSON.stringify(node.props.children).includes(label));
    assert.ok(link, `missing ${label} link`);
    assert.equal(typeof link.props.onClick, 'function');
    assert.equal(f.refs[0].current.open, true);
    link.props.onClick();
    assert.equal(f.refs[0].current.open, false);
  }
});

test('personal routes and layouts remain mobile and desktop compatible', () => {
  const personal = source('src/components/personal-workspace.tsx');
  const band = source('src/components/band-workspace.tsx');
  assert.match(personal, /hidden w-64[\s\S]*md:flex/);
  assert.match(personal, /md:pl-64/);
  assert.match(band, /hidden w-64[\s\S]*md:flex/);
  assert.match(band, /md:pl-64/);
  assert.match(band, /pb-\[calc\(5rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(source('src/app/meu-perfil/page.tsx'), /redirect\("\/dashboard"\)/);
  assert.match(source('src/app/meu-perfil/[section]/page.tsx'), /redirect\(`\/dashboard/);
});

test('settings and account actions are grouped in both desktop sidebars', () => {
  const settings = source('src/components/workspace-settings.tsx');
  assert.match(settings, /Configurações/);
  assert.match(settings, /Notificações/);
  assert.match(settings, /Privacidade/);
  assert.match(settings, /Em breve/);
  assert.match(settings, /"Sair"/);
  for (const file of ['src/components/personal-workspace.tsx', 'src/components/band-workspace.tsx']) {
    assert.match(source(file), /<WorkspaceSettingsNavigation/);
  }
  const header = source('src/components/space-switcher.tsx');
  assert.match(header, /<WorkspaceSettingsMenu href=\{settingsHref\} showBandFeatures=\{!!bandId\}/);
  assert.match(header, /justify-between/);
  assert.match(header, /md:flex md:justify-end/);
  assert.doesNotMatch(header, /ThemeSelector/);
});

test('appearance control is available only within personal and band settings routes', () => {
  const personalSettings = source('src/app/dashboard/[section]/page.tsx');
  const bandSettings = source('src/app/bandas/[bandId]/perfil-publico/page.tsx');
  assert.match(personalSettings, /section === "configuracoes"[\s\S]*ThemeSelector/);
  assert.match(bandSettings, /ThemeSelector/);
  for (const file of ['src/app/page.tsx', 'src/app/login/page.tsx', 'src/app/cadastro/page.tsx', 'src/app/descobrir/page.tsx', 'src/app/b/[slug]/layout.tsx', 'src/components/band-navigation.tsx', 'src/components/personal-workspace.tsx', 'src/components/welcome-onboarding.tsx']) {
    assert.doesNotMatch(source(file), /ThemeSelector|Aparência/);
  }
});
