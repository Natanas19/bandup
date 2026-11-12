# Exclusao de banda: suite PostgreSQL 17 isolada

## Escopo

Testes e candidata local da Parte 1. Existe uma migration candidata para a RPC,
mas nao houve aplicacao remota, limpeza de Storage ou interface. Nenhuma conexao com o Demo e nenhum banco existente sao utilizados.

O bootstrap tem duas etapas: `band-delete-bootstrap.sql` cria Auth sintetico;
`band-delete-dependencies.sql`, depois do schema-base local, cria as dependencias.
A funcao `private.sync_task_assignees_legacy`, seu trigger e a CHECK nomeada
`band_join_requests_check` foram copiados das definicoes integrais fornecidas pelo
usuario nesta conversa, sem substituir o comportamento por outra implementacao.
As tres tabelas adicionais reproduzem colunas, defaults, checks e FKs informados.
O indice UNIQUE tasks(band_id,id) suporta a FK composta fornecida de task_assignees.
Nenhum trigger personalizado foi adicionado as tres tabelas novas.

## Execucao segura

Requer PostgreSQL 17 em `C:/Program Files/PostgreSQL/17/bin` e Node.js.
No PowerShell:

```powershell
$env:BANDUP_DELETE_LOCAL_TESTS='create-isolated-cluster'
node tests/postgres/band-delete-isolated.cjs --execute
```

A opcao antiga `--execute-core` foi substituida por `--execute` para deixar clara
a expansao. Sem argumento e opt-in exatos, nao ha conexao. Importar o modulo nao
executa nada. Nao recebe URL de banco, nao le .env e remove variaveis PG herdadas.
Cria cluster novo em TEMP, banco aleatorio e porta efemera em 127.0.0.1; rejeita
5433. Cada sessao valida banco, endereco, porta, versao, data_directory e identidades
antes de receber comandos de teste. Auth usa apenas UUIDs sinteticos, sem senhas,
JWTs reais ou dados exportados.

O DDL das duas fontes historicas locais e usado apenas como base do banco de teste
recem-criado; nao ha aplicacao de migrations em ambientes da aplicacao. Hashes de
todas as fontes SQL sao registrados e conferidos no fim. O finally encerra o
servidor; falha de parada e registrada como stopNeedsReview. Dados/logs/manifesto
ficam retidos em TEMP, sem limpeza automatica. Nunca remover um diretorio existente
para executar a suite.

## Cobertura e resultados

- Bandas com um e dois administradores, incluindo exclusao pelo segundo admin.
- Membro compartilhado entre bandas e banda de controle com todas as dependencias.
- Tarefas sem responsavel, assigned_to legado com ponte automatica e tarefas com
  dois task_assignees. Estes ultimos sao fixtures criadas pelo dono do teste; nao
  representam disponibilidade de um fluxo de ativacao no aplicativo.
- Quatro estados de solicitacao (pending/approved/rejected/cancelled), timestamps
  consistentes, rejeicao dos quatro estados inconsistentes e permissao de
  decided_by NULL para decisoes, conforme a CHECK exata fornecida.
- Diretorio, eventos ligados a tarefas, links, seis cascatas diretas e duas
  cascatas indiretas de task_assignees.
- INSERT real de tasks cria assignee; UPDATE escalar em tarefa multipla e recusado
  com 23514 e preserva todas as linhas. Remocao isolada de membro verifica a cadeia
  de limpeza de assigned_to/ponte/cascatas e depois reverte integralmente.
- DELETE direto da banda reproduz 23503/tasks_band_id_fkey nas duas bandas-alvo;
  os snapshots de todas as oito tabelas public e Auth comprovam rollback.
- Alternativa diagnostica: DELETE das tarefas antes do DELETE da banda, na mesma
  transacao, mantendo triggers, RLS e FKs ativos. Verifica zero residuos, ausencia
  de orfaos e igualdade integral da banda de controle e usuarios.
- Erro PZ001 injetado apos exclusao controlada comprova rollback integral, incluindo
  assignees, solicitacoes e diretorio. Membro comum e externo nao excluem o controle
  sob a RLS local. A transacao externa de fixtures termina em ROLLBACK.

O sucesso da suite significa que a falha esperada foi reproduzida, nao que o
DELETE direto e seguro. O manifesto declara `directCascadeSafe: false` e
`tasksFirstDiagnosticPassed: true`. A falha acontece quando a cascata remove
integrantes e o trigger local atualiza tarefas cujo pai bands ja nao existe.
Nao desabilitar protecoes para contornar a falha.

Execucao ampliada em 12/11/2026: 53 verificacoes SQL aprovadas; servidor encerrado;
fontes inalteradas. Manifesto:
`C:/Users/USURIO~2/AppData/Local/Temp/bandup-delete-core-bhjMcU/result.json`.

