/* eslint-disable @typescript-eslint/no-require-imports */
// Compile source in memory, mock all network/SDK boundaries. No database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname,'..');
function modules(env={},overrides={},browser={}) {
  const cache=new Map();
  const unexpected=()=>{throw new Error('Unexpected backend access');};
  function load(file) {
    if(cache.has(file))return cache.get(file).exports;
    const mod={exports:{}}; cache.set(file,mod);
    function localRequire(id) {
      if(Object.hasOwn(overrides,id))return overrides[id];
      if(id==='server-only')return {};
      if(id==='next/image'||id==='@/components/theme-selector')return {__esModule:true,default:()=>null};
      if(id==='react')return {...React,cache:fn=>fn};
      if(id==='react/jsx-runtime')return require(id);
      if(id==='next/navigation')return {useParams:()=>({bandId:'demo-band'}),notFound:()=>{throw new Error('notFound');}};
      if(id==='next/link')return {__esModule:true,default:({href,children,className})=>React.createElement('a',{href,className},children)};
      if(id==='@supabase/supabase-js')return {createClient:unexpected};
      if(id==='@/lib/supabase/client')return {getSupabaseBrowserClient:unexpected};
      if(id.startsWith('@/')||id.startsWith('.')) {
        const base=id.startsWith('@/')?'src/'+id.slice(2):path.join(path.dirname(file),id);
        const resolved=[base+'.ts',base+'.tsx'].find(f=>fs.existsSync(path.join(root,f)));
        assert.ok(resolved,'Missing source '+id);return load(resolved);
      }
      throw new Error('Unmocked import '+id);
    }
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInNewContext(code,{module:mod,exports:mod.exports,require:localRequire,process:{env},URL,Buffer,AbortController,Response,
      setTimeout,clearTimeout,fetch:unexpected,...browser},{filename:file});
    return mod.exports;
  }
  return {load};
}

test('publication defaults off; only exact explicit true opts in',()=>{
  for(const value of [undefined,'','false','0','TRUE','1']){
    const env=value===undefined?{}:{NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED:value};
    const api=modules(env).load('src/lib/publication-control.ts');
    assert.equal(api.PUBLICATION_ENABLED,false);
    assert.throws(()=>api.requirePublicationEnabled(),{name:'PublicationDisabledError'});
  }
  assert.equal(modules({NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED:'true'}).load('src/lib/publication-control.ts').PUBLICATION_ENABLED,true);
});

test('identity has its own strict opt-in and keeps legacy link publication disabled', async () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1']) {
    const api = modules({
      NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED: 'true',
      NEXT_PUBLIC_BANDUP_PUBLIC_IDENTITY_ENABLED: value,
    }).load('src/lib/publication-control.ts');
    assert.equal(api.PUBLIC_IDENTITY_ENABLED, false);
  }
  const load = modules({NEXT_PUBLIC_BANDUP_PUBLIC_IDENTITY_ENABLED:'true'}).load;
  const control = load('src/lib/publication-control.ts');
  assert.equal(control.PUBLIC_IDENTITY_ENABLED, true);
  assert.equal(control.PUBLICATION_ENABLED, false);
  await assert.rejects(load('src/lib/band-publication.ts').updateLinkPublication('demo','link',false,true),
    {name:'PublicationDisabledError'});
});

test('server reader refuses before credentials, SDK creation or network',async()=>{
  const env=new Proxy({}, {get:(_,key)=>{
    if(key==='NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED')return undefined;
    if(key==='NEXT_PUBLIC_BANDUP_PUBLIC_IDENTITY_ENABLED')return undefined;
    throw new Error('Credentials must not be read while disabled');
  }});
  const api=modules(env).load('src/lib/supabase/public-server.ts');
  await assert.rejects(api.readPublicBandRow('demo'),{name:'PublicationDisabledError'});
});

