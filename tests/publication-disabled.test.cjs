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
    vm.runInNewContext(code,{module:mod,exports:mod.exports,require:localRequire,process:{env},URL,Buffer,AbortController,
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

function publicLinksPage(result) {
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
        assert.ok(['public_band_profiles', 'public_band_links'].includes(name));
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
            assert.equal(name, 'public_band_links');
            return Promise.resolve(result).then(resolve, reject);
          },
        };
      }};
    }},
  });
  const page = load('src/app/b/[slug]/page.tsx');
  const props = {params: Promise.resolve({slug: 'demo'})};
  return {calls, page, props};
}

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
  assert.match(html, /Links da banda/);
  assert.match(html, /Ouça a banda[\s\S]*Spotify[\s\S]*Instagram[\s\S]*YouTube[\s\S]*Vídeos da banda[\s\S]*TikTok[\s\S]*example\.com/);
  assert.equal((html.match(/<a href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer"/g) ?? []).length, 5);
  assert.doesNotMatch(html, /another\.example\.com|unsafe\.example\.com|Outro perfil/);
  assert.deepEqual(calls.slice(-5), [
    ['from', 'public_band_links'], ['select', 'slug,platform,label,url,position'],
    ['eq', 'slug', 'demo'], ['order', 'position'], ['limit', 8],
  ]);
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
    assert.doesNotMatch(html, /Links da banda|public-band-links-heading|private backend detail/);
  }
});

test('private profile preview starts open and can close and reopen with the shared public profile', () => {
  const logo = 'https://example.invalid/storage/v1/object/public/band-logos/demo.webp';
  const state = ['ready', {name: 'Minha banda', slug: null, is_public: false, role: 'admin',
    description: 'Biografia da banda', logo_url: logo}];
  let cursor = 0;
  const {load} = modules({
    NEXT_PUBLIC_BANDUP_PUBLIC_IDENTITY_ENABLED: 'true',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
  }, {
    react: {
      ...React,
      useEffect() {},
      useState(initial) {
        const index = cursor++;
        return [index < state.length ? state[index] : initial, next => { state[index] = next; }];
      },
    },
  });
  const Page = load('src/app/bandas/[bandId]/perfil-publico/page.tsx').default;
  const PublicBandLinks = load('src/components/band-public-links.tsx').default;
  const PublicBandProfile = load('src/components/public-band-profile.tsx').default;
  function renderPreview() {
    cursor = 0;
    const enabled = Page();
    const tree = enabled.type(enabled.props);
    const manager = tree.props.children.props.children.find(element => element.type === PublicBandLinks);
    return manager.props.renderEditor([
      {id: 'b', platform: 'custom', label: 'Site', url: 'https://example.com', position: 5},
      {id: 'a', platform: 'spotify', label: null, url: 'https://open.spotify.com/artist/demo', position: 1},
    ], null).props.children[0].props.renderPreview;
  }
  const expanded = renderPreview()(null);
  assert.equal(expanded.type, 'details');
  assert.equal(expanded.props.open, true);
  const [privateLink, visual] = expanded.props.children[1].props.children;
  assert.equal(privateLink, null);
  const profile = visual.props.children[1];
  assert.equal(profile.type, PublicBandProfile);
  assert.equal(profile.props.preview, true);
  assert.equal(profile.props.band.image.src, logo);
  const html = renderToStaticMarkup(expanded);
  assert.match(html, /Minha banda[\s\S]*Biografia da banda[\s\S]*Spotify[\s\S]*Site/);
  assert.doesNotMatch(html, /<main|<h1/);
  const publicPreview = renderPreview()('/b/demo');
  assert.equal(publicPreview.props.children[0].type, 'summary');
  const [previewLink, publicVisual] = publicPreview.props.children[1].props.children;
  assert.equal(previewLink.props.href, '/b/demo');
  assert.equal(previewLink.props.target, '_blank');
  assert.equal(previewLink.props.rel, 'noopener noreferrer');
  assert.match(publicVisual.props.className, /\[&_a\]:pointer-events-auto/);
  assert.match(renderToStaticMarkup(publicPreview), /href="https:\/\/example\.com"/);
  expanded.props.onToggle({currentTarget: {open: false}});
  const collapsed = renderPreview()('/b/demo');
  assert.equal(collapsed.props.open, false);
  assert.doesNotMatch(renderToStaticMarkup(collapsed), /Biografia da banda|Links da banda|href="\/b\/demo"/);
  collapsed.props.onToggle({currentTarget: {open: true}});
  const reopened = renderPreview()(null);
  assert.equal(reopened.props.open, true);
  assert.equal(renderToStaticMarkup(reopened), html);
});

test('public address starts hidden and keeps copy, share and view available', async () => {
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
  assert.equal(byLabel(tree, 'Visualizar perfil (abre em nova aba)').props.href, '/b/demo');
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
