# Worker de logos de bandas excluidas (local, nao ativado)

## Bloqueios constatados antes de alterar o contrato

O schema de `20261112180000_band_delete.sql` tem operation_id/band_id imutaveis,
bucket fixo band-logos, prefixo gerado, status, attempts, next_attempt_at e lease_until.
Nao tem token de lease (fencing), nem API para reservar/renovar/confirmar jobs.
service_role nao possui acesso a fila. Somente lease_until nao impede que uma
execucao antiga confirme um job retomado por outra. Dar acesso generico a tabela
nao e uma solucao aceitavel.

`private.authorize_band_logo_insert` documenta que a autorizacao SQL nao cobre
toda a transferencia do Storage. Nao ha limite comprovado para uploads em voo;
portanto, um prefixo vazio nao prova que nunca recebera outro objeto. O worker
nao pode prometer exclusao final irrevogavel depois de uma unica listagem.

A solucao local usa uma migration nova, sem modificar as aplicadas: token de
lease, API publica estreita apenas para service_role, verificacao de tombstone e
ausencia da banda em todas as operacoes, e reconciliacao continuada. Nao altera
policies de upload nem concede permissao ao frontend. Contratos novos exigem
revisao e aplicacao autorizada antes de habilitar o worker.

## Componentes implementados

- `20261112200000_band_logo_cleanup_worker.sql`: acrescenta lease_token,
  empty_since e last_scanned_at a fila; indices para token unico e jobs vencidos.
- Tres RPCs SECURITY DEFINER, owner postgres, search_path vazio, row_security off
  e lock_timeout 3s, EXECUTE somente para service_role:
  `bandup_claim_band_logo_cleanup(uuid)`,
  `bandup_renew_band_logo_cleanup(uuid,uuid)` e
  `bandup_finish_band_logo_cleanup(uuid,uuid,text)`.
- Helper privado valida auth.role()=service_role e READ COMMITTED; nenhum acesso
  direto a fila e concedido. A migration rejeita grants inesperados e heranca de
  service_role por roles do aplicativo. ACLs anteriores permanecem inalteradas.
- `src/lib/band-logo-cleanup-worker.ts`: processamento limitado e independente
  de HTTP, reutilizando o SDK Supabase existente com transporte restrito.
- `src/lib/band-logo-cleanup-server.ts`: configuracao server-only, comparacao
  segura do segredo e barreira adicional de URL/metodo/caminhos para o SDK.
- `/api/cron/band-logo-cleanup`: endpoint GET Node.js, desabilitado por padrao,
  protegido por CRON_SECRET. HEAD retorna 405 sem executar GET. Query parameters
  sao recusados. Nenhuma sessao ou segredo do browser e utilizado.
- `vercel.json`: configuracao LOCAL para uma chamada diaria as 04:00 UTC.
  Nao foi feito deploy nem ativado agendamento remoto.

## Autorizacao, leases e recuperacao

Claim recebe UUID gerado antes da chamada. Repetir esse UUID recupera a mesma
reserva ainda valida, sem reservar outra banda ou incrementar attempts. Um
advisory lock impede claims simultaneos com o mesmo ID. Jobs distintos usam
FOR UPDATE SKIP LOCKED. Uma lease dura dois minutos e e renovada antes de cada
listagem e antes de cada remocao do Storage. Jobs processing com lease vencida
podem ser retomados, usando novo token. Token antigo nao confirma nem renova um
job retomado; respostas/acks perdidos sao inconclusivos e recuperados depois.

Claim, renovacao e confirmacao exigem tombstone permanente, operacao consumida,
ausencia da banda viva e bucket/prefixo corretos. Nunca usam recibo temporario.
Nenhuma chamada aceita bucket ou caminho fornecido pelo chamador HTTP.

A Storage API nao oferece fencing SQL: uma requisicao ja enviada pode terminar
depois de uma lease vencer. Isso pode duplicar a remocao no MESMO prefixo de uma
banda permanentemente excluida, mas nao pode redirecionar o alvo ou confirmar o
estado com token antigo. Exclusoes sao idempotentes e o UUID nao pode ser reusado.

