# Interface local de convites — etapa 1

Preparada sem ativação. `NEXT_PUBLIC_BANDUP_INVITATIONS_ENABLED` é false no
`.env.example` e somente o texto exato `true` habilita o código após rebuild.
Nenhum arquivo de ambiente real foi alterado. O serviço verifica a flag antes
de Auth, consultas ou RPCs; wrappers retornam null antes de montar componentes
internos/criar cliente. As páginas também condicionam sua integração à flag.

## Pontos preparados

- Descobrir músicos: quando futuramente habilitado, utiliza a RPC candidata
  `bandup_discover_musicians_for_invites`; a descoberta antiga permanece quando
  desativado. A rota mantém a dependência existente da flag de descoberta.
- Busca por nome, paginação, seleção entre bandas administradas e envio somente
  para disponibilidade true/referência não nula. A lista de bandas usa o padrão
  existente `band_members`/`bands!inner`, limitado ao usuário/admin; autorização
  efetiva continua no backend, não nesse filtro de apresentação.
- Meu Painel: recebidos independem de ter bandas; aceite/recusa exigem confirmação.
  Aceite atualiza o painel para reler as associações; não insere membro no cliente.
- Membros: acompanhamento de enviados somente na apresentação de administrador.
  Os estados pending/accepted/rejected/superseded vêm exclusivamente da RPC.
- Erros 55P03, 25001, 55000, 23505 e quotas possuem mensagens públicas; erros
  brutos do backend não são mostrados. Resposta perdida não gera retry automático.
  Decisão sempre dispara releitura; envio com erro bloqueia novos envios até
  atualização explícita dos enviados. Leituras antigas são ignoradas no unmount
  e em troca de busca/página. Refs bloqueiam duplo clique antes do próximo render.
- Pedidos existentes: somente tipo `EntryStatus` e rótulo acrescentam superseded;
  aprovação, cancelamento e saída continuam com os mesmos contratos.

## Limitações reais do contrato

A listagem de enviados não fornece nome do destinatário. O acompanhamento usa
“Convite para músico”, status e data, sem mostrar UUIDs/referências privadas.
Não há lookup individual, cancelamento, expiração ou filtro de status no SQL;
nenhum desses parâmetros/retornos foi inventado no serviço.
A releitura após falha usa a primeira página dos enviados, que contém convites
mais recentes; ela não prova ausência em todo o histórico. As constraints e
quotas do backend continuam sendo a proteção contra reenvio. O bloqueio local
de um envio conhecido vale durante a montagem da tela e é conservador mesmo
após um estado terminal; não representa um mecanismo persistente de autorização.

## Validação e ativação futura

`tests/band-invitations-ui.test.cjs` executa apenas modelos em memória, sem rede,
sem persistência e sem PostgreSQL. Abrange contratos exatos, descarte de campos
privados, flag, respostas inválidas, mensagens, confirmação, estados finais,
duplo clique e reconciliação sem retry de mutação. Flags true nos mocks não
ativam a aplicação. Testes existentes de pedidos/descoberta cobrem regressão.

Antes de qualquer ativação: hardening de band_members, instalação autorizada
do candidato, validação do destino e das dependências de exclusão. Histórico de
migrations divergente permanece pendente; esta etapa não altera SQL/migrations.
A documentação Next indicada por AGENTS.md não está instalada; a implementação
reutiliza os padrões de componentes cliente e rotas já existentes.

Validação desta etapa: 9/9 testes novos de convites aprovados; TypeScript sem emissão e ESLint dos arquivos envolvidos
passaram. O serviço existente de pedidos teve 22/22 testes aprovados; descoberta
de músicos, 5/5. A suite antiga `band-entry-ui.test.cjs` teve 15/16 aprovados:
o teste de `/descobrir` falha porque seu loader não resolve o import preexistente
`@/lib/musician-discovery`. Essa rota e esse teste não foram alterados nesta etapa.
Não foram executados testes PostgreSQL ou chamadas de rede.

## Revisão estática de interface em 2026-11-17

O inventário de automação retornou `browser access host is unavailable`.
A sessão pessoal do Chrome não foi usada. Não houve captura ou validação visual
real de desktop/mobile, contraste calculado ou navegação real por teclado/leitor
de tela; responsividade foi revisada somente pelas classes e estrutura do JSX.

Adicionados nomes acessíveis com contexto da banda/músico às ações dos cartões,
texto de processamento anunciado por role=status, foco visível em busca/seletor,
quebra para textos longos e flex-wrap na paginação. Os recebidos permanecem fora
da condição de quantidade de bandas no dashboard. A flag continua desativada por
padrão, com wrappers e serviço bloqueando montagem/chamadas de convites.

11/11 testes de convites aprovados, incluindo os dois novos cenários de UI e
posicionamento no dashboard; TypeScript e ESLint passaram. A falha antiga do
loader de `/descobrir` citada no histórico acima foi corrigida na etapa anterior.
Pendência: inspeção visual real em larguras desktop/mobile e verificação por
teclado, usando prévia isolada com serviços simulados, sem habilitar o ambiente
real ou conectar ao Supabase.
