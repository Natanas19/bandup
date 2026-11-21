/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const origin = 'https://project.supabase.co';
const avatar = origin + '/storage/v1/object/public/avatars/a0000000-0000-0000-0000-000000000001/b0000000-0000-4000-8000-000000000001.webp';
function load(file,imports={}) {
  const mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {module:mod,exports:mod.exports,URL,process:{env:{NEXT_PUBLIC_SUPABASE_URL:origin}},require:name=>name in imports ? imports[name] : require(name)});
  return mod.exports;
}
const service=()=>load('src/lib/band-invitations.ts',{
  './display-name':{normalizeMemberDisplayName:value=>typeof value==='string'&&!value.includes('@')?value:null},
  './public-band-data':load('src/lib/public-band-data.ts',{
    './social-links':load('src/lib/social-links.ts'),
    './development-lab':load('src/lib/development-lab.ts'),
    '@/lib/public-link-url':load('src/lib/public-link-url.ts',{
      '@/lib/social-links':load('src/lib/social-links.ts'),
    }),
  }),
});
const [band,ref,id]=['a','b','c'].map(letter=>`${letter}0000000-0000-0000-0000-000000000001`);
const row=(status='pending')=>({invitation_id:id,band_id:band,band_name:'Banda',musician_ref:ref,status,
  created_at:'2026-11-16T12:00:00Z',decided_at:status==='pending'?null:'2026-11-16T13:00:00Z'});
test('exact SQL names/arguments/returns; narrow projections and opaque discovery',async()=>{
  const calls=[]; let response;
  const api=service().createBandInvitationService({async rpc(name,args){calls.push([name,args]);return {data:response,error:null};}});
  response=id; assert.equal(await api.send(band,ref),id);
  response='accepted'; assert.equal(await api.decide(id,'accepted'),'accepted');
  response=[{...row('superseded'),recipient_id:'PRIVATE',invited_by:'PRIVATE',email:'PRIVATE'}];
  const rows=await api.list(band,20); assert.equal(rows[0].status,'superseded'); assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
  response=[
    {display_name:'Ana',available:true,musician_ref:ref,user_id:'PRIVATE',photo_ref:avatar},
    {display_name:'Bia',available:false,musician_ref:null,photo_ref:avatar},
    {display_name:'Lia',available:true,musician_ref:ref,photo_ref:'https://external.example/avatar.webp'},
  ];
  const found=await api.discover(' Ana ',0); assert.equal(found.musicians[0].musicianRef,ref); assert.ok(!JSON.stringify(found).includes('PRIVATE'));
  assert.deepEqual(Array.from(found.musicians, musician=>musician.avatarUrl),[avatar,null,null]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['bandup_invite_musician',{p_band_id:band,p_musician_ref:ref}],
    ['bandup_decide_invitation',{p_invitation_id:id,p_decision:'accepted'}],
    ['bandup_list_invitations',{p_band_id:band,p_offset:20,p_limit:20}],
    ['bandup_discover_musicians_for_invites',{p_query:'Ana',p_offset:0,p_limit:21}],
  ]);
  response=[]; await api.list(); assert.equal(calls.at(-1)[1].p_band_id,null);
});
test('invalid inputs/responses fail closed and mutation errors are never retried',async()=>{
  let calls=0,response, failure;
  const api=service().createBandInvitationService({async rpc(){calls++;return {data:response,error:failure};}});
  await assert.rejects(()=>api.send('name',ref)); await assert.rejects(()=>api.decide(id,'approved'));
  await assert.rejects(()=>api.list(null,10020)); assert.equal(calls,0);
  for(response of [[row('unknown')],[{...row(),decided_at:'invalid'}],[{...row(),band_id:ref}]]) await assert.rejects(()=>api.list(band));
  response='accepted'; await assert.rejects(()=>api.decide(id,'rejected'));
  for(const code of ['55P03','25001','55000','54000','42501']) {
    failure={code,message:'PRIVATE'};const before=calls;
    await assert.rejects(()=>api.send(band,ref),error=>error.code===code&&!error.message.includes('PRIVATE'));
    assert.equal(calls,before+1);
  }
});
test('band selector uses existing authenticated admin membership contract only',async()=>{
  const calls=[];const query={select(value){calls.push(['select',value]);return this;},eq(...args){calls.push(['eq',...args]);return this;},
    then(resolve){return Promise.resolve({data:[{band:{id:band,name:'Banda'}},{band:null}],error:null}).then(resolve);}};
  const api=service().createBandInvitationService({auth:{getUser:async()=>({data:{user:{id:ref}},error:null})},
    from(table){calls.push(['from',table]);return query;},rpc(){throw Error('Unexpected RPC');}});
  const bands=await api.adminBands();assert.equal(bands.length,1);assert.equal(bands[0].id,band);
  assert.deepEqual(calls,[['from','band_members'],['select','band:bands!inner(id,name)'],['eq','user_id',ref],['eq','role','admin']]);
});