## Diferencas e limites

- Nao e clone do Demo: schema-base, trigger prevent_last_band_admin_removal e RLS
  base vem das migrations locais, sem afirmar paridade com os corpos remotos.
- ACL/RLS reais das tres tabelas adicionais nao foram fornecidas. Elas ficam sem
  acesso de API neste teste; snapshots de suporte SECURITY DEFINER leem suas linhas.
  Cascatas sao verificadas sem inventar policies de producao.
- Demais indices, flags de deferrabilidade nao fornecidas, owners, roles herdadas,
  extensoes, views/materializacoes e funcoes externas nao sao presumidos iguais.
  FKs informadas sao reproduzidas com defaults imediatos/nao deferiveis.
- Auth e minimo: nao ha JWT/HTTP real, Storage, interface ou worker. A suite
  exercita a RPC candidata, confirmacao SQL, replay, recibos e concorrencia real.
- Ordem das cascatas pode depender do DDL/triggers instalados; a alternativa precisa
  de revisao contra o catalogo real antes de qualquer implementacao/aplicacao.
- Confirmacao por nome e autorizacao atomica com locks continuam sendo requisitos
  da RPC candidata. Os testes-base usam DELETE direto antes da candidata e os
  testes posteriores usam RPC/recibos e verificam o bloqueio do DELETE direto.
- Nenhum resultado autoriza aplicacao no Demo. O proximo passo e revisar o contrato
  da RPC com esta evidencia e fechar as diferencas de catalogo por leitura autorizada.


## Parte 1: candidata local da RPC

A suite agora tambem instala, apenas no banco novo sintetico, a candidata
`supabase/migrations/20261112180000_band_delete.sql` e executa
`band-delete-rpc-checks.sql`. Isso nao altera as fontes historicas.

O resultado historico anterior a retencao tem 53 verificacoes de cascatas mais 83 verificacoes no grupo RPC (inclui os checks
de fixtures compartilhados), alem de teste negativo de DELETE herdado, colisao de
nome e concorrencia real entre duas sessoes. O vencedor confirma COMMIT; o outro
recebe negativa e fica somente um job. A suite confirma rollback da instalacao
quando uma role herdada ainda concede DELETE, preservando os grants anteriores.

Execucao Parte 1: manifesto em
`C:/Users/USURIO~2/AppData/Local/Temp/bandup-delete-core-hrCSPO/result.json`;
servidor encerrado, fontes inalteradas. As fixtures da concorrencia ficam no banco
TEMP retido, que nunca e reutilizado automaticamente.

A candidata fecha DELETE direto via REVOKE no authenticated, mantendo a policy
existente. Logo, os antigos checks de DELETE direto executam ANTES da candidata;
os checks da RPC verificam a negativa por privilegio DEPOIS dela.

A fila privada nao concede acesso a authenticated, anon ou service_role. Somente
postgres possui acesso agora; o papel e a API estreita do worker precisam ser
escolhidos/revisados na Parte 2, sem conceder acesso generico ao navegador.
Veja `docs/band-delete-rpc-candidate.md` para contrato e requisitos de aplicacao.


## Correcao dos bloqueadores locais

Assinatura atual: bandup_delete_band(uuid,text,uuid), com ID de tentativa obrigatorio
conhecido antes de chamar. Recibo: bandup_get_band_deletion(uuid), somente para o
ator original. Antes de 90 dias, repetir os mesmos argumentos recupera resultado sem repetir efeitos;
NULL em consulta nao prova falha enquanto a outra transacao ainda nao fez commit.

Registro permanente privado band_deletion_tombstones bloqueia reutilizacao do UUID,
independentemente da retencao da fila. Trigger AFTER verifica a insercao depois de
esperar eventual chave primaria em exclusao concorrente; criacao exige READ
COMMITTED, e mudanca do ID e recusada. Um teste inicia INSERT antes do commit,
confirma espera por lock e verifica negativa depois do commit. O job permanece unico.

A suite cobre acesso ao recibo de outro ator, operacao desconhecida, replay em outra
banda/conta, confirmacao divergente, rollback do registro permanente/job, guard apos
remocao de job e imutabilidade do registro. Nao existe overload antigo de dois args.
Essas alteracoes sao apenas na candidata nao aplicada, nunca em migrations historicas.

## Retencao de 90 dias

A candidata atual separa band_deletion_tombstones (somente band_id),
band_deletion_operations (somente operation_id), band_deletion_receipts temporarios
e band_logo_cleanup_jobs sem autor e sem FK ao recibo. Todos ficam em private com
RLS e ACLs restritas. Recibos retem nome UTF-8 e ator somente ate o expurgo.

