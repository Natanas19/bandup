/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/details-dismiss.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: mod, exports: mod.exports });
const { bindDetailsDismiss } = mod.exports;

function fixture() {
  const listeners = new Map(), adds = [], removes = [];
  const document = {
    activeElement: null,
    addEventListener(type, handler, capture) { listeners.set(type, handler); adds.push([type, handler, capture]); },
    removeEventListener(type, handler, capture) { assert.equal(listeners.get(type), handler); listeners.delete(type); removes.push([type, handler, capture]); },
  };
  function menu() {
    const item = { ownerDocument: document, open: false, focused: 0 };
    const summary = { focus() { item.focused++; document.activeElement = summary; } };
    const link = {};
    item.contains = node => [item, summary, link].includes(node);
    item.querySelector = selector => { assert.equal(selector, 'summary'); return summary; };
    return { item, summary, link };
  }
  function emit(type, path, options = {}) {
    const event = { key: 'Escape', defaultPrevented: false, composedPath: () => path,
      preventDefault() { this.defaultPrevented = true; }, ...options };
    listeners.get(type)?.(event);
    return event;
  }
  return { document, menu, emit, adds, removes, listeners };
}

for (const pointerType of ['mouse', 'touch', 'pen']) {
  test(`outside ${pointerType} closes both menus without cancelling the outside interaction`, () => {
    const f = fixture(), a = f.menu(), b = f.menu();
    const cleanA = bindDetailsDismiss(a.item), cleanB = bindDetailsDismiss(b.item);
    a.item.open = b.item.open = true;
    f.document.activeElement = a.link;
    const event = f.emit('pointerdown', [{}], { pointerType });
    assert.equal(a.item.open, false); assert.equal(b.item.open, false);
    assert.equal(event.defaultPrevented, false); assert.equal(a.item.focused, 1); assert.equal(b.item.focused, 0);
    cleanA(); cleanB();
  });
}

test('inside interaction stays open; the summary keeps native toggle behavior without reopening', () => {
  const f = fixture(), a = f.menu(); const cleanup = bindDetailsDismiss(a.item);
  a.item.open = true;
  f.emit('pointerdown', [a.link, a.item]); assert.equal(a.item.open, true);
  f.emit('pointerdown', [a.summary, a.item]); assert.equal(a.item.open, true);
  a.item.open = !a.item.open; // Native summary click toggles once after pointerdown.
  assert.equal(a.item.open, false);
  f.emit('pointerdown', [a.summary, a.item]);
  a.item.open = !a.item.open;
  assert.equal(a.item.open, true); assert.equal(a.item.focused, 0);
  cleanup();
});

test('Escape closes the focused menu and restores summary focus; other keys and handled Escape are preserved', () => {
  const f = fixture(), a = f.menu(); const cleanup = bindDetailsDismiss(a.item);
  a.item.open = true; f.document.activeElement = a.link;
  f.emit('keydown', [a.link, a.item], { key: 'Tab' }); assert.equal(a.item.open, true);
  f.emit('keydown', [a.link, a.item], { defaultPrevented: true }); assert.equal(a.item.open, true);
  f.emit('keydown', [{}]); assert.equal(a.item.open, true);
  assert.equal(f.emit('keydown', [a.link, a.item]).defaultPrevented, true);
  assert.equal(a.item.open, false); assert.equal(f.document.activeElement, a.summary);
  cleanup();
});

test('one listener pair is shared, fully cleaned up and safely remounted', () => {
  const f = fixture(), a = f.menu(), b = f.menu();
  const cleanA = bindDetailsDismiss(a.item), cleanB = bindDetailsDismiss(b.item);
  assert.equal(f.adds.length, 2);
  cleanA(); assert.equal(f.removes.length, 0);
  b.item.open = true; f.emit('pointerdown', [{}]); assert.equal(b.item.open, false);
  cleanB(); assert.equal(f.removes.length, 2); assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.adds, f.removes);
  const again = bindDetailsDismiss(a.item);
  cleanA(); cleanB(); assert.equal(f.listeners.size, 2);
  again(); assert.equal(f.listeners.size, 0);
});

test('clicking the other menu trigger closes the old menu and lets the new one open', () => {
  const f = fixture(), a = f.menu(), b = f.menu();
  const cleanA = bindDetailsDismiss(a.item), cleanB = bindDetailsDismiss(b.item);
  a.item.open = true;
  f.emit('pointerdown', [b.summary, b.item]); b.item.open = true;
  assert.equal(a.item.open, false); assert.equal(b.item.open, true);
  cleanA(); cleanB();
});
