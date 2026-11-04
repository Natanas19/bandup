# Proposta de descoberta e entrada em bandas

Estado: **proposta bloqueada, não aplicada e não validada por PostgreSQL**.
Preparada em 03/11/2026 para revisão na branch `feature/security-record-ownership`.
Nenhuma conexão, SQL, migration, alteração no Supabase ou frontend faz parte desta entrega.
Não mover para `supabase/migrations`, incluir em launchers ou executar `db push`.

## Escopo e decisão

O schema efetivo de `bandup-demo` ainda não foi inspecionado. Os contratos abaixo
derivam das migrations locais, não de uma certificação do destino. A execução
permanece interrompida: candidato, rollback, teste SQL e teste concorrente têm
uma recusa incondicional antes de qualquer escrita. Não há flag para habilitar.
Remover essas recusas agora não é um procedimento autorizado. Uma próxima revisão
deve confirmar os contratos, vincular cada procedimento ao alvo exato e obter
aprovação explícita antes de produzir/aplicar a versão executável.

Esta proposta não exige `is_public`, `tasks.event_id`, views de publicação, M5,
M7 ou bridges de compatibilidade. Não substitui helpers, triggers, ACLs ou políticas
existentes. Cria somente dois novos objetos de dados e seis RPCs.

## Contrato de dados

- `band_join_directory`: uma linha por banda, com nome público e resumo escritos
  explicitamente pelo administrador e opção `accepting_requests`. Nenhum campo de
  `bands` é copiado automaticamente. Sem linha ou com opção falsa, não há descoberta
  nem novos pedidos. Desativar retira a banda da descoberta, mas não cancela pedidos
  pendentes: o administrador ainda pode decidir e o solicitante pode cancelar.
- `band_join_requests`: UUID, banda, solicitante do Auth, nome declarado (não
  verificado), estado, criação, decisão/autor e cancelamento. Nome não equivale a
  identidade verificada; não expõe e-mail nem consulta diretório de usuários.
- Estados: `pending -> approved | rejected | cancelled`. Sem edição/reabertura de
  histórico. Nova solicitação após recusa/cancelamento é permitida; índice parcial
  impede mais de uma pendente por banda/usuário. Integrante atual não solicita.
- Excluir banda/solicitante apaga seus registros por FK; excluir o administrador
  decisor limpa `decided_by`, preservando data/estado. Não é auditoria imutável.

## APIs propostas

| Operação | Contrato |
| --- | --- |
| `bandup_set_discovery(band_id, display_name, summary, accepting)` | Admin da banda; configura opt-in e textos públicos. |
| `bandup_get_discovery(band_id)` | Admin; lê configuração inclusive quando desativada. |
| `bandup_discover_bands(after, limit)` | Autenticado; pagina por UUID, limite 1–50, retorna apenas band_id, display_name e summary. |
| `bandup_request_entry(band_id, applicant_name)` | Autenticado; identidade vem de auth.uid(), banda deve aceitar e usuário não pode ser integrante. Retorna UUID do pedido. |
| `SELECT band_join_requests` | RLS: solicitante lê os próprios registros; admin lê recebidos da própria banda. Outros integrantes não leem recebidos. Paginar/filtrar no cliente. |
| `bandup_cancel_entry(request_id)` | Somente solicitante, somente pendente. |
| `bandup_decide_entry(request_id, decision)` | Somente admin atual; approved/rejected. Papel do novo integrante é sempre member. |

Erros esperados: `42501` acesso negado/indisponível; `22023` entrada inválida;
`23505` pendente duplicada/integrante existente; `55000` pedido terminal.
O futuro frontend deve traduzir erros, reconsultar estado após resultado ambíguo
e jamais assumir aprovação só porque um botão foi pressionado.

## Segurança, atomicidade e concorrência

