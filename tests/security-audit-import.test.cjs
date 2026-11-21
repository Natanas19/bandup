/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {importSqlEditor,LIMIT}=require('../scripts/security-audit/import-sql-editor.cjs');
const {analyze}=require('../scripts/security-audit/analyze-role.cjs');
const fixture=()=>({formatVersion:2,target:'bandup_audit_ro',targetExists:true,transactionReadOnly:true,
  serverVersionNum:170011,collectedAt:'2026-11-14T12:00:00Z',scope:'non-system-catalog-metadata',
  role:{rolname:'bandup_audit_ro',rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false},
  routines:[],sequences:[],publicAcls:[],defaultPrivileges:[],memberships:[]});
const csv=s=>'jsonb_build_object\r\n"'+s.replaceAll('"','""')+'"\r\n';
test('raw JSON, SQL Editor rows and CSV normalize to identical evidence',()=>{
  const f=fixture(),s=JSON.stringify(f);
  for(const text of [s,'\uFEFF'+s,JSON.stringify([{jsonb_build_object:f}]),JSON.stringify([{jsonb_build_object:s}]),
    csv(s),'\uFEFF'+csv(JSON.stringify(f,null,2)),csv(s).replaceAll('\r\n','\n')]){
    const result=importSqlEditor(text);assert.deepEqual(result,f);assert.deepEqual(analyze(result),analyze(f));
  }
});
test('CSV preserves escaped quotes, commas, Unicode, backslashes and JSON whitespace',()=>{
  const f=fixture();f.note='ação, "quoted" \\ path\nsecond line';
  assert.deepEqual(importSqlEditor(csv(JSON.stringify(f,null,2))),f);
});
test('ambiguous rows/columns, malformed CSV, truncation and other payloads are rejected',()=>{
  const s=JSON.stringify(fixture());
  for(const text of ['', '[]','null','{}',JSON.stringify([{a:fixture(),b:fixture()}]),JSON.stringify([fixture(),fixture()]),
    'a,b\n1,2',csv(s)+'"'+s.replaceAll('"','""')+'"', 'a\n"unterminated', 'a\n"{}"junk',
    'a\n[object Object]',csv(s.slice(0,-1)),csv('[]'),s+s,'a\rb','a\n"bad"quote"'])assert.throws(()=>importSqlEditor(text));
});
test('wrong targets/schema versions still fail closed in the analyzer after import',()=>{
  for(const patch of [{formatVersion:1},{target:'postgres'},{memberships:null}]){
    const r=analyze(importSqlEditor(csv(JSON.stringify({...fixture(),...patch}))));
    assert.equal(r.overall,'NÃO VERIFICADO');assert.ok(!r.findings.some(f=>f.status==='APROVADO'));
  }
});
test('v2 CSV and JSON preserve optional return metadata without breaking legacy exports',()=>{
  const f=fixture();f.routines=[{schema_name:'public',routine_name:'any_name',arguments:'',kind:'f',security_definer:true,
    effective_execute:true,schema_usage:true,public_execute:true,direct_execute:false,explicit_search_path:true,
    definition_fingerprint:'0'.repeat(32),return_type:'event_trigger'}];
  for(const text of [csv(JSON.stringify(f)),JSON.stringify([{jsonb_build_object:f}])]){
    const result=analyze(importSqlEditor(text));
    assert.equal(result.findings.find(x=>x.id==='direct_invocation').counts.contextOnly,1);
    assert.notEqual(result.overall,'APROVADO');
  }
  delete f.routines[0].return_type;
  assert.equal(analyze(importSqlEditor(csv(JSON.stringify(f)))).findings.find(x=>x.id==='direct_invocation').status,'NÃO VERIFICADO');
});
test('oversize imports are rejected',()=>assert.throws(()=>importSqlEditor(' '.repeat(LIMIT+1))));
test('CLI imports CSV offline, preserves input and only stores sanitized summaries',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bandup-import-test-'));const source=path.join(dir,'export.csv');
  const f=fixture();f.secret='SYNTHETIC_DO_NOT_ECHO';const content=csv(JSON.stringify(f));fs.writeFileSync(source,content);
  const env={...process.env};delete env.NODE_OPTIONS;
  const r=cp.spawnSync(process.execPath,['--require','./tests/deny-network.cjs','scripts/security-audit/analyze-role.cjs',source],
    {encoding:'utf8',env,timeout:10000,windowsHide:true});
  try{
    assert.equal(r.status,2);assert.equal(fs.readFileSync(source,'utf8'),content);
    assert.ok(!r.stdout.includes(f.secret));assert.ok(!r.stderr.includes(f.secret));
    const output=r.stdout.split(/\r?\n/).find(l=>l.startsWith('Relatórios: '));assert.ok(output);
    const out=output.slice('Relatórios: '.length);const report=fs.readFileSync(path.join(out,'report.json'),'utf8');
    assert.ok(!report.includes(f.secret));assert.equal(JSON.parse(report).overall,'NÃO VERIFICADO');
    fs.unlinkSync(path.join(out,'report.json'));fs.unlinkSync(path.join(out,'report.md'));fs.rmdirSync(out);
  } finally {fs.unlinkSync(source);fs.rmdirSync(dir);}
});
