# Backend local de convites — candidato não aplicado

O SQL revisável está em `docs/band-invitations-backend-candidate.sql`, fora de
`supabase/migrations` intencionalmente. Nenhuma ativação de frontend ou alteração
da descoberta existente. Não usar `db push`/`migration repair`. O histórico remoto
divergente e o hardening pendente precisam de tratamento separado autorizado.

## Contratos

- `bandup_discover_musicians_for_invites(p_query='',p_offset=0,p_limit=20)` preserva
  a normalização e projeção da descoberta atual e acrescenta `musician_ref`.
  Indisponíveis e o próprio ator retornam referência nula. A descoberta antiga
  não é substituída. A referência é um UUID aleatório independente de Auth,
  não uma credencial. Seu mapeamento tem RLS e nenhuma permissão cliente.
- `bandup_invite_musician(p_band_id uuid,p_musician_ref uuid) -> uuid`: exige
  administrador atual, destinatário disponível, não membro e não o próprio ator.
  Não exige publicação da banda nem ausência de pedido de entrada.
- `bandup_decide_invitation(p_invitation_id uuid,p_decision text) -> text`:
  somente destinatário; `accepted` ou `rejected`. Aceite cria `member` e encerra
  pedidos pendentes do mesmo par como `superseded` na mesma transação.
  Disponibilidade é requisito de envio; desligá-la depois não revoga um convite.
  Remetente deixar de ser administrador não revoga o convite autorizado no envio.
- `bandup_list_invitations(p_band_id uuid=NULL,p_offset=0,p_limit=20)`: banda
  omitida lista recebidos do próprio ator, inclusive sem associação a banda;
  banda informada exige administrador atual e lista enviados da banda.
  Retorna `invitation_id,band_id,band_name,musician_ref,status,created_at,decided_at`.
  Não retorna `recipient_id`, `invited_by`, e-mail ou metadados Auth.

Estados terminais: `accepted`, `rejected`, `superseded`. Decidir novamente gera
`55000`, inclusive depois da saída da banda. Sem cancelamento/expiração nesta
etapa. UUID interno, UNIQUE parcial de pendentes, FKs e checks de datas/estado.
Exclusão da banda/destinatário remove convites; exclusão do remetente mantém o
histórico com `invited_by=NULL`. Tabelas sem grants/policies permissivas para
clientes; funções públicas com EXECUTE exclusivamente para authenticated.

## Aprovação existente e concorrência

O corpo real de `bandup_decide_entry(uuid,text)` não está versionado: existe
somente a assinatura, referências e fixtures sintéticas. Ele não é reescrito.
Na revisão pontual, o usuário confirmou owner postgres, SECURITY DEFINER,
search_path vazio e row_security=off, exigência de auth.uid()/admin e a ordem:
administrador em band_members FOR SHARE → banda FOR UPDATE → pedido FOR UPDATE
→ exigir pending → inserir member → atualizar approved. Rejeição somente
atualiza o pedido. Esse relato não equivale a um snapshot integral da função.
Uma trigger BEFORE UPDATE serializa a aprovação com a banda usando NOWAIT.
Uma constraint trigger inicialmente deferred exige associação ao fim da
transação e encerra os convites pendentes correspondentes. Assim suporta
aprovação que insere associação antes ou depois da atualização do pedido.
Recusa/rejeição deixa o outro processo intacto. Os checks conhecidos dos pedidos
são comparados com expressões parseadas antes de permitir `superseded`.
Divergência aborta tudo; não há correção automática de ACL ou constraints.

Envio e decisão exigem READ COMMITTED. Ordem principal: banda, associação do
administrador (envio), disponibilidade (envio), convite e pedidos (decisão).
Na ordem confirmada, a aprovação já detém o lock da banda ao chegar ao BEFORE:
readquiri-lo com NOWAIT na mesma transação não conflita. A verificação deferred
encontra o vínculo já inserido. Não foi demonstrada necessidade de alterar o SQL
candidato ou a RPC instalada para essa sequência.

Há inversão entre envio (banda → administrador FOR UPDATE NOWAIT) e aprovação
(administrador FOR SHARE → banda). O NOWAIT do envio interrompe a espera circular:
se a aprovação detiver SHARE e aguardar a banda, o envio aborta em vez de esperar
pelo administrador e libera a banda. Não remover NOWAIT nem substituí-lo por
espera bloqueante nesse ponto sem redesenhar a ordem. Aceite não precisa bloquear
o administrador; disputa a banda antes de convite/pedido. Aprovação aguardando
um aceite relê o pedido após obter os locks e deve recusar status superseded.
NOWAIT permanece nas linhas de convite/pedido para não esperar por caminhos
externos que possam já ter adquirido essas linhas em outra ordem.
Em contenção uma operação pode falhar com `55P03`; ela deve ser relida
antes de nova tentativa explícita. UNIQUE(band_id,user_id) protege associação.
Uma resposta perdida nunca autoriza repetir automaticamente uma mutação.
Isso não demonstra ausência de deadlocks em outras RPCs, triggers ou operações
externas; o novo trigger de aprovação exige READ COMMITTED.

Quotas iniciais: 5 convites pendentes por banda; 10 envios/24h por banda e
administrador; intervalo de 24h por par banda/destinatário, independentemente
do resultado. Advisory lock do administrador serializa envios entre bandas;
lock da banda serializa administradores diferentes. Histórico de todos os estados
conta. Não há limpeza de convites pelo cliente. Exclusão de contas/bandas pode
eliminar histórico; quotas não são uma proteção contra contas abusivas múltiplas.

## Teste e pendências de ativação