function harness(name,props={}) {
  const state=[],effects=[],queued=[];let cursor=0,clientCalls=0,listCalls=0,decisions=0,sendCalls=0;
  const controls={list:()=>Promise.resolve([row()]),decide:()=>Promise.resolve('accepted'),
    discover:()=>Promise.resolve({musicians:[{name:'Ana',available:true,musicianRef:ref,avatarUrl:avatar}],hasNext:false}),
    adminBands:()=>Promise.resolve([{id:band,name:'Banda'}]),send:()=>Promise.resolve(id)};
  const fakeReact={...React,useState(initial){const index=cursor++;if(!(index in state))state[index]=typeof initial==='function'?initial():initial;
    return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},
    useRef(initial){const index=cursor++;return state[index]??=( {current:initial} );},
    useEffect(fn,deps){const index=cursor++;if(!effects[index]||deps.some((dep,i)=>dep!==effects[index].deps[i])){
      queued.push(()=>{effects[index]?.cleanup?.();effects[index]={deps,cleanup:fn()};});}}};
  const real=service();
  const exports=load('src/components/band-invitations.tsx',{
    '@/components/profile-avatar':{default:({name,imageUrl})=>React.createElement('span',{'data-avatar-name':name,'data-avatar-url':imageUrl})},
    react:fakeReact,'@/lib/supabase/client':{getSupabaseBrowserClient(){clientCalls++;return {}; }},
    '@/lib/band-invitations':{...real,createBandInvitationService:()=>({
      list(...args){listCalls++;return controls.list(...args);},decide(...args){decisions++;return controls.decide(...args);},
      discover:(...args)=>controls.discover(...args),adminBands:()=>controls.adminBands(),send(...args){sendCalls++;return controls.send(...args);},
    })},
  });
  return {controls,get listCalls(){return listCalls;},get clientCalls(){return clientCalls;},get decisions(){return decisions;},get sendCalls(){return sendCalls;},
    render(){cursor=0;let tree=exports[name](props);while(typeof tree?.type==='function')tree=tree.type(tree.props);while(queued.length)queued.shift()();return tree;},
    unmount(){effects.forEach(effect=>effect?.cleanup?.());}};
}
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);
  if(typeof tree.type==='function')return nodes(tree.type(tree.props));return [tree,...nodes(tree.props?.children)];}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const button=(tree,text)=>nodes(tree).find(node=>node.type==='button'&&node.props.children===text);
