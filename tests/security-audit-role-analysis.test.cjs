/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyze}=require('../scripts/security-audit/analyze-role.cjs');
function fixture(){return {formatVersion:2,target:'bandup_audit_ro',targetExists:true,transactionReadOnly:true,
  serverVersionNum:170011,collectedAt:'2026-11-14T12:00:00Z',scope:'non-system-catalog-metadata',
  role:{rolname:'bandup_audit_ro',rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false},
  routines:[],sequences:[],publicAcls:[],defaultPrivileges:[],memberships:[]};}
const finding=(r,id)=>r.findings.find(x=>x.id===id);
test('empty evidence never becomes a global security approval',()=>{
  const r=analyze(fixture());assert.equal(r.overall,'NÃO VERIFICADO');
  for(const id of ['execute','security_definer','public','sequences','default_privileges'])assert.equal(finding(r,id).status,'NÃO VERIFICADO');
});
test('missing, mistyped, wrong-version and wrong-target JSON fails closed',()=>{
  for(const patch of [{routines:null},{sequences:[{}]},{target:'postgres'},{formatVersion:1},{role:null},{serverVersionNum:180001},{targetExists:false}]){
    const r=analyze({...fixture(),...patch});assert.equal(r.overall,'NÃO VERIFICADO');assert.ok(!r.findings.some(f=>f.status==='APROVADO'));
  }
});
test('legacy definer without return metadata remains unverified, without name inference',()=>{
  const f=fixture();f.routines=[{schema_name:'private',routine_name:'sensitive',arguments:'',kind:'f',security_definer:true,
    effective_execute:true,schema_usage:false,public_execute:true,direct_execute:false,explicit_search_path:true,definition_fingerprint:'0'.repeat(32)}];
  const r=analyze(f);assert.equal(finding(r,'execute').status,'ALERTA');assert.equal(finding(r,'security_definer').status,'NÃO VERIFICADO');
  assert.equal(finding(r,'direct_invocation').status,'NÃO VERIFICADO');
});
function routine(patch={}) {return {schema_name:'public',routine_name:'any_name',arguments:'',kind:'f',security_definer:true,
  effective_execute:true,schema_usage:true,public_execute:true,direct_execute:false,explicit_search_path:true,
  definition_fingerprint:'0'.repeat(32),...patch};}
test('trigger and event_trigger are context-only irrespective of name, with coverage pending',()=>{
  for(const return_type of ['trigger','event_trigger','pg_catalog.event_trigger']){
    const f=fixture();f.routines=[routine({return_type})];const r=analyze(f);
    assert.equal(finding(r,'direct_invocation').counts.contextOnly,1);
    assert.equal(finding(r,'direct_invocation').counts.directCandidates,0);
    assert.equal(finding(r,'security_definer').status,'APROVADO');
    assert.equal(finding(r,'contextual_invocation').status,'NÃO VERIFICADO');
    assert.equal(finding(r,'coverage').status,'NÃO VERIFICADO');assert.notEqual(r.overall,'APROVADO');
  }
});
test('ordinary return with known event-trigger name is still a direct candidate',()=>{
  const f=fixture();f.routines=[routine({routine_name:'rls_auto_enable',return_type:'integer'})];
  const r=analyze(f);assert.equal(finding(r,'direct_invocation').status,'ALERTA');
  assert.equal(finding(r,'security_definer').counts.directCandidates,1);
});
test('schema USAGE and EXECUTE are independent prerequisites for direct candidates',()=>{
  const f=fixture();f.routines=[routine({return_type:'integer',schema_usage:false}),routine({return_type:'void',effective_execute:false})];
  const r=analyze(f);assert.equal(finding(r,'execute').counts.executable,1);
  assert.equal(finding(r,'execute').counts.withSchemaUsage,0);assert.equal(finding(r,'direct_invocation').counts.directCandidates,0);
});
test('mixed missing, null or invalid return metadata never gets an inferred approval',()=>{
  for(const return_type of [undefined,null,42,'']){
    const f=fixture();f.routines=[routine({return_type:'event_trigger'}),routine({return_type})];
    if(return_type===undefined)delete f.routines[1].return_type;
    const r=analyze(f);assert.ok(r.findings.some(x=>x.status==='NÃO VERIFICADO'));
    assert.ok(!r.findings.some(x=>['direct_invocation','security_definer'].includes(x.id)&&x.status==='APROVADO'));
  }
});
test('PUBLIC, sequence mutation, SET ROLE and future defaults produce alerts',()=>{
  const f=fixture();f.publicAcls=[{kind:'schema',object_name:'public',privilege_type:'CREATE',is_grantable:false}];
  f.sequences=[{schema_name:'public',sequence_name:'seq',schema_usage:false,effective_select:false,effective_usage:true,effective_update:false,public_acl:[]}];
  f.memberships=[{granted_role:'other',available_now:false,can_set_role:true}];
  f.defaultPrivileges=[{creating_role:'owner',schema_scope:'(global)',object_type:'f',privilege_type:'EXECUTE',is_grantable:false,
    granted_to_public:true,granted_directly_to_auditor:false,available_now:true,membership_path:true}];
  const r=analyze(f);for(const id of ['public','sequences','memberships','default_privileges'])assert.equal(finding(r,id).status,'ALERTA');
});
test('raw identifiers and extra secret fields are never copied into summaries',()=>{
  const f=fixture();f.password='DO_NOT_PRINT';f.publicAcls=[{kind:'schema',object_name:'DO_NOT_PRINT',privilege_type:'CREATE',is_grantable:false}];
  assert.ok(!JSON.stringify(analyze(f)).includes('DO_NOT_PRINT'));
});
test('unexpected LOGIN or privileged role attributes are alerts, not permission to proceed',()=>{
  const f=fixture();f.role.rolcanlogin=true;f.role.rolbypassrls=true;
  assert.equal(finding(analyze(f),'role').status,'ALERTA');
});
