/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');

function harness(file, result, initial = {}) {
  const states = { ...initial }, refs = [], calls = [], effects = [], avatarCalls = [], objectUrls = [], draftCalls = [];
  let cursor = 0, refCursor = 0;
  const client = {
    auth: {
      async signUp(args) {
        calls.push(args);
        if (result instanceof Error) throw result;
        return typeof result === 'function' ? result() : result;
      },
      async getUser() {
        avatarCalls.push('getUser');
        return { data: { user: { id: initial.authenticatedUserId ?? 'new' } }, error: initial.authError ?? null };
      },
      async updateUser(args) {
        avatarCalls.push(['updateUser', args]);
        return { error: initial.profileUpdateError ?? null };
      },
    },
    storage: {
      from(bucket) {
        avatarCalls.push(['from', bucket]);
        return {
          async upload(path, uploadedFile, options) {
            avatarCalls.push(['upload', path, uploadedFile.type, options]);
            return { error: initial.avatarUploadState?.error ?? initial.avatarUploadError ?? null };
          },
          getPublicUrl(path) {
            avatarCalls.push(['getPublicUrl', path]);
            return { data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/avatars/${path}` } };
          },
          async remove(paths) {
            avatarCalls.push(['remove', paths]);
            return { error: initial.removeError ?? null };
          },
        };
      },
    },
  };
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, window: { location: { origin: initial.origin ?? 'http://localhost:3000' } },
    URL: {
      createObjectURL(file) { const url = `blob:${file.name}`; objectUrls.push(['create', url]); return url; },
      revokeObjectURL(url) { objectUrls.push(['revoke', url]); },
    },
    require(name) {
      if (name === 'react') return { ...React,
        useState(value) { const i = cursor++; if (!(i in states)) states[i] = value;
          return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef(value) { const i = refCursor++; return refs[i] ??= { current: value }; },
        useEffect(fn) { effects.push(fn); },
      };
      if (name === 'next/navigation') return { useRouter: () => ({ replace: url => calls.push(url) }) };
      if (name === '@/lib/supabase/client') return { getSupabaseBrowserClient: () => client };
      if (name === '@/lib/avatar-draft') return {
        async saveAvatarDraft(file, email) {
          draftCalls.push(['save', file, email]);
          if (initial.draftError) throw Error('Browser storage unavailable');
          return { id: 'draft', file, email };
        },
        async discardAvatarDraft() { draftCalls.push(['discard']); },
      };
      if (name === '@/lib/avatar-upload') {
        const avatar = { exports: {} };
        vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/avatar-upload.ts'), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText, { module: avatar, exports: avatar.exports, require() { return {}; } });
        return avatar.exports;
      }
      if (name === 'next/link' || name.startsWith('@/components/')) return { __esModule: true, default: () => null };
      if (name === '@/lib/display-name') {
      const names = { exports: {} };
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/display-name.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText, { module: names, exports: names.exports });
      return names.exports;
    }
    return require(name);
    },
  });
  return { states, calls, avatarCalls, objectUrls, effects, draftCalls, render() { cursor = refCursor = 0; return mod.exports.default(); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const signup = (result, initial = {}) => harness('src/app/cadastro/page.tsx', result,
  { 0: ' person@example.com ', 1: 'password123', 2: 'password123', 6: ' Ana Silva ', ...initial });
const submit = h => nodes(h.render()).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });

test('signup with session navigates only to dashboard and trims email', async () => {
  const h = signup({ data: { session: { user: { id: 'new' } } }, error: null });
  await submit(h);
  assert.equal(h.calls[0].options.data.display_name, 'Ana Silva');
  assert.equal(h.calls[0].email, 'person@example.com');
  assert.equal(h.calls[0].options.emailRedirectTo, 'http://localhost:3000/login');
  assert.deepEqual(h.calls.slice(1), ['/dashboard']);
  assert.equal(h.states[1], '');
});

test('confirmation-required signup returns to the allowed login URL on Vercel and localhost without creating a session', async () => {
  for (const origin of ['https://bandup-theta.vercel.app', 'http://localhost:3000']) {
    const h = signup({ data: { user: { id: 'unverified-user' }, session: null }, error: null }, { origin });
    await submit(h);
    assert.equal(h.calls[0].options.emailRedirectTo, origin + '/login');
    assert.equal(h.states[5], true); assert.equal(h.calls.includes('/dashboard'), false);
    assert.equal(h.avatarCalls.length, 0);
  }
});

test('signup defers every photo to authenticated completion, regardless of signup session or user ID', async () => {
  const file = { name: 'profile.png', type: 'image/png', size: 1024 };
  for (const session of [null, { user: { id: 'new-user' } }]) {
    const h = signup({ data: { user: { id: 'obfuscated-or-unverified' }, session }, error: null }, { 8: file });
    await submit(h);
    assert.equal(h.avatarCalls.length, 0, 'no Storage or Auth metadata calls during signup');
    assert.deepEqual(h.draftCalls, [['save', file, 'person@example.com']]);
    assert.equal(h.states[8], null);
    assert.equal(h.states[11], true);
    if (session) assert.deepEqual(h.calls.slice(1), ['/dashboard']);
    else {
      assert.equal(h.states[5], true);
      assert.ok(nodes(h.render()).some(n => JSON.stringify(n.props?.children).includes('confirme o envio da foto')));
    }
  }
});

test('local draft failure never turns an accepted signup into an account failure', async () => {
  for (const session of [null, { user: { id: 'new-user' } }]) {
    const h = signup({ data: { session }, error: null }, {
      8: { name: 'profile.webp', type: 'image/webp', size: 2048 }, draftError: true,
    });
    await submit(h);
    assert.equal(h.avatarCalls.length, 0); assert.equal(h.states[3], '');
    assert.equal(h.states[12], true);
    if (session) assert.equal(h.calls.includes('/dashboard'), true);
    else assert.ok(nodes(h.render()).some(n => JSON.stringify(n.props?.children).includes('selecione-a novamente')));
  }
});

test('signup without photo clears a stale draft and keeps the normal session redirect', async () => {
  const h = signup({ data: { session: {} }, error: null }); await submit(h);
  assert.deepEqual(h.draftCalls, [['discard']]); assert.equal(h.avatarCalls.length, 0);
  assert.equal(h.calls.includes('/dashboard'), true);
});

test('signup image input is optional, previews valid images and rejects unsupported files', () => {
  const h = signup(null);
  const imageInput = () => nodes(h.render()).find(node => node.props?.id === 'avatar-file');
  assert.equal(imageInput().props.type, 'file');
  assert.equal(imageInput().props.required, undefined);
  assert.equal(imageInput().props.accept, 'image/jpeg,image/png,image/webp');

  const input = imageInput();
  const validFile = { name: 'profile.webp', type: 'image/webp', size: 1024 };
  input.props.onChange({ currentTarget: { files: [validFile], value: 'profile.webp' } });
  assert.equal(h.states[8], validFile);
  assert.equal(h.states[9], 'blob:profile.webp');
  assert.ok(nodes(h.render()).some(node => JSON.stringify(node.props?.children).includes('Prévia da foto selecionada')));

  imageInput().props.onChange({ currentTarget: { files: [{ name: 'bad.svg', type: 'image/svg+xml', size: 10 }], value: 'bad.svg' } });
  assert.equal(h.states[8], null);
  assert.match(h.states[10], /JPG, PNG ou WebP/);
  assert.ok(h.objectUrls.some(call => call[0] === 'revoke' && call[1] === 'blob:profile.webp'));
});

test('confirmation and duplicate accounts display the same neutral response without redirect', async () => {
  for (const result of [
    { data: { session: null }, error: null },
    { data: null, error: { code: 'user_already_exists', message: 'Account exists: person@example.com' } },
    { data: null, error: { code: 'email_exists' } },
  ]) {
    const h = signup(result); await submit(h);
    assert.equal(h.states[5], true);
    assert.equal(h.states[3], '');
    assert.equal(h.calls.length, 1);
    const tree = nodes(h.render());
    assert.equal(tree.some(n => n.type === 'form'), false);
    assert.ok(tree.some(n => n.props?.role === 'status'));
    assert.ok(tree.some(n => n.props?.href === '/login'));
  }
});
test('invalid inputs do not call Supabase', async () => {
  for (const initial of [{ 6: '' }, { 6: 'private@example.com' }, { 6: 'a'.repeat(81) }, { 0: 'invalid' }, { 1: 'short', 2: 'short' }, { 2: 'different' }]) {
    const h = signup(null, initial); await submit(h);
    assert.equal(h.calls.length, 0); assert.ok(h.states[3]);
  }
});
test('service failures never expose raw errors and allow retry', async () => {
  for (const result of [new Error('secret'), { data: null, error: { code: 'unexpected', message: 'secret' } }]) {
    const h = signup(result); await submit(h);
    assert.ok(h.states[3]); assert.equal(h.states[3].includes('secret'), false);
    assert.equal(h.states[4], false); assert.equal(h.states[5], false);
  }
});
test('double submit sends a single request and displays loading', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = signup(() => pending);
  const first = submit(h); await submit(h);
  assert.equal(h.calls.length, 1);
  assert.ok(nodes(h.render()).some(n => n.type === 'button' && n.props.disabled));
  finish({ data: { session: null }, error: null }); await first;
});


test('empty and malformed emails show Portuguese feedback and never reach Supabase', async () => {
  for (const value of ['', '   ', 'invalid', 'a@localhost', 'a@@example.com', 'a b@example.com', 'a@example..com', 'a@.com']) {
    const h = signup(null, { 0: value });
    await submit(h);
    assert.equal(h.calls.length, 0);
    assert.equal(h.states[3], value.trim() ? 'Informe um e-mail válido, como voce@exemplo.com.' : 'Informe seu e-mail.');
    const input = nodes(h.render()).find(n => n.props?.id === 'email');
    assert.equal(input.props['aria-invalid'], true);
    assert.ok(input.props['aria-describedby'].includes('signup-email-error'));
  }
});

test('email field supports mobile entry, native feedback, trimming and correction', () => {
  const h = signup(null, { 0: '' });
  const field = () => nodes(h.render()).find(n => n.props?.id === 'email');
  assert.equal(field().props.type, 'email');
  assert.equal(field().props.inputMode, 'email');
  assert.equal(field().props.autoComplete, 'email');
  assert.equal(field().props.autoCapitalize, 'none');
  assert.equal(field().props.autoCorrect, 'off');
  assert.equal(field().props.spellCheck, false);
  assert.equal(field().props.required, true);
  const pattern = new RegExp(`^(?:${field().props.pattern})$`);
  assert.equal(pattern.test('a@localhost'), false);
  assert.equal(pattern.test('ana+band@example.com.br'), true);
  let validity;
  const target = { value: '', setCustomValidity(message) { validity = message; } };
  field().props.onInvalid({ currentTarget: target });
  assert.equal(validity, 'Informe seu e-mail.');
  target.value = 'invalid';
  field().props.onBlur({ currentTarget: target });
  assert.equal(field().props['aria-invalid'], true);
  field().props.onInvalid({ currentTarget: target });
  assert.match(validity, /e-mail válido/);
  target.value = '  ana+band@example.com.br  ';
  field().props.onChange({ currentTarget: target, target });
  assert.equal(validity, '');
  assert.equal(field().props.value, 'ana+band@example.com.br');
  assert.equal(field().props['aria-invalid'], false);
});