Executor: `tests/postgres/band-invitations-isolated.cjs`; cenários em
`band-invitations-scenarios.cjs`; fixture em `band-invitations-fixture.sql`.
Reutiliza o isolamento do executor de hardening, sem executar sua suite:
PostgreSQL 17 local, diretório aleatório com marcador, porta dinâmica diferente
de 5432/5433, loopback, ambiente PG limpo e identidade física verificada antes
de cada sessão. Não lê `.env` nem aceita URL externa. Ao terminar, para somente
o cluster próprio e verifica caminhos/marcador/symlinks antes de remover dados.

```powershell
$env:BANDUP_INVITATIONS_LOCAL_TESTS='create-isolated-cluster'
node tests/postgres/band-invitations-isolated.cjs --execute
```

Fixtures não certificam corpos remotos ou HTTP/Auth real. Antes de ativação:
validar hardening aplicado, revisar corpo real da aprovação/triggers/policies,
ordem de locks e constraints, e revisar inventário de exclusão de bandas (o
preflight de `20261112180000_band_delete.sql` enumera FKs e rejeitaria a nova FK).
Não foi alterada essa migration histórica. A nova FK usa ON DELETE CASCADE.
Não executar migrations antigas para instalar esse candidato.

Validação local em 2026-11-16: 16/16 cenários aprovados no PostgreSQL 17 isolado,
incluindo as duas direções de concorrência, quotas, rollback, privacidade e
reutilização negada após saída. Cluster próprio encerrado e removido ao final.

Revisão pontual de locks: `band-invitations-compatibility.cjs` modela somente as
características confirmadas pelo usuário, sem substituir a fixture dos 16
cenários nem afirmar que contém a RPC real. Executar apenas essa seleção:

```powershell
$env:BANDUP_INVITATIONS_LOCAL_TESTS='create-isolated-cluster'
node tests/postgres/band-invitations-isolated.cjs --execute --compatibility
```

Os casos verificam aprovação com inserção primeiro e encerramento deferred,
rejeição, conflito SHARE/UPDATE no administrador e concorrência aprovação/aceite
nas duas direções. O SQL candidato permanece intacto nesta revisão pontual.
Resultado desta revisão: 5/5 cenários específicos aprovados em PostgreSQL 17
descartável; cluster encerrado e removido. Os 16 cenários anteriores não foram
reexecutados. Sintaxe Node e ESLint dos dois arquivos de teste/executor passaram.

Integração frontend fica para próxima etapa: acrescentar `superseded` ao
`EntryStatus` de `src/lib/band-entry.ts` e ao mapa de rótulos de
`src/components/band-entry-flow.tsx`; novo serviço TypeScript de convites;
descoberta com seleção de banda administrada; recebidos no dashboard mesmo sem
bandas; enviados em membros da banda. Usar flag própria desativada até validação.
A documentação Next em `node_modules/next/dist/docs` não está instalada; nenhum
código de aplicação Next foi modificado nesta etapa.

## Inicialização concorrente — correção pontual de 2026-11-17

Antes, o backfill precedia CREATE TRIGGER: uma alteração de disponibilidade
confirmada entre essas operações podia ficar sem referência. Agora a instalação
exige READ COMMITTED no preflight (outro isolamento aborta com 25001), cria a
trigger no fim do candidato e só então executa o backfill, seguido de COMMIT.
Contratos, dados de disponibilidade e comportamento das RPCs não foram alterados.

CREATE TRIGGER já adquire SHARE ROW EXCLUSIVE em musician_availability e mantém
esse lock até o fim da transação. Não foi adicionado LOCK explícito nem modo mais
amplo. O lock aguarda escritores anteriores; o snapshot novo do backfill inclui
suas alterações confirmadas. Novos INSERT/UPDATE/DELETE aguardam a instalação e,
após commit, INSERT/UPDATE de available passam pela trigger. SELECT comum continua
permitido. Instalar a trigger somente no fim reduz a retenção desse lock ao DDL,
backfill e commit, em vez de retê-lo durante a criação das demais funções/tabelas.
Os demais locks preexistentes do candidato não foram ampliados por esta correção.

lock_timeout='3s' continua limitando cada espera de aquisição de lock;
statement_timeout='30s' limita cada comando, inclusive o backfill. Não são um
limite global da transação. Não pausar a execução entre trigger/backfill/COMMIT.
Se houver timeout/erro, parar no primeiro erro e encerrar com rollback: nenhuma
instalação parcial deve ser mantida. Escritores concorrentes podem esperar ou
atingir seus próprios timeouts; a execução futura requer janela breve apropriada
ao volume da tabela. Não aumentar timeouts nem alterar ACL para forçar instalação.

Teste específico (não executa os 16 gerais nem os 5 de compatibilidade):

```powershell
$env:BANDUP_INVITATIONS_LOCAL_TESTS='create-isolated-cluster'
node tests/postgres/band-invitations-isolated.cjs --execute --installation
```

4/4 cenários aprovados em PostgreSQL 17 descartável: rejeição de REPEATABLE READ
e SERIALIZABLE antes de criar objetos; INSERT e UPDATE do escritor anterior
incluídos no backfill após espera pelo commit;
INSERT/UPDATE posteriores bloqueados até commit e sincronizados pela trigger,
com SELECT permitido; timeout original de 3s revertendo integralmente o candidato
e preservando o escritor concorrente. O teste usa o candidato real dividido em
pontos de sincronização, sem reescrever seu corpo para os casos concorrentes.
Cluster encerrado/removido; sintaxe Node e ESLint dos executores passaram.
Isso não valida o Demo, sua volumetria ou seu conjunto real de objetos.
