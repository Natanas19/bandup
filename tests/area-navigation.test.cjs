/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');

function fixture() {
  let open = false, focused = 0;
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module: mod, exports: mod.exports, require(name) {
      if (name === 'react') return { ...React,
        useState: () => [open, value => { open = typeof value === 'function' ? value(open) : value; }],
        useId: () => 'area-menu', useRef: () => ({ current: { focus() { focused++; } } }),
      };
      if (name === 'next/navigation') return { usePathname: () => '/meu-perfil/agenda' };
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null };
      if (name === 'react/jsx-runtime') return require(name);
      throw Error('Unexpected dependency: ' + name);
    } });
    return mod.exports;
  }
  return { load, focused: () => focused };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

for (const variant of ['sidebar', 'expandable']) {
  test(`band ${variant} has one personal destination and retains band-scoped sections`, () => {
    const Navigation = fixture().load('src/components/band-navigation.tsx').default;
    const tree = nodes(Navigation({ bandId: 'band-a', activeSection: 'agenda', variant }));
    const links = tree.filter(n => n.props?.href);
    const personal = links.filter(n => n.props.href === '/meu-perfil');
    assert.equal(personal.length, 1);
    assert.match(personal[0].props.className, /min-h-11/);
    assert.match(personal[0].props.className, /focus:ring-focus/);
    assert.equal(personal[0].props['aria-current'], undefined);
    for (const section of ['', '/tarefas', '/agenda', '/membros', '/links', '/perfil-publico']) {
      assert.equal(links.filter(n => n.props.href === '/bandas/band-a' + section).length, 1);
    }
    assert.equal(links.filter(n => n.props['aria-current'] === 'page').length, 1);
    assert.equal(links.find(n => n.props['aria-current'] === 'page').props.href, '/bandas/band-a/agenda');
    // Desktop return stays in BandWorkspace; mobile return stays in this menu.
    assert.equal(links.filter(n => n.props.href === '/dashboard').length, variant === 'sidebar' ? 0 : 1);
    assert.equal(tree.find(n => n.props?.id === 'area-menu').props.hidden, variant !== 'sidebar');
  });
}

test('mobile personal link and Escape close the menu and restore trigger focus', () => {
  const f = fixture(), Navigation = f.load('src/components/band-navigation.tsx').default;
  const render = () => nodes(Navigation({ bandId: 'b', activeSection: 'overview' }));
  let tree = render();
  const trigger = tree.find(n => n.type === 'button');
  assert.equal(trigger.props['aria-controls'], 'area-menu');
  assert.equal(trigger.props['aria-expanded'], false);
  trigger.props.onClick();
  assert.equal(render().find(n => n.props?.id === 'area-menu').props.hidden, false);
  render().find(n => n.props?.href === '/meu-perfil').props.onClick();
  assert.equal(render().find(n => n.type === 'button').props['aria-expanded'], false);
  assert.equal(f.focused(), 1);
  trigger.props.onClick();
  tree = render();
  let prevented = false;
  tree.find(n => n.type === 'nav').props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(render().find(n => n.props?.id === 'area-menu').props.hidden, true);
  assert.equal(f.focused(), 2);
});

test('personal desktop and mobile menus keep one return to dashboard', () => {
  for (const sidebar of [false, true]) {
    const Navigation = fixture().load('src/components/personal-workspace.tsx').PersonalNavigation;
    const links = nodes(Navigation({ sidebar })).filter(n => n.props?.href);
    assert.equal(links.filter(n => n.props.href === '/dashboard').length, 1);
    assert.equal(new Set(links.map(n => n.props.href)).size, links.length);
    assert.equal(links.find(n => n.props['aria-current'] === 'page').props.href, '/meu-perfil/agenda');
  }
});

test('band page menus hide at the same breakpoint where the desktop workspace appears', () => {
  const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(source('src/components/band-workspace.tsx'), /hidden w-64[\s\S]*md:flex/);
  assert.match(source('src/components/band-workspace.tsx'), /md:pl-64/);
  for (const file of ['page', 'tarefas/page', 'agenda/page', 'membros/page', 'links/page', 'perfil-publico/page']) {
    const page = source(`src/app/bandas/[bandId]/${file}.tsx`);
    if (file === 'page') assert.match(page, /<header className="[^"]*md:hidden">[\s\S]*<BandNavigation[\s\S]*<\/header>/);
    else assert.match(page, /className="md:hidden">\s*<BandNavigation/);
    if (file === 'perfil-publico/page') {
      assert.equal((page.match(/<BandNavigation/g) ?? []).length, (page.match(/className="md:hidden"><BandNavigation/g) ?? []).length);
    }
  }
  assert.match(source('src/components/legacy-band-links.tsx'), /className="md:hidden"><BandNavigation/);
});
