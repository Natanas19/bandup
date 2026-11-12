/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const origin = 'https://project.supabase.co';
function load(file) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: mod, exports: mod.exports, URL, process: { env: { NEXT_PUBLIC_SUPABASE_URL: origin } },
    require(name) { return name.startsWith('.') ? load(path.resolve(path.dirname(file),name+'.ts')) : require(name); } });
  return mod.exports;
}
const { loadMemberAvatars } = load('src/lib/member-avatars.ts');
const photo = id => `${origin}/storage/v1/object/public/avatars/${id}/11111111-1111-4111-8111-111111111111.png`;
test('photos map by ID, reject foreign rows/URLs and use no per-member queries', async () => {
  const calls = [];
  const ids = ['a','b','c','d','e','f','g'];
  const client = { async rpc(name,args) {
    calls.push({name,args});
    return { data: [
      { user_id:'g',avatar_url:photo('g') }, { user_id:'a',avatar_url:photo('a') },
      { user_id:'b',avatar_url:null }, { user_id:'c',avatar_url:'not-a-url' },
      { user_id:'d',avatar_url:'https://evil.example/a.png' },
      { user_id:'e',avatar_url:photo('other') },
      { user_id:'f',avatar_url:photo('f').replace('/avatars/','/band-logos/') },
      { user_id:'foreign',avatar_url:photo('foreign') },
    ], error:null };
  } };
  const result = await loadMemberAvatars(client,'band',ids);
  assert.deepEqual(JSON.parse(JSON.stringify([...result])), [['g',photo('g')],['a',photo('a')]]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{name:'bandup_member_avatars',args:{p_band_id:'band',p_user_ids:ids}}]);
});
test('batches contain at most 20 loaded unique IDs; one failed batch does not lose others', async () => {
  const ids = Array.from({length:45},(_,i)=>String(i)), calls = [];
  const client = { async rpc(_name,args) {
    calls.push(args);
    if (args.p_user_ids[0]==='20') return {error:{code:'42501'},data:null};
    return {error:null,data:args.p_user_ids.slice().reverse().map(id=>({user_id:id,avatar_url:photo(id)}))};
  } };
  const result = await loadMemberAvatars(client,'band',[...ids,'0']);
  assert.deepEqual(calls.map(c=>c.p_user_ids.length),[20,20,5]);
  assert.deepEqual(calls.flatMap(c=>c.p_user_ids),ids);
  assert.equal(result.size,25); assert.equal(result.get('44'),photo('44')); assert.equal(result.has('20'),false);
});
test('empty lists do not call RPC; rejected, missing or malformed responses fall back', async () => {
  const never = {rpc(){throw Error('must not call');}};
  assert.equal((await loadMemberAvatars(never,'band',[])).size,0);
  for (const rpc of [async()=>{throw Error('network');},async()=>({error:{code:'42883'}}),async()=>({data:{avatar_url:'bad'}})]) {
    assert.equal((await loadMemberAvatars({rpc},'band',['a'])).size,0);
  }
});
test('ProfileAvatar preserves initials and switches to them on image failure', () => {
  const React = require('react'); const slots=[];let cursor=0;
  const hooks={...React,useEffect(){},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=v;}];}};
  const mod={exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/components/profile-avatar.tsx','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{module:mod,exports:mod.exports,require(name){if(name==='react')return hooks;if(name==='next/image')return{__esModule:true,default:'image'};return require(name);}});
  const Avatar=mod.exports.default;const render=props=>{cursor=0;return Avatar(props);};
  assert.equal(render({name:'Ana Silva',imageUrl:null}).props.children,'AS');
  const props={name:'Ana Silva',imageUrl:photo('a')};render(props).props.children.props.onError();
  assert.equal(render(props).props.children,'AS');
});