As tabelas novas têm RLS e nenhuma escrita direta para papéis de aplicação. Só
requests recebe SELECT authenticated. Directory só é lida por RPCs limitadas.
As seis funções SECURITY DEFINER fixam search_path vazio, qualificam objetos,
verificam auth.uid() e têm EXECUTE apenas para authenticated. Não usam service_role
do cliente, SQL dinâmico, função de publicação ou papel fornecido pelo solicitante.
O owner elevado é parte da fronteira de confiança e precisa de revisão explícita.

A decisão protege o vínculo administrativo com FOR SHARE, bloqueia a banda e o
pedido, revalida estado e insere o integrante antes de registrar aprovação. Não
captura exceções nem divide aprovação em requisições separadas: qualquer falha
reverte ambos. Não há ON CONFLICT UPDATE em band_members nem promoção automática.
Se um admin adicionou o usuário por outro caminho enquanto o pedido estava pendente,
a aprovação falha por unicidade e preserva o pedido; pode ser recusado depois.

Decisões/cancelamentos disputam a mesma banda/pedido; apenas uma transição termina.
O perdedor recebe estado não pendente. A FK/unicidade é a proteção adicional do
vínculo. A solicitação também bloqueia a banda e checa participação no banco.
Locks são mantidos até COMMIT da chamada, inclusive se a função estiver numa
transação externa. Chamadas devem usar transações curtas. Política de timeout do
PostgREST/role precisa de revisão: SET LOCAL do candidato vale só para instalação.

A ordem membership -> banda -> pedido nas decisões/configuração é compatível com
o caminho local do trigger de último administrador. Triggers/operações concorrentes
do destino podem ter outra ordem. Deadlock/timeout deve abortar, nunca liberar
acesso; não há retry automático. Antes de repetir uma chamada ambígua, ler estado.

## Evidências e pré-requisitos pendentes

Antes de habilitar o candidato, obter em etapa separada autorizada:

1. Identidade exata do projeto de desenvolvimento, versão PostgreSQL, revisão do
   candidato e backup/restauração. Nenhum alvo é descoberto automaticamente.
2. Definições atuais de bands, band_members e auth.users; tipos, nullability,
   defaults, PKs/FKs, unicidade imediata (band_id,user_id), papéis admin/member e
   capacidade de INSERT de membership com apenas band_id/user_id/role.
3. RLS, ACLs, memberships de roles, default privileges, owners e todos os triggers
   dessas fontes. Comparar corpos dos helpers, não apenas seus nomes. Confirmar
   SELECT do próprio admin em band_members e que não há autoentrada nem leitura
   privada por outsiders nas políticas efetivas. Conferir Auth/PostgREST reais.
4. Contrato confiável de auth.uid(), ownership não manipulável e isolamento das
   claims no gateway. SQL com claims simuladas não valida JWT ou a camada HTTP.
5. Executor fresco capaz de DDL nas novas tabelas/funções e leitura/inserção nas
   fontes, com RLS bypass. Owners de fontes, administrador de banco e service keys
   são confiáveis; esta proposta não protege contra um DBA malicioso.
6. Ausência de colisões e de dependências externas. Revisar também event triggers,
   default ACLs e privilégio CREATE no schema public. O gate automático cobre
   apenas parte dos contratos; não comprova integridade das políticas instaladas.

Se qualquer contrato divergir, parar e ajustar a proposta com evidências. Não
aplicar migrations históricas por suposição, reparar ledger ou ampliar permissões
das fontes para fazer esta proposta passar.

## Validação futura, após aprovação separada

1. Criar/revisar um alvo descartável exclusivo com usuários sintéticos e identidade
   fixa de host/porta/banco/cluster. Não usar bandup-demo para fixtures. Os gates
   devem ser substituídos por validação dessa identidade em revisão autorizada;
   não reutilizar os gates dos laboratórios históricos nem removê-los como atalho.
2. Ensaiar sobre baseline mínimo compatível (sem event_id/is_public) e sobre baseline
   completo. Aplicar o candidato uma vez no alvo; ele não é idempotente. Revisar
   comportamento com grants/defaults equivalentes ao destino e colisões negativas.
