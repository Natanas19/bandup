/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {importSqlEditor,LIMIT} = require('./import-sql-editor.cjs');
const BOOL = v => typeof v === 'boolean';
const TEXT = v => typeof v === 'string' && v.length <= 4096;
const schemas = {
  routines:{schema_name:TEXT,routine_name:TEXT,arguments:TEXT,kind:v=>['f','p','w'].includes(v),security_definer:BOOL,
    effective_execute:BOOL,schema_usage:BOOL,public_execute:BOOL,direct_execute:BOOL,explicit_search_path:BOOL,
    definition_fingerprint:v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v)},
  sequences:{schema_name:TEXT,sequence_name:TEXT,schema_usage:BOOL,effective_select:BOOL,effective_usage:BOOL,effective_update:BOOL,
    public_acl:v=>Array.isArray(v)&&v.every(a=>object(a)&&['SELECT','USAGE','UPDATE'].includes(a.privilege)&&BOOL(a.grantable))},
  publicAcls:{kind:v=>['database','schema','sequence','relation','column'].includes(v),object_name:TEXT,privilege_type:TEXT,is_grantable:BOOL},
  defaultPrivileges:{creating_role:TEXT,schema_scope:TEXT,object_type:v=>['r','S','f','T','n'].includes(v),privilege_type:TEXT,
    is_grantable:BOOL,granted_to_public:BOOL,granted_directly_to_auditor:BOOL,available_now:BOOL,membership_path:BOOL},
  memberships:{granted_role:TEXT,available_now:BOOL,can_set_role:BOOL},
};
function object(v) {return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function shape(v,s) {return object(v)&&Object.entries(s).every(([k,check])=>Object.hasOwn(v,k)&&check(v[k]));}
function invocationCounts(rows) {
  const known = rows.filter(r=>typeof r.return_type==='string'&&r.return_type.trim()!=='');
  const contextual = known.filter(r=>['trigger','event_trigger','pg_catalog.trigger','pg_catalog.event_trigger'].includes(r.return_type));
  return {unknownReturn:rows.length-known.length,
    contextOnly:contextual.length,
    withoutSchemaUsage:rows.filter(r=>!r.schema_usage).length,
    directCandidates:known.filter(r=>r.schema_usage&&!contextual.includes(r)&&r.kind!=='w').length,
    windowContext:known.filter(r=>r.kind==='w'&&!contextual.includes(r)).length};
}
function analyze(input) {
  const findings=[];
  const add=(id,status,detail,counts={})=>findings.push({id,status,detail,counts});
  const finish=()=>({formatVersion:1,scope:'Análise offline de evidência fornecida; não certifica segurança completa nem origem do servidor.',
    overall:findings.some(f=>f.status==='ALERTA')?'ALERTA':'NÃO VERIFICADO',findings});
  if (!object(input)||input.formatVersion!==2||input.target!=='bandup_audit_ro'||!BOOL(input.targetExists)||
    !BOOL(input.transactionReadOnly)||!Number.isInteger(input.serverVersionNum)||!TEXT(input.collectedAt)||
    !Number.isFinite(Date.parse(input.collectedAt))||input.scope!=='non-system-catalog-metadata') {
    add('input','NÃO VERIFICADO','Formato, versão, alvo ou metadados incompletos/inválidos. Nenhum dado bruto foi reproduzido.');return finish();
  }
  for(const [key,schema] of Object.entries(schemas)) {
    if(!Array.isArray(input[key])||input[key].length>100000||!input[key].every(row=>shape(row,schema))) {
      add('input','NÃO VERIFICADO','Seção ausente, malformada ou acima do limite; relatório recusado integralmente.');return finish();
    }
  }
  if(input.routines.some(r=>Object.hasOwn(r,'return_type')&&r.return_type!==null&&
    (!TEXT(r.return_type)||!r.return_type.trim()))) {
    add('input','NÃO VERIFICADO','Tipo de retorno malformado; relatório recusado integralmente.');return finish();
  }
  if(input.serverVersionNum<170000||input.serverVersionNum>=180000){add('postgres_version','NÃO VERIFICADO','Evidência fora de PostgreSQL 17.');return finish();}
  if(!input.targetExists){add('role','NÃO VERIFICADO','Role alvo ausente; seções vazias não comprovam ausência de permissões.');return finish();}
  const roleSchema={rolname:v=>v==='bandup_audit_ro',rolcanlogin:BOOL,rolsuper:BOOL,rolcreatedb:BOOL,rolcreaterole:BOOL,rolreplication:BOOL,rolbypassrls:BOOL};
  if(!shape(input.role,roleSchema)){add('role','NÃO VERIFICADO','Atributos da role incompletos.');return finish();}
  add('read_only',input.transactionReadOnly?'APROVADO':'ALERTA','Modo de coleta informado pelo JSON; autenticidade não verificada.');
  const privileged=['rolcanlogin','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].filter(k=>input.role[k]).length;
  add('role',privileged?'ALERTA':'APROVADO','Critério limitado: NOLOGIN e ausência dos atributos administrativos informados.',{unexpectedAttributes:privileged});
  const r=input.routines,exec=r.filter(x=>x.effective_execute),def=r.filter(x=>x.security_definer&&x.effective_execute);
  add('execute',!r.length?'NÃO VERIFICADO':exec.length?'ALERTA':'APROVADO','EXECUTE efetivo exige revisão semântica; falta de USAGE não exclui caminhos indiretos.',
    {inventoried:r.length,executable:exec.length,withSchemaUsage:exec.filter(x=>x.schema_usage).length,publicExecutable:r.filter(x=>x.public_execute).length});
  const invocation=invocationCounts(exec),defInvocation=invocationCounts(def);
  add('direct_invocation',!r.length||invocation.unknownReturn?'NÃO VERIFICADO':invocation.directCandidates?'ALERTA':'APROVADO',
    'Triagem da rota direta: exige EXECUTE e USAGE; trigger/event_trigger requerem contexto especial. Candidato não comprova chamada bem-sucedida ou explorabilidade; argumentos, pseudotipos e dependências não foram validados.',invocation);
  add('security_definer',!r.length||defInvocation.unknownReturn?'NÃO VERIFICADO':defInvocation.directCandidates?'ALERTA':'APROVADO',
    'Critério limitado à rota direta dos definers inventariados. Retorno ausente não é inferido pelo nome; search_path explícito não prova segurança e caminhos indiretos continuam pendentes.',
    {executable:def.length,withoutExplicitSearchPath:def.filter(x=>!x.explicit_search_path).length,...defInvocation});
  if(invocation.contextOnly||invocation.windowContext)add('contextual_invocation','NÃO VERIFICADO',
    'Acionamento por triggers/eventos/janelas depende de vínculos, eventos, operações permitidas, owner e corpo; ausência de rota direta não prova isolamento.',
    {contextOnly:invocation.contextOnly,windowContext:invocation.windowContext});
  const pub=input.publicAcls;
  add('public',pub.length?'ALERTA':'NÃO VERIFICADO','PUBLIC é cumulativo. Concessão presente exige revisão, não implica vulnerabilidade automaticamente; lista vazia não certifica negação.',{grants:pub.length,grantable:pub.filter(x=>x.is_grantable).length});
  const seq=input.sequences;
  const seqAccess=seq.filter(x=>x.effective_select||x.effective_usage||x.effective_update);
  add('sequences',!seq.length?'NÃO VERIFICADO':seqAccess.length?'ALERTA':'APROVADO','USAGE/UPDATE pode permitir alteração de sequência; SELECT também divulga estado. Não testa nextval/setval.',
    {inventoried:seq.length,withPrivileges:seqAccess.length,mutationCapable:seq.filter(x=>x.effective_usage||x.effective_update).length});
  add('memberships',input.memberships.length?'ALERTA':'APROVADO','Critério limitado às memberships transitivas informadas; não cobre PUBLIC.',
    {memberships:input.memberships.length,canSetRole:input.memberships.filter(x=>x.can_set_role).length});
  const defaults=input.defaultPrivileges,relevant=defaults.filter(x=>x.granted_to_public||x.granted_directly_to_auditor||x.available_now||x.membership_path);
  add('default_privileges',relevant.length?'ALERTA':'NÃO VERIFICADO','Defaults explícitos não substituem os padrões internos: novas funções podem receber EXECUTE para PUBLIC mesmo com catálogo vazio.',
    {entries:defaults.length,relevant:relevant.length,grantableRelevant:relevant.filter(x=>x.is_grantable).length});
  add('coverage','NÃO VERIFICADO','Origem Demo, completude/permissões do executor, schemas internos, corpos/dependências, RLS de dados e privilégios futuros não certificados.');
  return finish();
}
function main() {
  if(process.argv.length!==3)throw Error('Argument required');
  const source=process.argv[2];
  if(fs.statSync(source).size>LIMIT)throw Error('Input too large');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(source));
  const report=analyze(importSqlEditor(text));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bandup-role-analysis-'));
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(dir,'report.md'),[report.scope,...report.findings.map(f=>`- ${f.status} | ${f.id}: ${f.detail} ${JSON.stringify(f.counts)}`)].join('\n'));
  for(const f of report.findings)console.log(`${f.status} | ${f.id} | ${JSON.stringify(f.counts)}`);
  console.log(`Relatórios: ${dir}`);
  process.exitCode=report.overall==='ALERTA'?1:2;
}
module.exports={analyze};
if(require.main===module){try{main();}catch{console.error('NÃO VERIFICADO: entrada ilegível/inválida; conteúdo e erros brutos omitidos.');process.exitCode=2;}}
