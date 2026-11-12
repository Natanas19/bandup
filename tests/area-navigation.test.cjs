/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');

function fixture(pathname = '/dashboard/agenda', profileData = {}) {
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
        useState: initial => [Array.isArray(initial) ? profileData.bands ?? initial
          : initial?.name ? profileData.personal ?? initial : typeof initial === 'boolean' ? open : initial,
        value => { open = typeof value === 'function' ? value(open) : value; }],
        useEffect() {},
        useId: () => 'area-menu', useRef: () => {
          const ref = { current: { open: true, focus() { focused++; }, querySelector() { return { focus() { focused++; } }; } } };
          refs.push(ref);
          return ref;
        },
      };
      if (name === 'next/navigation') return { usePathname: () => pathname, useRouter: () => ({ push: value => pushed.push(value) }) };
      if (name === '@/components/workspace-settings') return { WorkspaceSettingsMenu: function SettingsMenu() {}, WorkspaceSettingsNavigation: () => null };
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
    assert.ok(nodes(summary).some(node => node.props?.children === 'Meus perfis'));
    assert.ok(tree.some(node => node.type === 'span' && node.props.children === selected && node.props.className.includes('truncate')));
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

test('restored selector keeps active photos and the disabled Profile action', () => {
  const personal = { name: 'Ana Silva', imageUrl: 'https://example.com/personal.png' };
  const name = 'Banda com nome muito longo '.repeat(12), photo = 'https://project.supabase.co/storage/v1/object/public/band-logos/photo.png';
  for (const bandId of [undefined, 'band-current']) {
    const f = fixture('/dashboard', { personal, bands: [{ band_id: 'band-current', band: { id: 'band-current', name, logo_url: photo } }] });
    const Switcher = f.load('src/components/space-switcher.tsx').default;
    const tree = nodes(Switcher({ bandId }));
    const summary = tree.find(n => n.type === 'summary');
    assert.match(tree[0].props.className, /sm:min-w-72/);
    const avatar = nodes(summary).find(n => n.props.name === (bandId ? name : personal.name));
    assert.equal(avatar.props.imageUrl, bandId ? photo : personal.imageUrl);
    assert.ok(nodes(summary).some(n => n.props.children === (bandId ? name : personal.name) && n.props.className.includes('truncate')));
    const profile = tree.find(n => n.props.children === 'Perfil');
    assert.equal(profile.props.href, bandId ? '/bandas/band-current/perfil' : '/dashboard/perfil');
    assert.equal(typeof profile.props.onClick, 'function');
    assert.equal(profile.props.disabled, undefined);
    const personalLink = tree.find(n => n.props.href === '/dashboard' && n.props['aria-current'] === (!bandId ? 'page' : undefined) && n.props.className.includes('min-h-12'));
    assert.ok(personalLink);
    assert.equal(nodes(personalLink).some(n => n.type === 'button' || n.props.children === 'Atual'), false);
    const bandLink = tree.find(n => n.props.href === '/bandas/band-current');
    assert.equal(bandLink.props['aria-current'], bandId ? 'page' : undefined);
    bandLink.props.onClick();
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

test('current profile leads the menu without duplicates as personal and band routes alternate', () => {
  const personal = { name: 'Ana', imageUrl: 'https://example.com/ana.png' };
  const bands = ['a', 'b'].map(id => ({ band_id: id, band: { id, name: `Band ${id}`, logo_url: `https://example.com/${id}.png` } }));
  const f = fixture('/dashboard', { personal, bands });
  const Switcher = f.load('src/components/space-switcher.tsx').default;
  for (const bandId of [undefined, 'b', 'a', undefined]) {
    const tree = nodes(Switcher({ bandId }));
    const details = tree.find(n => n.type === 'details');
    const menu = nodes(details.props.children[1]);
    const sections = menu.filter(n => n.type === 'section');
    assert.equal(sections[0].props['aria-labelledby'], 'current-profile-section');
    assert.equal(nodes(sections[0]).find(n => n.type === 'h2').props.children, 'Perfil atual');
    const current = nodes(sections[0]).find(n => n.props['aria-current'] === 'page');
    const expectedName = bandId ? `Band ${bandId}` : personal.name;
    const avatar = nodes(current).find(n => n.props.name === expectedName);
    assert.equal(avatar.props.imageUrl, bandId ? `https://example.com/${bandId}.png` : personal.imageUrl);
    const links = menu.filter(n => n.props.href && n.props.children !== 'Perfil' && !['/bandas/nova', '/descobrir'].includes(n.props.href));
    assert.deepEqual(links.map(n => n.props.href), bandId
      ? [`/bandas/${bandId}`, '/dashboard', `/bandas/${bandId === 'a' ? 'b' : 'a'}`]
      : ['/dashboard', '/bandas/a', '/bandas/b']);
    assert.equal(new Set(links.map(n => n.props.href)).size, 3);
    assert.equal(menu.filter(n => n.props['aria-current'] === 'page').length, 1);
    assert.equal(menu.filter(n => n.type === 'button').length, 0);
    const profile = nodes(sections[0]).find(n => n.props.children === 'Perfil');
    assert.equal(profile.props.children, 'Perfil');
    assert.equal(profile.props.disabled, undefined);
    assert.equal(profile.props.href, bandId ? `/bandas/${bandId}/perfil` : '/dashboard/perfil');
    assert.equal(menu.some(n => n.props.children === 'Atual'), false);
    const selector = f.refs.at(-1);
    selector.current.open = true;
    links[1].props.onClick();
    assert.equal(selector.current.open, false);
  }
});

test('personal profile alone and a loading band keep one current row and no empty band section', () => {
  const Switcher = fixture().load('src/components/space-switcher.tsx').default;
  for (const props of [{}, { bandId: 'loading', bandName: 'Loading band' }]) {
    const tree = nodes(Switcher(props));
    const menu = nodes(tree.find(n => n.type === 'details').props.children[1]);
    assert.equal(menu.filter(n => n.props['aria-current'] === 'page').length, 1);
    assert.equal(menu.filter(n => n.props.children === 'Perfil').length, 1);
    assert.equal(menu.some(n => n.props['aria-labelledby'] === 'band-profiles-section'), false);
    if (props.bandId) assert.ok(menu.some(n => n.props.href === '/bandas/loading'));
  }
});

test('band layout removes duplicate branding but keeps desktop navigation and the primary profile header', () => {
  const band = source('src/components/band-workspace.tsx');
  assert.doesNotMatch(band, /Band<span/);
  assert.match(band, /<SpaceSwitcherHeader bandId=\{bandId\}/);
  assert.match(band, /<BandNavigation bandId=\{bandId\} activeSection=\{activeSection\} variant="sidebar"/);
  assert.match(band, /hidden w-64[\s\S]*md:flex/);
  assert.doesNotMatch(band, /BandLogo|ProfileAvatar/);
  assert.match(band, /Banda ativa/);
  assert.match(band, /\{info.name\}/);
  assert.match(band, /info.role === "admin" \? "Administrador" : "Membro"/);
  assert.match(band, /min-w-0 rounded-2xl bg-accent-soft p-4/);
  assert.match(band, /href="\/dashboard"/);
  assert.match(source('src/components/personal-workspace.tsx'), /Band<span className="text-accent">Up<\/span>/);
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
  assert.match(header, /shrink-0 md:hidden/);
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
