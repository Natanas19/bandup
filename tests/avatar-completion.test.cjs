/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { test } = require('node:test');
const A = 'owner-a', B = 'owner-b';
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)]; }
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function fixture(options = {}) {
  const state = { identity: A, calls: [], urls: [], redirects: [], draft: {
    id: 'attempt', ownerId: A, email: 'ana@example.com', file: { name: 'photo.png', type: 'image/png', size: 100 },
  }, ...options };
  const slots = [], effects = [], scheduled = []; let cursor = 0, listener;
  const hooks = { ...React,
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useEffect(fn, deps) { const i = cursor++, old = effects[i];
      if (!old || deps.some((d, j) => d !== old.deps[j])) scheduled.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  class AvatarUploadError extends Error { constructor(stage) { super(stage); this.stage = stage; } }
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/avatar-completion.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, AbortController,
    URL: { createObjectURL(file) { const url = 'blob:' + file.name; state.urls.push(['create', url]); return url; },
      revokeObjectURL(url) { state.urls.push(['revoke', url]); } },
    window: { setTimeout, clearTimeout, location: { replace: url => state.redirects.push(url) } },
    require(name) {
      if (name === 'react') return hooks;
      if (name === '@/components/profile-avatar') return { __esModule: true, default: () => null };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => ({ auth: {
        onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
        async getUser() { return { data: { user: state.identity ? { id: state.identity, email: 'ana@example.com' } : null }, error: null }; },
      } }) };
      if (name === '@/lib/avatar-upload') return { AvatarUploadError,
        validateAvatarFile: f => f.type === 'image/png' ? null : 'Formato inválido',
        async uploadAvatarForUser(_client, user, file, id, signal) {
          state.calls.push(['upload', user, file, id]); state.signal = signal;
          if (state.wait) await state.wait;
          if (state.failure) throw new AvatarUploadError(state.failure);
          return 'https://image.invalid/photo.png';
        },
      };
      if (name === '@/lib/avatar-draft') return {
        async loadAvatarDraft() { return state.draft; },
        async saveAvatarDraft(file, email) { state.draft = { id: 'new-attempt', file, email }; return state.draft; },
        async discardAvatarDraft(id) { state.calls.push(['discard', id]); if (state.draft?.id === id) state.draft = null; },
      };
      return require(name);
    },
  });
  function render() { cursor = 0; const tree = mod.exports.default({ userId: A, onSaved: options.onSaved, currentImageUrl: options.currentImageUrl }); while (scheduled.length) scheduled.shift()(); return nodes(tree); }
  return { state, render, changeIdentity(value) { state.identity = value; listener('SIGNED_OUT', value ? { user: { id: value } } : null); },
    dispose() { effects.forEach(e => e?.cleanup?.()); },
    button(label) { return render().find(n => n.type === 'button' && n.props.children === label); },
  };
}

test('authenticated completion restores a draft but never uploads until explicit confirmation', async () => {
  const f = fixture(); f.render(); await settle(); f.render();
  assert.equal(f.state.calls.length, 0); assert.ok(f.button('Confirmar foto'));
  assert.ok(f.state.urls.some(c => c[0] === 'create')); f.dispose();
  assert.ok(f.state.urls.some(c => c[0] === 'revoke'));
});
test('verified success clears only its draft and reloads the selector through a full dashboard navigation', async () => {
  const f = fixture(); f.render(); await settle(); f.button('Confirmar foto').props.onClick(); await settle();
  assert.deepEqual(f.state.calls.map(c => c[0]), ['upload', 'discard']); assert.deepEqual(f.state.redirects, ['/dashboard']); f.dispose();
});

test('profile editor confirms a photo in place and preserves retries without redirecting', async () => {
  const saved = [], f = fixture({ onSaved: url => saved.push(url), currentImageUrl: 'https://image.invalid/current.png' });
  f.render(); await settle();
  f.button('Confirmar foto').props.onClick(); await settle();
  assert.deepEqual(saved, ['https://image.invalid/photo.png']);
  assert.deepEqual(f.state.redirects, []);
  assert.equal(f.button('Confirmar foto'), undefined);
  f.dispose();
});
test('skip discards the selection and revokes its preview without any upload', async () => {
  const f = fixture(); f.render(); await settle(); f.render(); f.button('Continuar sem enviar foto').props.onClick(); await settle(); f.render();
  assert.ok(!f.state.calls.some(c => c[0] === 'upload')); assert.equal(f.state.draft, null);
  assert.ok(f.state.urls.some(c => c[0] === 'revoke')); f.dispose();
});
test('failed completion keeps the same attempt for safe retry', async () => {
  const f = fixture({ failure: 'profile' }); f.render(); await settle();
  f.button('Confirmar foto').props.onClick(); await settle();
  assert.equal(f.state.draft.id, 'attempt'); assert.equal(f.state.redirects.length, 0);
  f.state.failure = null; f.button('Confirmar foto').props.onClick(); await settle();
  assert.deepEqual(f.state.calls.filter(c => c[0] === 'upload').map(c => c[3]), ['attempt', 'attempt']); f.dispose();
});
test('logout/account switch aborts in-flight work and never presents a stale success', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture({ wait }); f.render(); await settle(); f.button('Confirmar foto').props.onClick(); await settle();
  f.changeIdentity(B); assert.equal(f.state.signal.aborted, true); release(); await settle();
  assert.equal(f.state.redirects.length, 0); assert.equal(f.button('Confirmar foto'), undefined); f.dispose();
});
test('duplicate confirmation cannot create concurrent writes', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture({ wait }); f.render(); await settle(); const button = f.button('Confirmar foto');
  button.props.onClick(); button.props.onClick(); await settle();
  assert.equal(f.state.calls.filter(c => c[0] === 'upload').length, 1); release(); await settle(); f.dispose();
});
test('new selection revokes the old preview, and invalid files never replace the draft', async () => {
  const f = fixture(); f.render(); await settle(); f.render();
  const input = () => f.render().find(n => n.type === 'input');
  input().props.onChange({ currentTarget: { files: [{ type: 'image/svg+xml' }], value: 'x' } }); await settle();
  assert.equal(f.state.draft.id, 'attempt');
  input().props.onChange({ currentTarget: { files: [{ name: 'new.png', type: 'image/png', size: 10 }], value: 'x' } }); await settle(); f.render();
  assert.equal(f.state.draft.id, 'new-attempt'); assert.ok(f.state.urls.some(c => c[0] === 'revoke' && c[1] === 'blob:photo.png')); f.dispose();
});
