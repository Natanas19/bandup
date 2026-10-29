/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const colors = require('tailwindcss/colors');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const css = read('src/app/globals.css');
const ast = postcss.parse(css);
function palette(selector) {
  let found;
  ast.walkRules(selector, rule => { found = Object.fromEntries(rule.nodes.filter(n => n.type === 'decl' && n.prop.startsWith('--')).map(n => [n.prop.slice(2), n.value])); });
  assert.ok(found, selector); return found;
}
const light = palette(':root'), dark = palette(':root[data-theme="dark"]'), automaticDark = palette(':root:not([data-theme])');
function color(value) {
  if (Array.isArray(value)) return value;
  if (value.startsWith('#')) return value.slice(1).match(/../g).map(x => parseInt(x, 16));
  return value.match(/[\d.]+/g).map(Number);
}
function composite(front, back, opacity) {
  front = color(front); back = color(back);
  const alpha = opacity ?? front[3] ?? 1;
  return front.slice(0, 3).map((v, i) => v * alpha + back[i] * (1 - alpha));
}
function luminance(value) {
  return color(value).slice(0, 3).map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(front, back) {
  const a = luminance(composite(front, back)), b = luminance(back);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function aa(front, back, label) { const ratio = contrast(front, back); assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(4)}:1 < 4.5:1`); }
const secondary = ['content-label','content-muted','content-subtle','content-faint'];
const neutralBackgrounds = ['surface','surface-muted','surface-raised','background','accent-soft','disabled-surface'];

test('contrast math uses unrounded sRGB luminance and catches the original failures', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
  assert.ok(Math.abs(contrast('#a1a1aa','#ffffff') - 2.562854) < .0001);
  assert.ok(contrast('#71717a','#f5f3ff') < 4.5);
});
test('small secondary text and placeholders meet AA across actual neutral surfaces in both themes', () => {
  for (const [name, p] of [['light', light], ['dark', dark]])
    for (const text of secondary) for (const bg of neutralBackgrounds) aa(p[text], p[bg], `${name} ${text}/${bg}`);
  const hierarchy = ['content-strong','content-label','content-muted','content-subtle','content-faint'].map(t => luminance(light[t]));
  hierarchy.slice(1).forEach((value, i) => assert.ok(value > hierarchy[i], 'Light secondary hierarchy remains ordered'));
});
test('public-profile helper text survives gradient, glow and translucent empty-state composition', () => {
  for (const [name, p] of [['light', light], ['dark', dark]]) {
    const bases = ['background','decorative-start','decorative-end','decorative-glow'].map(k => color(p[k]));
    // A channel-wise envelope also bounds unsampled sRGB gradient/glow mixtures.
    const envelope = [0,1,2].map(i => (name === 'light' ? Math.min : Math.max)(...bases.map(c => c[i])));
    for (const text of ['content-subtle','content-muted','accent']) aa(p[text], envelope, `${name} public ${text}/envelope`);
    for (const base of bases) for (const alpha of [0,.15,.3,.45,.6]) {
      const backdrop = composite(p['decorative-glow'], base, alpha);
      aa(p['content-subtle'], backdrop, `${name} public helper/glow ${alpha}`);
      aa(p['content-muted'], composite(p.surface, backdrop, .7), `${name} public empty/surface70`);
    }
  }
});
test('light login secondary text meets AA even at the brightest purple gradient stop', () => {
  const stops = [colors.violet[700], colors.violet[800], colors.indigo[950]];
  for (let segment = 0; segment < stops.length - 1; segment++) for (let step = 0; step <= 50; step++) {
    const backdrop = composite(stops[segment + 1], stops[segment], step / 50);
    for (const text of ['login-secondary','login-caption']) aa(light[text], backdrop, `${text}/login gradient ${segment}/${step}`);
  }
});
test('dark and automatic-dark keep the original secondary and login effective colors', () => {
  assert.deepEqual(automaticDark, dark);
  assert.deepEqual(color(dark['content-faint']), [170,163,184]);
  assert.deepEqual(color(dark['content-subtle']), [170,163,184]);
  for (const bg of [colors.violet[700], colors.violet[800], colors.indigo[950]]) {
    assert.deepEqual(composite(dark['login-secondary'], bg), composite([237,233,254,.8], bg));
    assert.deepEqual(composite(dark['login-caption'], bg), composite([221,214,254,.75], bg));
  }
});
test('real UI classes compile to accessible token colors, opaque placeholders and Safari 15 compatible CSS', async () => {
  const files = ['src/app/login/page.tsx','src/app/page.tsx','src/components/band-workspace.tsx','src/components/band-navigation.tsx',
    'src/components/theme-selector.tsx','src/app/bandas/nova/page.tsx','src/app/bandas/[bandId]/tarefas/page.tsx',
    'src/app/bandas/[bandId]/agenda/page.tsx','src/app/bandas/[bandId]/links/page.tsx','src/components/band-public-profile-settings.tsx','src/components/public-band-profile.tsx'];
  const sources = files.map(read).join('\n');
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('tailwind.config.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module: loaded, exports: loaded.exports });
  const result = await postcss([tailwind({ ...loaded.exports.default, content: [{ raw: sources }] })]).process(css, { from: undefined });
  for (const name of ['content-faint','content-subtle','login-secondary','login-caption']) assert.ok(result.css.includes(`var(--${name})`), name);
  assert.ok(read('src/app/login/page.tsx').includes('text-login-secondary'));
  assert.ok(read('src/app/login/page.tsx').includes('text-login-caption'));
  assert.ok(read('src/components/band-workspace.tsx').includes('text-content-faint'));
  assert.ok(read('src/components/band-navigation.tsx').includes('bg-disabled-surface'));
  assert.ok(read('src/components/public-band-profile.tsx').includes('bg-surface/70'));
  assert.doesNotMatch(read('src/components/public-band-profile.tsx'), /text-content-faint/,
    'Faint is tested for neutral surfaces; public gradient helper uses content-subtle');
  assert.doesNotMatch(sources, /(?:text-content-faint|placeholder:text-content-faint|text-content-subtle)\/\d+/);
  let placeholderOpacity = false, placeholderColor = false;
  result.root.walkRules(rule => {
    if (!rule.selector.includes('placeholder')) return;
    rule.walkDecls('opacity', decl => { if (decl.value === '1') placeholderOpacity = true; });
    rule.walkDecls('color', decl => { if (decl.value.includes('var(--content-faint)')) placeholderColor = true; });
  });
  assert.ok(placeholderOpacity && placeholderColor, 'Placeholder opacity reset and token color must both exist');
  assert.doesNotMatch(result.css, /color-mix\(|light-dark\(|oklch\(/);
});
