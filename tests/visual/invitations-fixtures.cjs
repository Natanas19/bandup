// Standalone preview only. No application imports, network, Auth SDK or persistence.
const INVITATION_PAGE_SIZE = 20;
const bandId = '10000000-0000-4000-8000-000000000001';
const key = index => `20000000-0000-4000-8000-${String(index).padStart(12,'0')}`;
const invitationStatusLabel = { pending:'Pendente',accepted:'Aceito',rejected:'Recusado',superseded:'Encerrado pela entrada na banda' };
const scenarios = [
  ['mixed','Todos os estados'],['pending','Pendentes'],['accepted','Aceitos'],['rejected','Recusados'],
  ['superseded','Encerrados pela entrada'],['empty','Lista vazia'],['slow','Demora (3 segundos)'],
  ['error','Erro de leitura'],['busy','Operação concorrente (55P03)'],['isolation','Sessão incompatível (25001)'],
  ['closed','Convite já encerrado (55000)'],['long','Nomes muito longos'],
];
let current;
function reset(scenario='mixed',view='received') {
  if(!scenarios.some(([id])=>id===scenario)) throw Error('Unknown preview scenario');
  const states=['pending','accepted','rejected','superseded'];
  const rows=Array.from({length:24},(_,i)=>{
    const status=states.includes(scenario)?scenario:scenario==='mixed'?states[i%4]:'pending';
    return { invitation_id:key(i+1),band_id:view==='received'?key(i+301):bandId,
      band_name:scenario==='long'?'Banda'+ 'NomeSemEspaços'.repeat(20):view==='received'?`Banda de demonstração ${i+1}`:'Banda demonstrativa',
      musician_ref:view==='received'?key(101):key(i+101),status,created_at:new Date(Date.UTC(2026,10,17,12,0,-i)).toISOString(),
      decided_at:status==='pending'?null:'2026-11-17T13:00:00Z' };
  });
  current={scenario,view,rows:scenario==='empty'?[]:rows,memberships:[],next:1000};
}
reset();
function invitationError(error) {
  const code=error?.code??'unknown';
  const messages={'55P03':'Há outra operação em andamento. Atualize os dados antes de tentar novamente.',
    '25001':'Não foi possível concluir nesta sessão. Atualize os dados e tente novamente mais tarde.',
    '55000':'Este convite já foi encerrado. Atualize a lista.',
    '23505':'Já existe um convite pendente ou o músico já integra a banda.',
    '42501':'Você não tem permissão para esta operação simulada.'};
  return Object.assign(new Error(messages[code]??'Falha simulada de carregamento. Tente novamente.'),{code});
}
const fail=code=>{throw invitationError({code});};
async function pause(state,mutation=false) {
  await new Promise(resolve=>setTimeout(resolve,state.scenario==='slow'?3000:350));
  if(!mutation&&state.scenario==='error')fail('unknown');
  if(mutation&&state.scenario==='busy')fail('55P03');
  if(mutation&&state.scenario==='isolation')fail('25001');
}
const client=Object.freeze({ previewOnly:true,
  rpc(){throw Error('RPC forbidden in isolated preview');},auth:Object.freeze({getUser(){throw Error('Real Auth forbidden in preview');}}) });
function createBandInvitationService(candidate) {
  if(candidate!==client)throw Error('Preview client required');
  const state=current; // Old pending promises cannot mutate a newly reset scenario.
  return {
    async adminBands(){await pause(state);return state.view==='received'?[]:[{id:bandId,name:'Banda demonstrativa'}];},
    async discover(query='',offset=0){
      await pause(state);
      const all=state.scenario==='empty'?[]:Array.from({length:26},(_,i)=>({
        name:state.scenario==='long'?'Músico'+ 'NomeMuitoLongo'.repeat(16):`Músico de demonstração ${i+1}`,
        available:i%4!==0,musicianRef:i%4===0?null:key(i+101),
      })).filter(row=>row.name.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')));
      return {musicians:all.slice(offset,offset+INVITATION_PAGE_SIZE),hasNext:all.length>offset+INVITATION_PAGE_SIZE};
    },
    async list(scope=null,offset=0){await pause(state);return state.rows.filter(row=>scope===null||row.band_id===scope)
      .slice(offset,offset+INVITATION_PAGE_SIZE).map(row=>({...row}));},
    async send(scope,ref){
      await pause(state,true);
      if(scope!==bandId)fail('42501');
      if(state.rows.some(row=>row.band_id===scope&&row.musician_ref===ref&&row.status==='pending'))fail('23505');
      const id=key(state.next++);
      state.rows.unshift({invitation_id:id,band_id:scope,band_name:'Banda demonstrativa',musician_ref:ref,status:'pending',created_at:new Date().toISOString(),decided_at:null});
      return id;
    },
    async decide(id,decision){
      await pause(state,true);
      const row=state.rows.find(row=>row.invitation_id===id);
      if(!row)fail('42501');
      if(state.scenario==='closed'){row.status='superseded';row.decided_at=new Date().toISOString();fail('55000');}
      if(row.status!=='pending')fail('55000');
      if(!['accepted','rejected'].includes(decision))throw Error('Invalid simulated decision');
      row.status=decision;row.decided_at=new Date().toISOString();
      if(decision==='accepted')state.memberships.push(row.band_id);
      return decision;
    },
  };
}
module.exports={BAND_INVITATIONS_ENABLED:true,INVITATION_PAGE_SIZE,invitationStatusLabel,invitationError,
  createBandInvitationService,getSupabaseBrowserClient:()=>client,reset,scenarios,bandId};