3. Rodar `authorization.test.sql` com psql ON_ERROR_STOP. Todo o cenário termina
   com ROLLBACK. Testes criam fixtures sintéticas, helpers em pg_temp e uma função
   de teste sem EXECUTE para aplicação, com trigger na NOVA tabela de pedidos para
   injetar falha. Função/trigger de teste são removidos e também cobertos pelo rollback.
   Eles não alteram grants/políticas das fontes. Auth.users(id) precisa ser aceito
   pelo harness: se não for, preparar fixture sintética compatível antes do ensaio.
4. Rodar `concurrency.spec` com isolationtester da versão PostgreSQL do laboratório.
   O setup faz COMMIT de fixtures isoladas e teardown apaga somente seus IDs.
   Usar READ COMMITTED nas sessões para os SQLSTATE de estado terminal descritos;
   níveis mais fortes podem abortar por serialização (40001) em vez de 55000.
   Revisar saída das seis permutações: segundo decisor/cancelador bloqueia e depois
   recebe 55000; administrador removido enquanto espera deve receber 42501. As
   verificações finais devem retornar 1. É necessário produzir e
   revisar expected output no ensaio; ainda não há golden output nem execução.
   Após erro de harness, não presumir teardown: inspecionar só o alvo autorizado.
5. Validar catálogos/ACLs/RLS das novas fontes e RPCs, bytes/hashes usados, contagens
   e estado das fontes. Guardar logs completos, inclusive falhas e SQLSTATE.
6. Validar em Supabase isolado Auth/PostgREST com contas sintéticas distintas:
   músico, admin correto, admin de outra banda, membro comum e visitante. Conferir
   descoberta, filtros, dados retornados, decisão/cancelamento, perda de papel,
   acesso pós-aprovação e negação antes dela. Somente então propor execução no demo.

Testes SQL preparados cobrem: opt-in, dados privados inacessíveis, pedido duplicado,
integrante já existente, leitura própria/admin, acesso cruzado, cancelamento,
aprovação/recusa, tentativa de promoção, DML direto, claims ausentes, anon e
atomicidade com falha posterior ao INSERT. Concorrência usa sessões independentes;
teste sequencial não comprova concorrência. Verificações Node são apenas estáticas.

## Riscos e limites para a demo

- Descoberta é um opt-in distinto da publicação do perfil. Resumo e nome devem
  conter só dados escolhidos para descoberta; qualquer autenticado pode coletá-los.
- Nomes declarados podem se repetir. UI deve distinguir registros por UUID sem
  tratar o nome como credencial. Solicitações não revelam e-mails ou outros membros.
- Nova tentativa após recusa/cancelamento é permitida. Sem rate limiting/notificação;
  uso deve ficar restrito a contas sintéticas da demo até tratar abuso e retenção.
- Paginação por UUID é simples e limitada, sem busca textual, ranking ou snapshot.
- Há lock de banda por operação mutante. Bom para a escala da demo; medir contenção
  antes de ampliar uso. Não modificar o contrato para evitar locks por conveniência.
- Não há frontend nesta entrega. Também não há convites, perfis, promoção/remoção,
  alteração de tarefas/eventos, nem cancelamento automático por fechamento da banda.

## Rollback

Antes de COMMIT, qualquer erro na instalação deve encerrar/rollback a transação;
nunca continuar instruções manualmente. Depois de instalar, desabilitar o consumidor
da feature e preservar/exportar os metadados novos em ambiente autorizado.
`rollback.proposed.sql` também está bloqueado: exige revisão/approval separada.
Remove somente as seis RPCs e duas tabelas novas, sem CASCADE. Dependência inesperada
aborta. Nenhum helper/política anterior é removido.

**Integrantes já aprovados permanecem em band_members**. Removê-los automaticamente
seria perda de autorização de negócio e pode afetar tarefas e o último admin. Se
necessário desfazer um vínculo, exige decisão específica posterior; o rollback não
faz isso. Excluir tabelas perde histórico de pedidos e opt-ins, por isso requer
backup/retenção previamente definidos.
