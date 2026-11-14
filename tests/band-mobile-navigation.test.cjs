/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const source = fs.readFileSync('src/components/band-navigation.tsx', 'utf8');
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function fixture() {
  const slots = []; let cursor = 0, focused = 0, captures = 0;
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, require(name) {
    if (name === 'react') return { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useId: () => 'mobile-nav',
    };
    if (name === 'next/link' || name === '@/components/navigation-icon') return { __esModule: true, default: () => null };
    return require(name);
  } });
  const render = () => {
    cursor = 0;
    const tree = nodes(mod.exports.default({ bandId: 'band-a', activeSection: 'agenda' }));
    tree.find(n => n.type === 'button').props.ref.current = { focus() { focused++; } };
    return tree;
  };
  const pointer = (x, y, options = {}) => ({ isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y,
    currentTarget: { setPointerCapture() { captures++; } }, ...options });
  return { render, pointer, focused: () => focused, captures: () => captures };
}
test('handle toggles mobile extras while all four routes and the active state remain visible', () => {
  const h = fixture();
  for (const expanded of [false, true, false]) {
    const tree = h.render(), trigger = tree.find(n => n.type === 'button');
    assert.equal(trigger.props['aria-expanded'], expanded);
    assert.match(trigger.props['aria-label'], expanded ? /Recolher/ : /Expandir/);
    const panel = tree.find(n => n.props?.id === trigger.props['aria-controls']);
    assert.equal(panel.props['aria-hidden'], !expanded);
    assert.match(panel.props.className, /motion-reduce:transition-none/);
    const links = tree.filter(n => n.props?.href);
    assert.deepEqual(links.map(n => n.props.href), ['/bandas/band-a','/bandas/band-a/tarefas','/bandas/band-a/agenda','/bandas/band-a/membros']);
    assert.equal(links.find(n => n.props['aria-current'] === 'page').props.href, '/bandas/band-a/agenda');
    const extras = tree.filter(n => n.props?.['aria-disabled'] === 'true');
    assert.deepEqual(extras.map(n => n.props.children[1].props.children), ['Perfil público','Links','Ingressos','Loja']);
    assert.ok(extras.every(n => !n.props.href && !n.props.onClick && n.props.tabIndex === undefined));
    assert.ok(extras.every(n => JSON.stringify(n.props.children).includes('Em breve')));
    trigger.props.onClick();
  }
});

test('handle is visually compact with a 28 by 3 pixel indicator and a 44 pixel touch region above the links', () => {
  const tree = fixture().render(), handle = tree.find(n => n.type === 'button');
  assert.match(handle.props.className, /\bh-3\b/);
  assert.doesNotMatch(handle.props.className, /min-h-11/);
  assert.match(handle.props.className, /before:-top-8/);
  assert.match(handle.props.className, /before:bottom-0/);
  const indicator = handle.props.children;
  assert.match(indicator.props.className, /h-\[3px\]/);
  assert.match(indicator.props.className, /\bw-7\b/);
  assert.equal(indicator.props['aria-hidden'], 'true');
  assert.ok(tree.filter(n => n.props?.href).every(n => n.props.className.includes('min-h-[4.25rem]')));
});
test('vertical swipe opens/closes only after threshold and suppresses the synthetic click', () => {
  const h = fixture(); let nav = h.render()[0];
  nav.props.onPointerDown(h.pointer(10, 100)); nav.props.onPointerMove(h.pointer(11, 90));
  assert.equal(h.render().find(n => n.type === 'button').props['aria-expanded'], false);
  nav.props.onPointerMove(h.pointer(12, 55)); nav.props.onPointerUp();
  nav = h.render()[0]; assert.equal(nav.props['data-band-nav-expanded'], 'true');
  let prevented = 0;
  nav.props.onClickCapture({ detail: 1, preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(prevented, 1); assert.equal(h.captures(), 1);
  nav.props.onPointerDown(h.pointer(10, 30)); nav.props.onPointerMove(h.pointer(10, 75)); nav.props.onPointerUp();
  assert.equal(h.render().find(n => n.type === 'button').props['aria-expanded'], false);
});
test('horizontal, cancelled and secondary-pointer gestures do not expand; Escape restores focus', () => {
  const h = fixture(); const nav = h.render()[0];
  nav.props.onPointerDown(h.pointer(10, 80)); nav.props.onPointerMove(h.pointer(80, 40)); nav.props.onPointerCancel();
  nav.props.onPointerMove(h.pointer(10, 0));
  nav.props.onPointerDown(h.pointer(10, 80, { isPrimary: false })); nav.props.onPointerMove(h.pointer(10, 0));
  assert.equal(h.render().find(n => n.type === 'button').props['aria-expanded'], false);
  h.render().find(n => n.type === 'button').props.onClick();
  let prevented = false;
  h.render()[0].props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.focused(), 1);
  assert.equal(h.render().find(n => n.type === 'button').props['aria-expanded'], false);
  assert.doesNotMatch(source, /addEventListener|window\.|document\./);
});
test('Tailwind generates responsive expanded padding, safe area and reduced-motion rules', async () => {
  const workspace = fs.readFileSync('src/components/band-workspace.tsx', 'utf8');
  const result = await postcss([tailwind({ content: [{ raw: source + workspace, extension: 'tsx' }], corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined });
  assert.match(result.css, /:has\(\[data-band-nav-expanded=true\]\)/);
  assert.match(result.css, /padding-bottom: calc\(13rem \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(result.css, /prefers-reduced-motion: reduce/);
  assert.match(result.css, /min-width: 768px/);
  assert.match(result.css, /--tw-pan-x: pan-x/);
  assert.match(result.css, /touch-action: var\(--tw-pan-x\)/);
});

test('keyboard activation stays native and a normal tap is never swallowed as a swipe', () => {
  const h = fixture();
  for (const key of ['Enter', ' ']) {
    const tree = h.render(), nav = tree[0], handle = tree.find(n => n.type === 'button');
    assert.equal(handle.props.type, 'button');
    nav.props.onKeyDown({ key, preventDefault() { assert.fail('native activation must not be prevented'); } });
    handle.props.onClick();
  }
  const nav = h.render()[0];
  nav.props.onPointerDown(h.pointer(10, 20)); nav.props.onPointerUp();
  nav.props.onClickCapture({ detail: 1, preventDefault() { assert.fail('ordinary taps must navigate'); }, stopPropagation() {} });
  assert.equal(h.render().find(n => n.type === 'button').props['aria-expanded'], false);
});