## Limites, falhas e uploads tardios

Cada invocacao processa no maximo 3 jobs, 5 rodadas por job e 100 objetos por
rodada: ate 1500 caminhos solicitados, sujeito a orcamento de 20 segundos.
Abort global de 25 segundos, timeout por request de 6 segundos e maxDuration
Vercel 30 segundos. Nao ha loop infinito nem background promise apos responder.

Sempre listar offset=0, deletar o lote e listar novamente: incrementar offset
enquanto deleta pularia arquivos. Resposta de remove nao prova prefixo vazio;
somente listagem vazia permite confirmar outcome=empty. Falha parcial/perda de
resposta resulta em retry; nova execucao observa objetos realmente restantes.

Somente nomes de arquivo do contrato atual de upload sao automatizados:
`<UUID-v4>.(jpg|png|webp)`, diretamente sob `<band_id>/`. Pasta virtual, nome
legado/inesperado, duplicacao ou tentativa de escape resulta em needs_attention,
sem deletar nenhum item daquele lote. Nao ha delecao recursiva ou por prefixo
cego. Legados fora desse contrato exigem revisao administrativa separada.

Erros consecutivos tem backoff 5,10,20,40,80,160,320 minutos; na oitava tentativa
o job passa a needs_attention. Uma oitava tentativa interrompida tambem e
detectada apos expirar a lease. Nao ha rearmamento automatico de needs_attention.
Progresso confirmado ou verificacao vazia zera o contador de falhas consecutivas.
Lotes interrompidos por limite voltam a pending para continuar, sem perder alvo.

Primeiro scan vazio: pending, empty_since preenchido e nova verificacao em 24h.
Outro scan vazio separado por pelo menos 24h: completed. Qualquer objeto/falha
reinicia essa verificacao. **Completed e observacao de vazio, nao estado terminal:**
o mesmo job continua elegivel a reconciliacao apos 24h, indefinidamente. Um
upload tardio reabre a verificacao. Nao remover jobs completed enquanto nao houver
outro mecanismo revisado de deteccao de uploads tardios.

Essa estrategia nao impede a chegada de bytes ja autorizados e nao promete um
instante final absoluto; promove limpeza eventual enquanto o scheduler estiver
ativo e tiver capacidade. URLs publicas e caches podem sobreviver a remocao.

## Instalacao/ativacao futura (nao executadas)

1. Revisar/aplicar somente a nova migration em etapa autorizada. Nao reexecutar
   nem editar as migrations 180000/190000. Os testes locais nao usam o Demo.
2. Confirmar os tres grants exclusivamente para service_role, helper privado,
   indices, ausencia de acesso direto a fila e preservacao das ACLs anteriores.
3. Configurar SOMENTE no servidor/Vercel Production:
   - NEXT_PUBLIC_SUPABASE_URL: URL publica ja existente do projeto.
   - BANDUP_BAND_LOGO_CLEANUP_PROJECT_REF: referencia exata do projeto, 20 caracteres.
   - SUPABASE_SERVICE_ROLE_KEY: segredo administrativo server-only; nunca NEXT_PUBLIC.
   - CRON_SECRET: segredo aleatorio com 32..256 caracteres alfanumericos, _ ou -.
   - BANDUP_BAND_LOGO_CLEANUP_ENABLED=true: habilitar apenas apos instalacao/revisao.
4. Validar com banda/objetos sinteticos em ambiente autorizado, antes de liberar
   a operacao real. Nenhum teste local usa credenciais reais ou arquivos reais.
5. Fazer deploy/configuracao do Cron apenas em etapa futura explicitamente
   autorizada. Sem flag/segredo validos, o endpoint nao cria cliente privilegiado.

