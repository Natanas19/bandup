/* eslint-disable @typescript-eslint/no-require-imports */
// Independent React preview. Does not launch Next, load .env or write build files.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const ts=require('typescript');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const component=path.join(root,'src/components/band-invitations.tsx');
const entry=path.join(root,'tests/visual/invitations-entry.cjs');
const fixture=path.join(root,'tests/visual/invitations-fixtures.cjs');
const port=4318;
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'none'; font-src 'none'; worker-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const html='<!doctype html><html lang="pt-BR" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia isolada · Convites BandUp</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>';
function normalize(value){return path.resolve(value).replaceAll('\\','/').toLowerCase();}
async function prepare(){
  if(process.env.NODE_ENV==='production')throw Error('Invitation preview is disabled in production');
  const assets=new Map();
  const output=path.join(root,'.next','invitations-memory-preview');
  const webpack=require('next/dist/compiled/webpack/webpack');webpack.init();
  const compiler=webpack.webpack({
    mode:'development',devtool:false,cache:false,context:root,entry,
    output:{path:output,filename:'preview.js'},
    optimization:{concatenateModules:false,minimize:false},
    resolve:{alias:{
      '@/components/band-invitations$':component,
      '@/lib/band-invitations$':fixture,
      '@/lib/supabase/client$':fixture,
    }},
    module:{rules:[{test:/band-invitations\.tsx$/,use:[{loader:__filename}]}]},
  });
  // Compilation output stays in RAM; no generated fourth file or disk cache.
  compiler.outputFileSystem={
    mkdir(_directory,...args){args.at(-1)(null);},
    writeFile(file,data,...args){assets.set(path.basename(file),Buffer.from(data));args.at(-1)(null);},
    stat(_file,callback){callback(Object.assign(new Error('Not emitted yet'),{code:'ENOENT'}));},
    readFile(file,callback){const value=assets.get(path.basename(file));callback(value?null:Object.assign(new Error('Missing asset'),{code:'ENOENT'}),value);},
  };
  let stats;
  try{
    stats=await new Promise((resolve,reject)=>compiler.run((error,result)=>error?reject(error):resolve(result)));
    if(stats.hasErrors())throw Error(stats.toString({all:false,errors:true}));
    const allowed=new Set([component,entry,fixture].map(normalize));
    const dependencies=[];
    for(const bundledModule of stats.compilation.modules){
      if(bundledModule.externalType)throw Error('External module forbidden in preview');
      if(!bundledModule.resource){if(bundledModule.identifier().startsWith('webpack/runtime/'))continue;throw Error('Unidentified bundle module: '+bundledModule.identifier());}
      const resource=normalize(bundledModule.resource);dependencies.push(resource);
      if(!allowed.has(resource)&&!/(^|\/)node_modules\/(react|react-dom|scheduler)\//.test(resource))
        throw Error('Non-allowlisted dependency; refusing server: '+resource);
    }
    for(const required of allowed)assert.ok(dependencies.includes(required),'Required preview module missing');
    assert.ok(assets.has('preview.js'),'Missing JS bundle');
  }finally{await new Promise((resolve,reject)=>compiler.close(error=>error?reject(error):resolve()));}
  const config=require('tailwindcss/loadConfig')(path.join(root,'tailwind.config.ts'));
  // Reuse design tokens and scan only source/preview code, never configuration secrets.
  const css=await require('postcss')([
    require('tailwindcss')({...config,content:[path.join(root,'src/**/*.{js,ts,jsx,tsx,mdx}'),entry]}),require('autoprefixer'),
  ]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});
  if(/@import\b|url\s*\(/i.test(css.css))throw Error('CSS resource reference forbidden; refusing server');
  assets.set('preview.css',Buffer.from(css.css));
  console.log('Compilation/isolation OK: real components + React + memory fixtures only; build artifacts remain in RAM.');
  return assets;
}
function createServer(assets){
  // Snapshot only the three allowed responses; never resolve request paths on disk.
  const responses=new Map([['/',['text/html; charset=utf-8',Buffer.from(html)]],
    ['/preview.js',['text/javascript; charset=utf-8',assets.get('preview.js')]],
    ['/preview.css',['text/css; charset=utf-8',assets.get('preview.css')]]]);
  assert.ok(responses.get('/preview.js')[1]&&responses.get('/preview.css')[1],'Unverified assets');
  return http.createServer((request,response)=>{
    response.setHeader('Content-Security-Policy',CSP);response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    const expectedHost=`127.0.0.1:${request.socket.localPort}`;
    if(request.socket.remoteAddress!=='127.0.0.1'||request.headers.host!==expectedHost||request.method!=='GET'){
      response.writeHead(403);response.end();return;
    }
    if(!responses.has(request.url)){response.writeHead(404);response.end();return;}
    const [type,body]=responses.get(request.url);response.setHeader('Content-Type',type);response.end(body);
  });
}
async function verify(assets){
  // Specific compilation/isolation checks only. No application/DB tests.
  const fixtures=require(fixture);const client=fixtures.getSupabaseBrowserClient();
  assert.throws(()=>client.rpc(),/forbidden/i);assert.throws(()=>client.auth.getUser(),/forbidden/i);
  fixtures.reset('pending','received');
  const firstService=fixtures.createBandInvitationService(client);
  assert.deepEqual(await firstService.adminBands(),[]);
  const before=await firstService.list();
  assert.ok(before.every(row=>row.status==='pending'));
  await firstService.decide(before[0].invitation_id,'accepted');
  assert.equal((await firstService.list())[0].status,'accepted');
  await firstService.decide(before[1].invitation_id,'rejected');
  assert.equal((await firstService.list())[1].status,'rejected');
  fixtures.reset('pending','received');
  assert.equal((await fixtures.createBandInvitationService(client).list())[0].status,'pending');
  console.log('Memory isolation OK: received without bands; accept/reject/reset do not persist.');
  const server=createServer(assets);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  function request(url,method='GET',host){return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers:host?{Host:host}:{}},res=>{
      res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});req.on('error',reject);req.end();
  });}
  try{
    for(const url of ['/','/preview.js','/preview.css']){
      const response=await request(url);assert.equal(response.status,200);assert.ok(response.headers['content-security-policy'].includes("connect-src 'none'"));
    }
    for(const url of ['/api/rpc','/rest/v1/rpc/test','/.env','/../package.json','/preview.js?other'])assert.equal((await request(url)).status,404);
    assert.equal((await request('/','POST')).status,403);assert.equal((await request('/','GET','other.example')).status,403);
    assert.equal(server.address().address,'127.0.0.1');
    console.log('Isolation checks OK: loopback only, strict assets/Host/GET, CSP, no RPC/Auth endpoint.');
  }finally{await new Promise(resolve=>server.close(resolve));}
}
async function main(){
  if(process.argv.slice(2).some(arg=>!['--check','--verify'].includes(arg)))throw Error('Only --check or --verify supported');
  const assets=await prepare();
  if(process.argv.includes('--verify')){await verify(assets);return;}
  if(process.argv.includes('--check'))return;
  const server=createServer(assets);server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`Open http://127.0.0.1:${port}/ — memory-only simulation. Ctrl+C stops preview.`));
}
// This same source acts as the in-memory TSX loader; no extra loader file needed.
module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;};
module.exports.prepare=prepare;module.exports.createServer=createServer;
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
