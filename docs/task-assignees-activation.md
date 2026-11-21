# Ativação de múltiplos responsáveis

O [candidato de ativação](task-assignees-activate-candidate.sql) é uma virada
transacional fora do histórico de migrations. Ele mantém os vínculos espelhados
existentes e torna `task_assignees` a fonte de verdade. A coluna `assigned_to`
permanece como dado legado. A limpeza escalar já usada pela saída de integrantes
pode continuar zerando esse campo sem tocar nos vínculos. A FK com
`ON DELETE CASCADE` remove o vínculo do integrante que saiu. Preserve a proteção
do último administrador e a transferência de administração.

## Contrato para o frontend compatível

- A interface múltipla exige o contrato V2 detectado no banco e
  `NEXT_PUBLIC_BANDUP_MULTI_ASSIGNEES_ENABLED=true` no build. Mantenha a
  variável ausente ou falsa primeiro. Em V2 com a interface desligada, tarefas
  com vários responsáveis mantêm a lista ao editar o conteúdo.
- Leia `tasks.task_revision` e a relação `task_assignees(band_id, task_id, user_id)`
  quando o contrato V2 estiver disponível. Em **Minhas tarefas**, use um vínculo
  interno filtrado pelo próprio usuário e pelas bandas verificadas para que
  contagem e paginação sejam calculadas sobre tarefas atribuídas ao usuário.
- Use `bandup_save_task_v2` com a banda, ID, revisão esperada e campos de
  conteúdo, incluindo o evento. Use revisão nula e um UUID gerado pelo cliente
  na criação. Guarde o UUID até confirmar o resultado. `already_exists` significa
  recarregar a tarefa, sem presumir que o último payload foi aplicado.
- `p_assignee_ids = NULL` preserva a lista na edição. O array vazio a limpa.
  **Todos** é a lista explícita dos integrantes atuais. Não envie a lista em
  edições de conteúdo feitas por responsáveis que não são admin nem autor.
- Em conflito de revisão ou lock, recarregue antes de oferecer novo envio.
  Projeções selecionam colunas explícitas. Não leia `assigned_to` como o estado
  atual no modo V2. O fluxo de exclusão continua sujeito à RLS de admins.

## Antes de autorizar

No catálogo autorizado, confirmar owners, papéis e privilégios efetivos
(incluindo herança e grants por coluna), RLS de tarefas e vínculos, e as FKs
compostas. Confirmar que a política de leitura dos vínculos permite listar
responsáveis da própria banda e que não há política restritiva incompatível.
Inspecionar os corpos instalados da ponte, dos triggers de membros e do emissor
de notificações. Confirmar a ordem de locks dos caminhos de saída, remoção
administrativa e exclusão de banda. Inventariar RPCs, funções, jobs e integrações
que escrevem tarefas ou vínculos e atualizar os chamadores escalares antes da
virada. O preflight do candidato confere a forma das constraints, os triggers
esperados e a consistência do espelho, mas não certifica essas dependências.
O candidato revoga `TRUNCATE`, `TRIGGER` e `REFERENCES` dos papéis da API e de
`PUBLIC`, incluindo grants de `REFERENCES` por coluna. Um privilégio efetivo
herdado que permaneça após os REVOKEs aborta a transação. Revise a origem do
grant antes de repetir a instalação.

1. Testar o frontend de dois modos em ambiente controlado, ainda sem seleção
   múltipla. Em modo legado, manter o fluxo atual. Após identificar V2, usar
   exclusivamente a RPC e as leituras de vínculos, mesmo com a seleção múltipla
   desligada. Exigir atualização das abas e versões antigas durante a virada,
   pois suas escritas diretas serão recusadas e suas listas pessoais são escalares.
2. Guardar as definições exatas dos objetos e ACLs instalados. Ensaiar o candidato
   com uma cópia representativa e medir a espera por locks e a criação do índice.
   Planejar janela breve de baixa atividade. A transação bloqueia tarefas e
   vínculos, com limites de espera e de duração por comando.
3. Na janela autorizada, aplicar em uma única transação. Confirmar o contrato na
   API, testar criação, edição, saída e notificações com contas distintas e
   validar **Minhas tarefas** e o vínculo com eventos. Só então liberar a seleção
   múltipla para os usuários.

## Reversão

Uma falha antes do commit reverte a virada. Após o commit, pausar as escritas
antes de decidir a reversão e manter as leituras pelos vínculos. Só considerar
restaurar o fluxo escalar se uma verificação sob lock comprovar no máximo um
vínculo por tarefa. Nesse caso, reconstruir `assigned_to` a partir dos vínculos,
com a emissão de notificações desligada durante a reconstrução, e restaurar as
definições e ACLs capturadas numa transação ensaiada. Com vínculos múltiplos,
manter a fonte de verdade V2, suspender a escrita da RPC se necessário e corrigir
o problema sem reduzir a lista a um único responsável. Para uma pausa completa
de alterações pela API de tarefas, suspender também o `DELETE` direto de
`tasks` e conferir os privilégios efetivos. Restaurar os grants verificados
somente após validar a recuperação. A pausa não cobre escritores privilegiados
nem alterações de associação provocadas pela saída de integrantes.

## Ensaio local

`node tests/postgres/notifications-isolated.cjs --multi-assignees-integration`
executa o cenário de ativação e liga as chamadas reais do SDK, por um
interceptador HTTP de teste, às consultas e à RPC no PostgreSQL 17 descartável.
O cenário verifica o contrato e a reversão de uma gravação, sem validar o
PostgREST real ou a restauração do esquema escalar após o commit de ativação.

`node tests/postgres/notifications-isolated.cjs --multi-assignees-reversal`
ensaia a restauração do esquema escalar após o commit V2 com zero ou um
responsável, incluindo ACLs, políticas, ponte e notificações. Também ensaia
recusar a reversão escalar quando já há múltiplos vínculos, pausar a escrita
na API e retomar em V2 com os mesmos vínculos.

O PostgREST real ainda precisa de um ambiente descartável com serviço HTTP
ativo e autenticação local. Nesse ambiente, testar uma chamada autenticada e
uma negada, as projeções de `task_assignees` e a atualização do cache de esquema
com o serviço já em execução durante a ativação e a reversão. Ver
[cache de esquema](https://docs.postgrest.org/en/stable/references/schema_cache.html)
e [relações por FK](https://docs.postgrest.org/en/stable/references/api/resource_embedding.html).