A janela de recuperacao e de 2160 horas medidas apos o DELETE na RPC; expires_at
e verificado por clock_timestamp, mesmo em transacao longa. Expirado ou removido,
o recibo nao pode recuperar resultado e o ID consumido nunca inicia nova exclusao.
NULL de consulta nao prova falha. Registros permanentes nao podem ser alterados,
removidos ou truncados; exclusao de recibos vencidos nao os afeta.

Expurgo: private.expire_band_deletion_receipts(integer DEFAULT 1000), apenas postgres,
1..1000 registros, cutoff interno e FOR UPDATE SKIP LOCKED. Nao aceita filtro por ID
nem data externa. UPDATE/TRUNCATE de recibos e DELETE de nao vencidos sao recusados.
Nao ha scheduler. Ver docs/band-delete-rpc-candidate.md para chamada futura autorizada,
privilegios, SLA e monitoramento; nao executar contra o Demo nesta tarefa.

Testes SQL adicionais cobrem acesso, lote invalido, expurgo seguro/repetido e rollback,
permanencia dos IDs, tentativa antiga contra outra banda e sobrevivencia de job pendente.
O snapshot integral agora inclui tombstones e operacoes, inclusive falha tardia na
insercao do job apos DELETE e recibo. Fixtures de recibos historicos sao sinteticas,
inseridas pelo owner; nenhuma protecao e desativada.

O runner usa sessoes independentes para exclusao/consulta/expurgo, replay antes do
prazo mantendo lock ate depois do vencimento, consulta expirada na mesma transacao,
dois expurgos concorrentes e negativa de redirecionamento enquanto o primeiro ainda
nao confirmou. Continua validando INSERT aguardando PK em exclusao e negativa em
REPEATABLE READ/SERIALIZABLE. A guarda de saida aceita CRLF e LF do psql.

Resultado de 12/11/2026: 53 verificacoes de cascatas e 122 do grupo RPC aprovadas,
mais concorrencia real de exclusao, reutilizacao de UUID, replay e expurgo.
Manifesto: `C:/Users/USURIO~2/AppData/Local/Temp/bandup-delete-core-O4Gxtw/result.json`.
suitePassed, stopped e sourcesUnchanged = true. PostgreSQL temporario encerrado;
sem Demo, JWT/HTTP real ou Storage. TypeScript (`npx tsc --noEmit --incremental false`),
lint completo (`npm run lint`), lint do runner e `node --check` aprovados.
Diff verificado sem erros de whitespace, incluindo os cinco arquivos nao rastreados.
Uma tentativa inicial nao iniciou o servidor por restricao do sandbox; a execucao
fora do sandbox usou exclusivamente cluster novo isolado. Uma assercao do runner
foi corrigida para CRLF/LF antes da execucao final aprovada.

## Automacao do expurgo (migration independente)

O mesmo runner agora testa tambem `20261112190000_band_delete_receipts_cron.sql`.
A migration de exclusao aplicada no Demo nao foi modificada. A extensao pg_cron
nao existe no PostgreSQL local: o arquivo integral deve falhar atomicamente por
essa ausencia. Os demais checks usam um double SQL explicitamente sintetico da
API cron, sem timer, omitindo em memoria somente o gate de disponibilidade real.
O processamento dos recibos, limites, ACLs e demais gates usam o SQL real.

Ultima execucao: 53 checks de cascatas, 122 de RPC e 42 do grupo Cron, mais
concorrencia real, cancelamento/rollback e preservacao das ACLs anteriores.
Manifesto inicial aprovado: `C:/Users/USURIO~2/AppData/Local/Temp/bandup-delete-core-H3CvAe/result.json`.
suitePassed, sourcesUnchanged e stopped = true. Falta validar o disparo pelo
pg_cron real em ambiente com extensao instalada; nao se presume integracao remota.
Ver `docs/band-delete-receipts-cron.md` para instalacao, monitoramento e rollback.

## Contrato do worker de logos (nova migration local)

O runner inclui `20261112200000_band_logo_cleanup_worker.sql`, exclusivamente no
cluster novo. Nao altera as migrations anteriores. A suite de contrato verifica
service_role versus frontend, ausencia de grants diretos na fila, token de lease,
recuperacao de claim, banda viva excluida da selecao, takeover, stale ack/renew,
retry maximo, verificacao vazia dupla, reconciliacao de completed e claims
concorrentes. Tambem testa vencimento do lease durante espera por lock.

Storage e endpoint sao testados com rede externa bloqueada em
`tests/band-logo-cleanup-worker.test.cjs`; inclui o SDK realmente instalado com
fetch inteiramente em memoria. Nao ha Auth/Storage remoto. Ver
`docs/band-logo-cleanup-worker.md` para limites, ativacao e monitoramento.
