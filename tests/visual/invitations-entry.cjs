/* eslint-disable @typescript-eslint/no-require-imports */
const React=require('react');
const {createRoot}=require('react-dom/client');
const fixtures=require('./invitations-fixtures.cjs');
const {BandInvitations,MusicianInvitationDiscovery}=require('@/components/band-invitations');
// Defense in depth; CSP also blocks network APIs even if this bootstrap changes.
const forbidden=()=>{throw Error('Network forbidden in isolated invitation preview');};
for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource'])Object.defineProperty(globalThis,name,{value:forbidden,writable:false,configurable:false});
const h=React.createElement;
function Preview(){
  const [scenario,setScenario]=React.useState('mixed');
  const [view,setView]=React.useState('received');
  const [revision,setRevision]=React.useState(0);
  const [accepted,setAccepted]=React.useState(false);
  function change(nextScenario,nextView){fixtures.reset(nextScenario,nextView);setScenario(nextScenario);setView(nextView);setAccepted(false);setRevision(value=>value+1);}
  const control='min-h-11 min-w-0 w-full rounded-xl border border-outline bg-surface p-3 text-content focus-visible:ring-4 focus-visible:ring-focus';
  return h('main',{className:'workspace-theme min-h-screen min-w-0 px-4 py-6 text-content sm:px-6'},
    h('div',{className:'mx-auto w-full max-w-5xl'},
      h('p',{className:'text-sm font-semibold text-danger'},'Prévia local isolada · Dados simulados · Sem conexão com Supabase'),
      h('h1',{className:'mt-3 text-3xl font-semibold'},'Convites de músicos'),
      h('p',{className:'mt-3 text-sm text-content-muted'},'Use o modo responsivo do navegador para comparar desktop e mobile. Nenhuma alteração persiste após recarregar.'),
      h('div',{className:'mt-6 grid gap-4 sm:grid-cols-2'},
        h('label',{className:'block space-y-2'},h('span',null,'Área simulada'),h('select',{className:control,value:view,onChange:event=>change(scenario,event.target.value)},
          ...[['received','Meu Painel — recebido sem bandas'],['sent','Membros — enviados'],['discovery','Descobrir — envio']].map(([value,label])=>h('option',{key:value,value},label)))),
        h('label',{className:'block space-y-2'},h('span',null,'Cenário'),h('select',{className:control,value:scenario,onChange:event=>change(event.target.value,view)},
          ...fixtures.scenarios.map(([value,label])=>h('option',{key:value,value},label))))),
      h('div',{className:'mt-4 flex flex-wrap items-center gap-4'},
        h('button',{className:control+' sm:w-auto',onClick:()=>change(scenario,view)},'Restaurar dados simulados'),
        h('label',{className:'flex min-h-11 items-center gap-2'},h('input',{type:'checkbox',onChange:event=>{document.documentElement.dataset.theme=event.target.checked?'dark':'light';}}),'Tema escuro')),
      view==='received'&&h('p',{className:'mt-5 text-sm text-content-muted'},accepted?'Você aceitou um convite nesta simulação.':'Você ainda não participa de nenhuma banda nesta simulação.'),
      view==='sent'&&h('p',{className:'mt-5 text-sm text-content-muted'},'Administrador simulado · O contrato atual não retorna o nome do destinatário.'),
      view==='discovery'?h(MusicianInvitationDiscovery,{key:revision}):h(BandInvitations,{key:revision,bandId:view==='sent'?fixtures.bandId:undefined,onAccepted:()=>setAccepted(true)})));
}
createRoot(document.getElementById('root')).render(h(Preview));
