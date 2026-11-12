# Expurgo diario de recibos: implementacao local

Nova migration: `supabase/migrations/20261112190000_band_delete_receipts_cron.sql`.
A migration `20261112180000_band_delete.sql`, ja aplicada, permanece inalterada.
Nenhum acesso ao Demo ou agendamento remoto foi realizado nesta tarefa.

## Instalacao futura autorizada

1. Habilitar Supabase Cron/pg_cron pelo fluxo administrativo autorizado, caso ainda
   nao esteja instalado. A nova migration verifica a extensao e a API nomeada
   `cron.schedule(name,text,text)`; nao instala extensoes nem contorna ausencias.
2. Executar a nova migration integralmente como postgres com BYPASSRLS, em READ
   COMMITTED. O pg_cron precisa apontar para o banco atual, estar habilitado e usar
   GMT/UTC/Etc/UTC. Configuracao divergente aborta sem alterar configuracoes globais.
3. Confirmar COMMIT e exatamente um job `bandup-band-deletion-receipts-purge`,
   owner/executor postgres, banco atual, ativo, expressao `0,5,15 3 * * *`.
   Sao uma passagem principal as 03:00 UTC e duas passagens de retentativa as
   03:05 e 03:15 UTC. Elas executam mesmo se a anterior teve sucesso, com seguranca.
4. Acompanhar a primeira janela real. Testes locais nao comprovam funcionamento
   do scheduler no projeto hospedado. Nao testar instalacao excluindo bandas reais.

Comando fixo do job: `SET statement_timeout = '30s'; SELECT private.run_band_deletion_receipts_purge();`.
Um job com mesmo nome e definicao identica pode ser reutilizado. Se pertencer a
outro usuario/banco/host/porta ou tiver comando, horario ou estado diferente, a
migration aborta sem sobrescrever o job. Reaplicar a migration instalada aborta
por colisao dos objetos; nao cria outro job. Nao editar ledger nem usar repair.

## Limites e seguranca

- `private.run_band_deletion_receipts_purge()` nao recebe argumentos e retorna o
  run_id da metrica gravada. Chama somente o expurgo existente, com lote fixo 1000.
- Maximo de 20 lotes bem-sucedidos e 20.000 recibos removidos por passagem; no
  maximo 3 tentativas por lote (60 chamadas), com verificacao de orcamento de
  10 segundos antes de cada chamada. Uma chamada ja iniciada pode ultrapassar
  esse orcamento; o comando cron aplica o limite rigido de 30 segundos.
- Repeticao imediata apenas para 40001, 40P01 e 55P03. Outros erros encerram a
  passagem; as passagens posteriores tentam novamente. Nao ha retry ilimitado,
  pg_sleep ou promessa de retry automatico do pg_cron.
- Uma passagem e uma transacao limitada. Cada chamada de lote tem subtransacao
  para rollback em erro. Lotes anteriores bem-sucedidos podem confirmar junto
  da metrica de falha; cancelamento/queda da conexao reverte a passagem inteira.
- Um advisory lock transacional impede sobreposicao, inclusive chamadas manuais.
  Uma tentativa concorrente registra `skipped` sem executar expurgo. Recibos
  bloqueados por replay continuam sendo pulados pelo expurgo existente.
- Funcoes SECURITY DEFINER com owner postgres, search_path vazio, row_security
  off e lock_timeout 3s. O runner manual deve tambem usar statement_timeout 30s;
  configurar isso apenas dentro de uma funcao nao limita a chamada ja iniciada.
- As ACLs das RPCs e do expurgo existentes nao sao alteradas. Nenhum grant novo
  para PUBLIC/anon/authenticated/service_role. A nova tabela tem RLS sem policies;
  funcao, tabela e sequence de metricas ficam restritas a postgres. Postflight
  rejeita default grants inesperados, inclusive para outras roles.
- Nao ha frontend, endpoint HTTP, Edge Function, credencial externa ou acesso ao
  Storage. Tombstones, IDs consumidos e jobs de logos nunca sao removidos aqui.

## Metricas e monitoramento

`private.band_deletion_purge_runs` guarda somente run_id, horarios, status,
contadores, instante do vencido mais antigo e SQLSTATE. Nao guarda band_id,
operation_id, requested_by, confirmacao, mensagens de erro, tokens ou nomes.
Historico proprio: 30 dias, com remocao de ate 1000 metricas antigas por passagem.
Nao altera `cron.job_run_details` nem logs de outros jobs; a retencao do historico
geral do pg_cron deve ser gerida separadamente pelo administrador.