test('public loader and both route entry points make zero data calls',async()=>{
  const load=modules({}, {'@/lib/supabase/public-server':{readPublicBandRow:()=>{throw new Error('Reader reached');}}}).load;
  const api=load('src/lib/public-bands.ts');
  assert.equal(await api.getPublicBandBySlug('demo'),null);
  const page=modules({}, {'@/lib/public-bands':{getPublicBandBySlug:()=>{throw new Error('Public loader reached');}}}).load('src/app/b/[slug]/page.tsx');
  const props={params:{then(){throw new Error('Disabled route must not await parameters');}}};
  const metadata=await page.generateMetadata(props);
  assert.equal(metadata.robots.index,false);
  const html=renderToStaticMarkup(await page.default(props));
  assert.match(html,/role="status"/);
  assert.doesNotMatch(html,/<form|public_band_profiles/);
});

test('enabled public route queries only identity and returns not found for a private or absent band', async () => {
  const calls = [];
  const query = {
    select(columns) { calls.push(['select', columns]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    abortSignal() { return this; },
    async maybeSingle() { return {data:null, error:null}; },
  };
  const load = modules({
    NEXT_PUBLIC_BANDUP_PUBLIC_IDENTITY_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  }, {
    '@supabase/supabase-js': {createClient: () => ({
      from(name) { calls.push(['from', name]); return query; },
    })},
  }).load;
  const page = load('src/app/b/[slug]/page.tsx');
  await assert.rejects(page.default({params:Promise.resolve({slug:'demo'})}), /notFound/);
  assert.deepEqual(calls, [
    ['from', 'public_band_profiles'],
    ['select', 'name,slug,description,logo_url'],
    ['eq', 'slug', 'demo'],
  ]);
});

function publicLinksPage(result, events = {data: [], error: null}) {
  const calls = [];
  const environment = {
    NEXT_PUBLIC_BANDUP_PUBLIC_IDENTITY_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
  };
  const {load} = modules(environment, {
    '@supabase/supabase-js': {createClient(origin, key, options) {
      assert.equal(origin, environment.NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(key, environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
      assert.equal(options.auth.persistSession, false);
      return {from(name) {
        calls.push(['from', name]);
        assert.ok(['public_band_profiles', 'public_band_links', 'public_band_events'].includes(name));
        return {
          select(columns) { calls.push(['select', columns]); return this; },
          eq(column, value) { calls.push(['eq', column, value]); return this; },
          order(column) { calls.push(['order', column]); return this; },
          limit(limit) { calls.push(['limit', limit]); return this; },
          abortSignal() { return this; },
          async maybeSingle() {
            assert.equal(name, 'public_band_profiles');
            return {data: {slug: 'demo', name: 'Demo', description: 'Descrição pública', logo_url: null}, error: null};
          },
          then(resolve, reject) {
            return Promise.resolve(name === 'public_band_events' ? events : result).then(resolve, reject);
          },
        };
      }};
    }},
  });
  const page = load('src/app/b/[slug]/page.tsx');
  const props = {params: Promise.resolve({slug: 'demo'}), searchParams: Promise.resolve({})};
  return {calls, page, props, load};
}

test('public profile offers an explicit editor return only for a valid editor context', async () => {
  const {page, props} = publicLinksPage({data: []});
  const direct = renderToStaticMarkup(await page.default(props));
  assert.doesNotMatch(direct, /Retorno ao BandUp|Voltar ao editor/);
  const fromEditor = renderToStaticMarkup(await page.default({
    ...props, searchParams: Promise.resolve({editorBand: 'demo-band'}),
  }));
  assert.match(fromEditor, /<nav aria-label="Retorno ao BandUp"[^>]*safe-area-inset-top/);
  assert.match(fromEditor, /href="\/bandas\/demo-band\/perfil-publico"[^>]*min-h-11[^>]*focus-visible/);
  assert.match(fromEditor, /Voltar ao editor do perfil público/);
  assert.equal(fromEditor.replace(/^<nav\b.*?<\/nav>/, ''), direct);
  for (const editorBand of ['//outside.example', '../dashboard', ['demo-band', 'other-band']]) {
    assert.equal(renderToStaticMarkup(await page.default({
      ...props, searchParams: Promise.resolve({editorBand}),
    })), direct);
  }
});

test('published profile renders ordered platform links with safe external anchors and label fallbacks', async () => {
  const {calls, page, props} = publicLinksPage({error: null, data: [
    {slug: 'demo', platform: 'custom', label: null, url: 'https://example.com', position: 7},
    {slug: 'demo', platform: 'tiktok', label: 'Vídeos da banda', url: 'https://www.tiktok.com/@band', position: 5},
    {slug: 'another-band', platform: 'custom', label: 'Outro perfil', url: 'https://another.example.com', position: 6},
    {slug: 'demo', platform: 'youtube', label: null, url: 'https://youtu.be/demo', position: 4},
    {slug: 'demo', platform: 'instagram', label: '', url: 'https://www.instagram.com/demo', position: 3},
    {slug: 'demo', platform: 'spotify', label: 'Ouça a banda', url: 'https://open.spotify.com/artist/demo', position: 1},
    {slug: 'demo', platform: 'spotify', label: 'Domínio incorreto', url: 'https://unsafe.example.com', position: 2},
    {slug: 'demo', platform: 'custom', label: 'Sem HTTPS', url: 'http://unsafe.example.com', position: 8},
  ]});
  const metadata = await page.generateMetadata(props);
  assert.equal(metadata.title, 'Demo | BandUp');
  assert.ok(!calls.some(call => call.includes('public_band_links')));
  const html = renderToStaticMarkup(await page.default(props));
  assert.match(html, /<h1[^>]*>Demo<\/h1>[\s\S]*Descrição pública[\s\S]*>Explore<\/h2>[\s\S]*>Redes e plataformas<\/h2>/);
  const explore = html.match(/<section aria-labelledby="public-band-explore-heading"[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(explore);
  assert.match(explore, /grid grid-cols-2/);
  assert.match(explore, /Eventos[\s\S]*Ingressos[\s\S]*Loja[\s\S]*Músicas[\s\S]*Fotos/);
  assert.equal((explore.match(/Em breve/g) ?? []).length, 4);
  assert.match(explore, /Sem eventos públicos/);
  assert.doesNotMatch(explore, /<(a|button)\b|tabindex=/i);
  assert.match(html, /Ouça a banda[\s\S]*Spotify[\s\S]*Instagram[\s\S]*YouTube[\s\S]*Vídeos da banda[\s\S]*TikTok[\s\S]*example\.com/);
  assert.equal((html.match(/<a href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer"/g) ?? []).length, 5);
  assert.doesNotMatch(html, /another\.example\.com|unsafe\.example\.com|Outro perfil/);
  const linksQuery = calls.findIndex(([action, table]) => action === 'from' && table === 'public_band_links');
  assert.deepEqual(calls.slice(linksQuery, linksQuery + 5), [
    ['from', 'public_band_links'], ['select', 'slug,platform,label,url,position'],
    ['eq', 'slug', 'demo'], ['order', 'position'], ['limit', 8],
  ]);
});

test('public events use the same narrow ordered view for the page and preview endpoint', async () => {
  const start = '2031-02-01T21:00:00Z', end = '2031-02-01T23:00:00Z';
  const rows = [
    {slug: 'demo', id: 'b', title: 'Show de fevereiro', start_at: start, end_at: end, location: 'Local interno'},
    {slug: 'demo', id: 'a', title: 'Show de janeiro', start_at: '2031-01-01T21:00:00Z', end_at: null},
    {slug: 'other', id: 'c', title: 'Outra banda', start_at: start, end_at: null},
    {slug: 'demo', id: 'invalid', title: 'Data inválida', start_at: 'invalid', end_at: null},
  ];
  const {calls, page, props, load} = publicLinksPage({data: []}, {data: rows});
  const profile = await page.default(props);
  const html = renderToStaticMarkup(profile);
  assert.match(html, /href="#eventos"/);
  assert.match(html, /Show de janeiro[\s\S]*Show de fevereiro/);
  assert.match(html, /<time datetime="2031-02-01T23:00:00Z"/i);
  assert.doesNotMatch(html, /Local interno|Outra banda|Data inválida/);
  assert.deepEqual(calls.slice(-5), [
    ['from', 'public_band_events'], ['select', 'slug,id,title,start_at,end_at'],
    ['eq', 'slug', 'demo'], ['order', 'start_at'], ['order', 'id'],
  ]);
  const preview = load('src/app/b/[slug]/preview/route.ts');
  const previewResponse = await preview.GET(undefined, props);
  assert.equal(previewResponse.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await previewResponse.json(), JSON.parse(JSON.stringify(profile.props)));
  const missing = publicLinksPage({data: []}, {error: {code: '42P01'}});
  const unavailable = renderToStaticMarkup(await missing.page.default(missing.props));
  assert.match(unavailable, /Sem eventos públicos/);
  assert.doesNotMatch(unavailable, /id="eventos"/);
});

test('a fresh server render reads updated public profile links', async () => {
  const result = {data: [], error: null};
  const {calls, page, props} = publicLinksPage(result);
  assert.equal((await page.default(props)).props.links.length, 0);
  result.data = [{slug: 'demo', platform: 'custom', label: 'Novo site', url: 'https://example.com', position: 1}];
  const refreshed = await page.default(props);
  assert.equal(refreshed.props.links[0].label, 'Novo site');
  assert.equal(calls.filter(([action, table]) => action === 'from' && table === 'public_band_links').length, 2);
  assert.equal(page.fetchCache, 'force-no-store');
});

test('empty or failed public link requests hide the section and preserve the profile', async () => {
  for (const result of [
    {data: [], error: null},
    {data: null, error: {message: 'private backend detail'}},
  ]) {
    const {page, props} = publicLinksPage(result);
    const html = renderToStaticMarkup(await page.default(props));
    assert.match(html, /Descrição pública/);
    assert.match(html, />Explore<\/h2>/);
    assert.doesNotMatch(html, /Redes e plataformas|public-band-links-heading|private backend detail/);
  }
});

test('private profile preview starts open and can close and reopen with the shared public profile', async () => {
  const logo = 'https://example.invalid/storage/v1/object/public/band-logos/demo.webp';
  const state = ['ready', {name: 'Minha banda', slug: 'demo', is_public: false, role: 'admin'}];
  let snapshot = {
    band: {name: 'Minha banda', slug: 'demo', description: 'Biografia da banda', image: {src: logo, alt: 'Foto'}},
    events: [{id: 'event', title: 'Evento público na prévia', start_at: '2031-02-01T21:00:00Z', end_at: null}],
    links: [{platform: 'custom', position: 1, label: 'Site', url: 'https://example.com'}],
  };
  let cursor = 0;
  const effects = [], requests = [];
  let focus;
  const {load} = modules({
    NEXT_PUBLIC_BANDUP_PUBLIC_IDENTITY_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
  }, {
    react: {
      ...React,
      useEffect(effect) { effects.push(effect); },
      useState(initial) {
        const index = cursor++;
        return [index in state ? state[index] : initial, next => { state[index] = next; }];
      },
    },
  }, {
    window: {
      addEventListener(name, listener) { if (name === 'focus') focus = listener; },
      removeEventListener(name, listener) { if (name === 'focus' && focus === listener) focus = undefined; },
    },
    async fetch(url) {
      requests.push(url);
      return Response.json(snapshot, {status: snapshot ? 200 : 404});
    },
  });
  const Page = load('src/app/bandas/[bandId]/perfil-publico/page.tsx').default;
  const PublicBandLinks = load('src/components/band-public-links.tsx').default;
  const PublicBandProfile = load('src/components/public-band-profile.tsx').default;
  function renderPreview(publicPath) {
    cursor = 0;
    effects.length = 0;
    const enabled = Page();
    const tree = enabled.type(enabled.props);
    const manager = tree.props.children.props.children.find(element => element.type === PublicBandLinks);
    const details = manager.props.renderEditor([
      {id: 'private', platform: 'custom', label: 'Link do editor', url: 'https://private.example.com', position: 1},
    ], null).props.children[0].props.renderPreview(publicPath);
    const preview = details.props.children[1];
    return {details, container: preview ? preview.type(preview.props) : null};
  }
  const priv = renderPreview(null);
  assert.equal(priv.details.props.open, true);
  assert.match(renderToStaticMarkup(priv.container), /A prévia aparece quando o perfil está publicado/);
  assert.doesNotMatch(renderToStaticMarkup(priv.container), /Minha banda|Link do editor|href="\/b\/demo"/);
  effects.at(-1)();
  assert.deepEqual(requests, []);
  renderPreview('/b/demo');
  const cancelFetch = effects.at(-1)();
  await new Promise(setImmediate);
  assert.deepEqual(requests, ['/b/demo/preview']);
  const publicPreview = renderPreview('/b/demo');
  assert.equal(publicPreview.details.props.children[0].type, 'summary');
  const [publicContent, editLink] = publicPreview.container.props.children;
  const [previewLink, publicVisual] = publicContent.props.children;
  assert.equal(previewLink.props.href, '/b/demo?editorBand=demo-band');
  assert.equal(previewLink.props['aria-label'], 'Abrir página pública');
  assert.equal(previewLink.props.target, undefined);
  assert.equal(editLink.props.href, '/bandas/demo-band/perfil');
  assert.equal(editLink.props['aria-label'], 'Editar perfil');
  assert.match(editLink.props.className, /h-11 w-11.*left-1/);
  assert.match(previewLink.props.children.props.className, /h-11 w-11.*right-1/);
  const pencil = editLink.props.children, arrow = previewLink.props.children.props.children;
  for (const icon of [pencil, arrow]) {
    assert.match(icon.props.className, /h-7 w-7.*rounded-lg.*p-1.5.*focus-visible/);
    assert.equal(icon.props.children.props.className, 'h-4 w-4');
  }
  assert.equal(pencil.props.children.props.name, 'Pencil');
  assert.equal(arrow.props.children.props.name, 'ArrowUpRight');
  assert.match(publicVisual.props.className, /\[&_a\]:pointer-events-auto/);
  assert.equal(publicVisual.props.children.type, PublicBandProfile);
  const html = renderToStaticMarkup(publicVisual.props.children);
  const full = renderToStaticMarkup(React.createElement(PublicBandProfile, snapshot));
  assert.equal(html.replace(/^<div/, '<main').replace(/<\/div>$/, '</main>')
    .replace(/<(\/?)h2\b/g, '<$1h1').replace(/<(\/?)h3\b/g, '<$1h2'), full);
  assert.match(html, /Minha banda[\s\S]*Biografia da banda[\s\S]*Explore[\s\S]*Evento público na prévia[\s\S]*Redes e plataformas[\s\S]*Site/);
  assert.match(html, /grid-cols-2[\s\S]*sm:grid-cols-2/);
  assert.doesNotMatch(html, /Link do editor|private\.example\.com/);
  snapshot = {...snapshot, events: []};
  focus();
  await new Promise(setImmediate);
  assert.doesNotMatch(renderToStaticMarkup(renderPreview('/b/demo').container), /Evento público na prévia/);
  snapshot = null;
  focus();
  await new Promise(setImmediate);
  assert.doesNotMatch(renderToStaticMarkup(renderPreview('/b/demo').container), /Minha banda|href="\/b\/demo"/);
  cancelFetch();
  priv.details.props.onToggle({currentTarget: {open: false}});
  const collapsed = renderPreview('/b/demo');
  assert.equal(collapsed.details.props.open, false);
  assert.equal(collapsed.container, null);
  collapsed.details.props.onToggle({currentTarget: {open: true}});
  assert.equal(renderPreview('/b/demo').details.props.open, true);
});

test('public address starts hidden and keeps copy and share available', async () => {
  const origin = 'https://example.invalid';
  const url = origin + '/b/demo';
  const calls = [];
  let clipboardAvailable = true;
  const state = [], refs = [], dependencies = [];
  let stateIndex, refIndex, effectIndex, effects;
  const {load} = modules({NEXT_PUBLIC_BANDUP_PUBLIC_IDENTITY_ENABLED: 'true'}, {
    react: {
      ...React,
      useState(initial) {
        const index = stateIndex++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = value; }];
      },
      useRef(initial) { return refs[refIndex++] ??= {current: initial}; },
      useEffect(effect, next) {
        const index = effectIndex++;
        if (next.some((value, i) => value !== dependencies[index]?.[i]) || !dependencies[index]) {
          dependencies[index] = next;
          effects.push(effect);
        }
      },
    },
  }, {
    window: {location: {origin}},
    navigator: {
      clipboard: {async writeText(value) {
        if (!clipboardAvailable) throw new Error('Clipboard unavailable');
        calls.push(['copy', value]);
      }},
      async share({url}) { calls.push(['share', url]); },
    },
  });
  const Settings = load('src/components/band-public-profile-settings.tsx').default;
  function settings(initialSlug, initiallyPublic) {
    return Settings({bandId: 'demo', initialSlug, initiallyPublic, isAdmin: true,
      renderPreview: path => React.createElement('div', {'data-preview-destination': path}),
    });
  }
  let enabled = settings('demo', true);
  function nodes(tree) {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
  }
  function render() {
    stateIndex = refIndex = effectIndex = 0;
    effects = [];
    const tree = enabled.type(enabled.props);
    const input = nodes(tree).find(node => node.type === 'input');
    if (input) input.props.ref.current = {
      focus: () => calls.push(['focus']),
      select: () => calls.push(['select']),
    };
    effects.forEach(effect => effect());
    return tree;
  }
  const byLabel = (tree, label) => nodes(tree).find(node => node.props['aria-label'] === label);
  const settle = () => new Promise(resolve => setImmediate(resolve));

  render(); // Initialize the browser origin.
  let tree = render();
  assert.match(renderToStaticMarkup(tree), /data-preview-destination="\/b\/demo"/);
  assert.match(renderToStaticMarkup(tree), /Endereço oculto/);
  assert.doesNotMatch(renderToStaticMarkup(tree), /https:\/\/example\.invalid/);
  assert.equal(byLabel(tree, 'Visualizar perfil (abre em nova aba)'), undefined);
  byLabel(tree, 'Copiar endereço').props.onClick();
  await settle();
  byLabel(render(), 'Compartilhar').props.onClick();
  await settle();
  assert.deepEqual(calls, [['copy', url], ['share', url]]);

  tree = render();
  const show = byLabel(tree, 'Mostrar endereço público');
  assert.equal(show.props['aria-expanded'], false);
  assert.equal(show.props.children.props.name, 'Eye');
  show.props.onClick();
  tree = render();
  assert.equal(byLabel(tree, 'Endereço público').props.value, url);
  const hide = byLabel(tree, 'Ocultar endereço público');
  assert.equal(hide.props['aria-expanded'], true);
  assert.equal(hide.props.children.props.name, 'EyeOff');
  hide.props.onClick();
  assert.doesNotMatch(renderToStaticMarkup(render()), /https:\/\/example\.invalid/);

  clipboardAvailable = false;
  byLabel(render(), 'Copiar endereço').props.onClick();
  await settle();
  assert.equal(byLabel(render(), 'Endereço público').props.value, url);
  assert.deepEqual(calls.slice(-2), [['focus'], ['select']]);

  for (const [slug, published] of [['demo', false], [null, true]]) {
    state.length = refs.length = dependencies.length = 0;
    enabled = settings(slug, published);
    assert.doesNotMatch(renderToStaticMarkup(render()), /data-preview-destination/);
  }
});

test('direct publication actions refuse before authentication or queries',async()=>{
  const api=modules().load('src/lib/band-publication.ts');
  await assert.rejects(api.updateBandPublication('demo',true),{name:'PublicationDisabledError'});
  await assert.rejects(api.updateBandPublication('demo',false),{name:'PublicationDisabledError'});
  await assert.rejects(api.updateLinkPublication('demo','link',false,true),{name:'PublicationDisabledError'});
  await assert.rejects(api.updateLinkPublication('demo','link',true,false),{name:'PublicationDisabledError'});
});

test('settings route and component render unavailable without SDK access',()=>{
  const load=modules().load;
  const page=load('src/app/bandas/[bandId]/perfil-publico/page.tsx');
  const html=renderToStaticMarkup(React.createElement(page.default));
  assert.match(html,/role="status"/);assert.doesNotMatch(html,/role="switch"|public-profile-url/);
  const settings=load('src/components/band-public-profile-settings.tsx');
  const view=renderToStaticMarkup(React.createElement(settings.default,{bandId:'demo',initialSlug:'demo',initiallyPublic:true,isAdmin:true}));
  assert.doesNotMatch(view,/role="switch"|public-profile-url|target="_blank"/);
});

function legacyClient(options={}) {
  const calls=[];
  const client={from(table){
    assert.ok(['band_members','bands','social_links'].includes(table));calls.push(['from',table]);
    const q={select(fields){
      const approved={band_members:['role'],bands:['name','id, name, description'],social_links:['id, platform, url, created_at']};
      assert.ok(approved[table].includes(fields),fields);calls.push(['select',fields]);return q;
    },eq(){return q;},order(){return Promise.resolve({data:[],error:null});},
    maybeSingle:async()=>({data:table==='band_members'?(options.nonMember?null:{role:'admin'}):{id:'demo',name:'Demo',description:null},error:options.membershipError&&table==='band_members'?{}:null}),
    insert(){throw new Error('Write attempted');},update(){throw new Error('Write attempted');},delete(){throw new Error('Write attempted');}};
    return q;
  }};
  return {client,calls};
}

test('legacy overview and authenticated links need no publication columns or views',async()=>{
  const api=modules().load('src/lib/legacy-band-data.ts');
  const f=legacyClient();await api.readLegacyBandOverview(f.client,'demo');
  const result=await api.readLegacyBandLinks(f.client,'demo','user');
  assert.equal(result.status,'ready');
  assert.ok(!JSON.stringify(f.calls).includes('is_public'));
  assert.ok(!JSON.stringify(f.calls).includes('public_band_profiles'));
  const overview=fs.readFileSync(path.join(root,'src/app/bandas/[bandId]/page.tsx'),'utf8');
  assert.ok(overview.includes('await readLegacyBandOverview(supabase, bandId)'));
  assert.ok(!overview.includes('is_public'));
});

test('non-members and membership errors never reach band or link rows',async()=>{
  const api=modules().load('src/lib/legacy-band-data.ts');
  const f=legacyClient({nonMember:true});
  assert.equal((await api.readLegacyBandLinks(f.client,'demo','user')).status,'unavailable');
  assert.deepEqual(f.calls.filter(c=>c[0]==='from'),[['from','band_members']]);
  const e=legacyClient({membershipError:true});
  await assert.rejects(api.readLegacyBandLinks(e.client,'demo','user'));
  assert.deepEqual(e.calls.filter(c=>c[0]==='from'),[['from','band_members']]);
});

test('disabled link route selects read-only component and guards all retained write handlers',()=>{
  const load=modules().load;
  const page=load('src/app/bandas/[bandId]/links/page.tsx');
  const legacy=load('src/components/legacy-band-links.tsx');
  assert.equal(page.default().type,legacy.default);
  const file=fs.readFileSync(path.join(root,'src/app/bandas/[bandId]/links/page.tsx'),'utf8');
  for(const handler of ['openLinkForm','handleAddLink','handlePublicationChange','handleDeleteLink']){
    const body=file.slice(file.indexOf('function '+handler)).split('\n  }')[0];
    const guard=body.indexOf('if (!PUBLICATION_ENABLED) return;');
    assert.ok(guard>=0,handler);
    const first=body.search(/verifyAdmin\(|updateLinkPublication\(|window.confirm/);
    assert.ok(first<0||guard<first,handler);
  }
  const readonly=fs.readFileSync(path.join(root,'src/components/legacy-band-links.tsx'),'utf8');
  assert.match(readonly,/auth.getUser\(\)/);
  assert.doesNotMatch(readonly,/\.(insert|update|delete)\(|is_public|public_band_profiles|<form/);
});
