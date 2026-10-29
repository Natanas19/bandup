/* eslint-disable @typescript-eslint/no-require-imports */
// Local production-server smoke test only. No Supabase connection is permitted.
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname,'..');
const origin = 'http://127.0.0.1:3105';
process.env.BANDUP_TEST_HTTP_ORIGIN = origin;
require('./deny-network.cjs');
async function main() {
  await new Promise((resolve,reject)=>{
    const probe=net.createServer();probe.once('error',reject);
    probe.listen(3105,'127.0.0.1',()=>probe.close(resolve));
  });
  const env={...process.env,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED:'false',
    NEXT_PUBLIC_SUPABASE_URL:'https://build-only.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_build_only',
    NODE_OPTIONS:'--require='+path.join(root,'tests/deny-network.cjs'),BANDUP_TEST_HTTP_ORIGIN:origin};
  delete env.SUPABASE_INTERNAL_URL;
  const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p','3105'],
    {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stdout.on('data',data=>{output+=data.toString();});
  child.stderr.on('data',data=>{output+=data.toString();});
  try {
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error('Local server startup timeout'));},30000);
      const poll=setInterval(()=>{
        if(output.includes('Ready in')) {clearInterval(poll);clearTimeout(timeout);resolve();}
        else if(child.exitCode!==null) {clearInterval(poll);clearTimeout(timeout);reject(new Error('Local server exited before ready'));}
      },100);
      child.once('error',error=>{clearInterval(poll);clearTimeout(timeout);reject(error);});
    });
    for(const route of ['/b/release-test','/b/another-slug']) {
      const response=await fetch(origin+route,{headers:{Connection:'close'}});
      assert.equal(response.status,200);
      const html=await response.text();
      assert.ok(html.includes('Perfil público temporariamente indisponível'));
      assert.ok(html.includes('noindex'));
    }
    assert.ok(!output.includes('BANDUP_NETWORK_BLOCKED'),'Unexpected outgoing network attempt');
    console.log('PASS: production public route + metadata render unavailable, HTTP 200, noindex; zero external network attempts.');
  } finally {
    if(child.exitCode===null) {
      const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;
    }
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