Vercel Hobby admite cron diario, mas horario pode variar dentro da hora e nao ha
retry automatico da invocacao. Backoff define a proxima elegibilidade, nao um
agendamento por minuto: a proxima janela/manual pode ser muito posterior. Uma
verificacao marcada para 24h pode perder a janela seguinte pelo jitter e esperar
outra janela. O volume e limitado; se a fila crescer, prever invocacoes adicionais
autorizadas ou plano/capacidade maiores. Nao ha SLA de remocao de logos em 24h.
Free pausado/indisponivel interrompe o progresso. Nao usar um cron local em memoria
no processo Next.js, nem adicionar Edge Function ou conexao SQL externa aqui.

## Monitoramento e recuperacao operacional

O endpoint retorna e registra somente contadores: claimed, emptyChecks, completed,
deferred, failures, lostLeases, objectsRequested, listCalls e deleteCalls.
objectsRequested conta caminhos ENVIADOS para remove, nao exclusoes comprovadas.
HTTP 503 indica falha/inconclusao; jamais retorna mensagens do SDK, tokens, IDs,
prefixos, nomes de arquivos ou respostas de claim. Nao habilitar tracing/HAR que
grave cabecalhos administrativos. Nenhuma funcao de Auth e chamada pelo worker.

Metricas duraveis agregadas da fila, para postgres (somente leitura):

```sql
SELECT status,count(*) AS jobs,max(attempts) AS max_attempts,
       min(next_attempt_at) AS next_due,
       min(last_scanned_at) AS oldest_scan,
       count(*) FILTER (WHERE status='processing' AND lease_until<=clock_timestamp()) AS expired_leases
FROM private.band_logo_cleanup_jobs GROUP BY status ORDER BY status;
```

Alertar em needs_attention, leases vencidas persistentes, HTTP 503, ausencia de
invocacoes, fila pendente crescendo e scans muito antigos. Rever logs agregados
da Vercel e definir retencao operacional. Depois de resolver a causa, um admin
pode rearmar SOMENTE o job revisado; nao liberar UUIDs nem IDs de operacao.
Servidor morto antes do ack deixa lease expirar; nao precisa desfazer remocoes.
Nao apagar dados da fila como forma de resolver falhas.

Rollback operacional: desabilitar a flag e remover/desativar o cron em etapa
autorizada; aguardar invocacoes/requests ja iniciados e leases vencerem. Manter
fila, tombstones e operacoes. Remocoes efetivadas no Storage nao sao desfeitas.
Nao usar DELETE em storage.objects ou operar no bucket avatars em nenhuma fase.

## Testes locais

Unidade/SDK/endpoint, com rede externa bloqueada:
`node --require ./tests/deny-network.cjs --test tests/band-logo-cleanup-worker.test.cjs`.
O SDK realmente instalado e exercitado com fetch inteiramente em memoria.

Contrato PostgreSQL: runner isolado existente, opt-in BANDUP_DELETE_LOCAL_TESTS=
create-isolated-cluster e `node tests/postgres/band-delete-isolated.cjs --execute`.
Instala a migration nova somente no cluster sintetico e verifica ACLs, banda viva,
rollback, claims concorrentes, fencing, retries, verificacao dupla e reabertura.
Nao acessa a API/Storage hospedada. O double de pg_cron existente e usado apenas
pelos testes da automacao dos recibos, nao para simular as RPCs deste worker.

Resultado local de 12/11/2026: 26 testes de worker/SDK/endpoint aprovados;
PostgreSQL com 53 checks de cascatas, 122 de RPC, 42 de Cron e 59 do contrato do
worker aprovados, alem de claims concorrentes e vencimento durante espera por
lock. Manifesto: `C:/Users/USURIO~2/AppData/Local/Temp/bandup-delete-core-QbKKqL/result.json`.
suitePassed, stopped e sourcesUnchanged=true. Lint completo e TypeScript aprovados.
As migrations 180000 e 190000 mantiveram seus hashes. A primeira tentativa local
nao iniciou pg_ctl no sandbox; a suite aprovada usou cluster novo isolado fora
do sandbox, encerrado no finally. Nenhum teste acessou o Demo/Storage real.