test('received loading/empty/error/retry, confirmation, success and completed states',async()=>{
  const h=harness('BandInvitations');assert.ok(nodes(h.render()).some(n=>n.props?.children==='Carregando convites...'));await settle();
  let tree=h.render();button(tree,'Aceitar convite').props.onClick();tree=h.render();
  button(tree,'Confirmar').props.onClick();button(tree,'Confirmar').props.onClick();assert.equal(h.decisions,1);
  h.controls.list=()=>Promise.resolve([row('accepted')]);await settle();h.render();await settle();tree=h.render();
  assert.ok(!button(tree,'Aceitar convite'));assert.ok(nodes(tree).some(n=>n.props?.children==='Aceito'));
  h.controls.list=()=>Promise.resolve([row('superseded')]);button(tree,'Atualizar convites').props.onClick();h.render();await settle();tree=h.render();
  assert.ok(nodes(tree).some(n=>n.props?.children==='Encerrado pela entrada na banda'));assert.ok(!button(tree,'Aceitar convite'));
  h.controls.list=()=>Promise.reject({code:'55P03'});button(tree,'Atualizar convites').props.onClick();h.render();await settle();tree=h.render();
  assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));
  h.controls.list=()=>Promise.resolve([]);button(tree,'Atualizar convites').props.onClick();h.render();await settle();
  assert.ok(nodes(h.render()).some(n=>n.props?.children==='Nenhum convite nesta página.'));h.unmount();
});
test('already completed decision refreshes without retry; sent list has no decision controls or private refs',async()=>{
  const h=harness('BandInvitations');h.render();await settle();button(h.render(),'Recusar convite').props.onClick();
  h.controls.decide=()=>Promise.reject({code:'55000'});h.controls.list=()=>Promise.resolve([row('superseded')]);
  button(h.render(),'Confirmar').props.onClick();await settle();h.render();await settle();const tree=h.render();
  assert.equal(h.decisions,1);assert.ok(nodes(tree).some(n=>n.props?.role==='alert'));assert.ok(!button(tree,'Aceitar convite'));
  const sent=harness('BandInvitations',{bandId:band});sent.render();await settle();const sentTree=sent.render();
  assert.ok(!button(sentTree,'Aceitar convite'));assert.ok(!JSON.stringify(sentTree).includes(ref));
});
function submitSearch(h, name = 'Ana') {
  nodes(h.render()).find(node => node.type === 'input').props.onChange({target:{value:name}});
  nodes(h.render()).find(node => node.type === 'form').props.onSubmit({preventDefault(){}});
  return h.render();
}
test('discovery waits for a nonblank submission and renders the avatar fallback', async () => {
  const api=service().createBandInvitationService({rpc(){assert.fail('Blank search reached RPC');}});
  for(const query of ['', '   ']) await assert.rejects(api.discover(query), {code:'22023'});
  const h=harness('MusicianInvitationDiscovery');const calls=[];
  let failSearch=true;
  h.controls.discover=(...args)=>{calls.push(args);return failSearch?Promise.reject(Error('private')):Promise.resolve({musicians:[{name:'Ana',available:true,musicianRef:ref}],hasNext:false});};
  h.controls.adminBands=()=>{calls.push('bands');return Promise.resolve([]);};
  assert.ok(nodes(h.render()).some(n=>n.props?.children==='Digite um nome para buscar músicos.'));
  submitSearch(h,'   ');
  nodes(h.render()).find(n=>n.type==='input').props.onChange({target:{value:' Ana '}});
  h.render();assert.deepEqual(calls,[]);
  submitSearch(h,' Ana ');
  assert.ok(nodes(h.render()).some(n=>n.props?.children==='Carregando músicos...'));
  await settle();assert.deepEqual(calls,[['Ana',0],'bands']);
  assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'));
  failSearch=false;
  button(h.render(),'Tentar novamente').props.onClick();h.render();await settle();
  assert.ok(nodes(h.render()).some(n=>n.props?.['data-avatar-name']==='Ana'));
  h.controls.discover=()=>Promise.resolve({musicians:[],hasNext:false});submitSearch(h,'Bia');await settle();
  assert.ok(nodes(h.render()).some(n=>n.props?.children==='Nenhum músico encontrado.'));
});
test('discovery sends once, blocks uncertain mutations, reconciles by read only',async()=>{
  const h=harness('MusicianInvitationDiscovery');submitSearch(h);await settle();let tree=h.render();
  assert.ok(button(tree,'Convidar músico'));h.controls.send=()=>Promise.reject({code:'25001'});
  button(tree,'Convidar músico').props.onClick();button(tree,'Convidar músico').props.onClick();await settle();tree=h.render();
  assert.equal(h.sendCalls,1);assert.equal(button(tree,'Convidar músico').props.disabled,true);
  button(tree,'Atualizar convites enviados').props.onClick();await settle();tree=h.render();
  assert.equal(h.sendCalls,1);assert.ok(button(tree,'Convite enviado'));assert.equal(button(tree,'Convite enviado').props.disabled,true);
});
test('discovery confirms successful send, hides actions for non-admin, and ignores stale reads',async()=>{
  const h=harness('MusicianInvitationDiscovery');submitSearch(h);await settle();
  button(h.render(),'Convidar músico').props.onClick();await settle();let tree=h.render();
  assert.equal(h.sendCalls,1);assert.ok(button(tree,'Convite enviado'));assert.ok(nodes(tree).some(n=>n.props?.role==='status'));
  const ordinary=harness('MusicianInvitationDiscovery');ordinary.controls.adminBands=()=>Promise.resolve([]);
  submitSearch(ordinary);await settle();assert.ok(!button(ordinary.render(),'Convidar músico'));
  const stale=harness('MusicianInvitationDiscovery');let resolveOld;
  stale.controls.discover=()=>new Promise(resolve=>{resolveOld=resolve;});submitSearch(stale,'Antiga');
  stale.controls.discover=()=>Promise.resolve({musicians:[{name:'Nova',available:false,musicianRef:null}],hasNext:false});
  submitSearch(stale,'Nova');await settle();
  resolveOld({musicians:[{name:'Antiga',available:true,musicianRef:ref}],hasNext:false});await settle();tree=stale.render();
  assert.ok(nodes(tree).some(n=>n.props?.children==='Nova'));assert.ok(!nodes(tree).some(n=>n.props?.children==='Antiga'));
  stale.unmount();
});
test('UI identifies per-card actions, exposes processing and provides narrow-layout/focus safeguards',async()=>{
  const received=harness('BandInvitations');
  const longName='Banda'.repeat(60);received.controls.list=()=>Promise.resolve([{...row(),band_name:longName}]);
  received.render();await settle();let tree=received.render();
  assert.equal(button(tree,'Aceitar convite').props['aria-label'],`Aceitar convite de ${longName}`);
  assert.equal(button(tree,'Recusar convite').props['aria-label'],`Recusar convite de ${longName}`);
  assert.ok(tree.props.className.includes('[overflow-wrap:anywhere]'));
  assert.ok(tree.props.className.includes('min-w-0'));
  const discovery=harness('MusicianInvitationDiscovery');submitSearch(discovery);await settle();tree=discovery.render();
  assert.ok(nodes(tree).some(n=>n.props?.['data-avatar-url']===avatar));
  assert.equal(button(tree,'Convidar músico').props['aria-label'],'Convidar Ana');
  for(const control of nodes(tree).filter(n=>n.type==='input'||n.type==='select')) {
    assert.ok(control.props.className.includes('min-w-0'));assert.ok(control.props.className.includes('focus-visible:ring-4'));
  }
  assert.ok(nodes(tree).find(n=>n.type==='nav').props.className.includes('flex-wrap'));
  let resolveSend;discovery.controls.send=()=>new Promise(resolve=>{resolveSend=resolve;});
  button(tree,'Convidar músico').props.onClick();tree=discovery.render();
  assert.ok(nodes(tree).some(n=>n.props?.role==='status'&&n.props.children==='Processando convite...'));
  assert.equal(button(tree,'Convidar músico').props.disabled,true);
  resolveSend(id);await settle();assert.ok(button(discovery.render(),'Convite enviado'));discovery.unmount();
});
test('dashboard invitations are independent of band count and sent list stays admin-only',()=>{
  const source=ts.createSourceFile('dashboard.tsx',fs.readFileSync('src/app/dashboard/page.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let invitation;
  function visit(node){if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='BandInvitations')invitation=node;ts.forEachChild(node,visit);}
  visit(source);assert.ok(invitation);const conditions=[];
  for(let node=invitation.parent;node;node=node.parent) {
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken)conditions.push(node.left.getText(source));
    if(ts.isConditionalExpression(node))conditions.push(node.condition.getText(source));
  }
  assert.ok(conditions.every(condition=>!condition.includes('bands')));
  const members=fs.readFileSync('src/app/bandas/[bandId]/membros/page.tsx','utf8');
  assert.match(members,/\{isAdmin && <BandInvitations[^>]*bandId=\{bandId\}/);
});
