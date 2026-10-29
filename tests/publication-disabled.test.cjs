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
function modules(env={},overrides={}) {
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
      setTimeout,clearTimeout,fetch:unexpected},{filename:file});
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

test('server reader refuses before credentials, SDK creation or network',async()=>{
  const env=new Proxy({}, {get:(_,key)=>{
    if(key==='NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED')return undefined;
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