Status:
- `succeeded`: processamento terminou sem backlog vencido observado.
- `limited`: restam vencidos por limite de lotes/tempo ou registros bloqueados.
- `failed`: falha SQL capturada ou esgotamento das tentativas; consultar SQLSTATE.
- `skipped`: outra passagem detinha o advisory lock; nao mediu backlog.

Backlog e contado ate 10.001 registros usando o indice de expiracao. Quando
backlog_capped=true, backlog_at_least e um limite inferior, nao o total exato.
O instante mais antigo e calculado nessa amostra ordenada. Metricagem e pontual:
novos vencimentos podem aparecer imediatamente depois, sem indicar erro.

**Importante:** uma falha capturada grava status=failed e retorna normalmente
para preservar metricas e lotes anteriores. O cron pode mostrar `succeeded`
(comando SELECT terminou), apesar da falha operacional. Monitorar AMBOS os lugares.
Cancelamento por timeout, queda do banco ou erro fora do bloco de lote pode
reverter inclusive a metrica: nesses casos consultar `cron.job_run_details`.

Consultas de monitoramento, somente leitura, como postgres:

```sql
SELECT run_id,started_at,finished_at,status,batches,attempts,removed,
       backlog_at_least,backlog_capped,oldest_expired_at,error_sqlstate
FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 10;

SELECT d.start_time,d.end_time,d.status,d.return_message
FROM cron.job_run_details d JOIN cron.job j USING(jobid)
WHERE j.jobname='bandup-band-deletion-receipts-purge' AND j.username='postgres'
ORDER BY d.start_time DESC LIMIT 10;
```

Alertar em failed/timeouts e em ausencia de passagem nao-skipped por mais de
25 horas; nao esperar esse limite para reagir a erros conhecidos. Se a passagem
das 03:15 ainda estiver limited, intervir/reexecutar em janela autorizada e
dimensionar capacidade. Alertar tambem por idade do vencido mais antigo: a
tolerancia aproximada de 24h pressupoe banco ativo, capacidade e retries saudaveis.
Pausa do plano Free ou indisponibilidade pode exceder o prazo e exige intervencao.
Nao interpretar um retorno zero de lote como prova de backlog vazio.

## Rollback do agendamento

Em etapa administrativa autorizada, remover somente este job, conferindo nome,
executor, banco e comando. Nao remover a extensao nem usar DROP CASCADE:

```sql
SELECT cron.unschedule(j.jobid)
FROM cron.job j
WHERE j.jobname='bandup-band-deletion-receipts-purge'
  AND j.username='postgres' AND j.database=current_database()
  AND j.command='SET statement_timeout = ''30s''; SELECT private.run_band_deletion_receipts_purge();';
```

Confirmar que nao ha execucao em andamento e que o job deixou de existir. A
funcao privada e metricas podem permanecer para diagnostico; nao liberam acesso
ao aplicativo. Nenhum recibo ja expurgado e recuperado pelo rollback. Nao remover
tombstones/operacoes nem reverter a migration de exclusao. Reativacao futura usa
o mesmo nome e comando revisados; nao reaplicar a migration para contornar colisao.

## Testes e limites locais

Usa o runner isolado existente, com opt-in explicito, sem .env/URL externa:

```powershell
$env:BANDUP_DELETE_LOCAL_TESTS='create-isolated-cluster'
node tests/postgres/band-delete-isolated.cjs --execute
```

O PostgreSQL 17 local nao possui pg_cron. A migration integral e testada como
negativa para extensao ausente. Para os demais checks, o runner instala um
**double SQL da API de agendamento**, sem worker/timer, somente no cluster novo.
O bloco cron_required e omitido apenas em memoria nesse teste de contrato;
todos os outros gates, objetos, codigo de processamento, ACLs e agendamento sao
executados a partir do arquivo real. Nao existe bypass na migration de producao.

Testa duplicacao e colisao de job, rollback por default ACL de tabela/sequence/
funcao, preservacao de ACLs anteriores, lotes reais, retries transientes e falhas
permanentes/tardias, backlog limitado, retencao de metricas, locks de replay,
sobreposicao e cancelamento com rollback. Fixtures e falhas injetadas existem
somente no cluster sintetico e nao modificam as fontes SQL anteriores.
O disparo real do pg_cron e sua autenticacao local continuam pendentes de teste
em ambiente com a extensao instalada, antes da ativacao remota autorizada.

Referencias: https://supabase.com/docs/guides/cron e https://github.com/citusdata/pg_cron.
