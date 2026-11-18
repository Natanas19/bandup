# Convites: instalação futura, contenção e recuperação

## Estado e limites

Documento operacional proposto em 2026-11-17. O arquivo indicado não estava
presente no workspace; este roteiro consolida o plano da conversa. Nenhuma
instalação, contenção ou recuperação remota foi executada nesta etapa. Não há
SQL de recuperação neste documento. Cada ação remota depende de autorização
específica; documentar um procedimento não autoriza executá-lo.

Artefatos de instalação:

- `docs/band-members-write-hardening-candidate.sql`.
- `docs/band-invitations-backend-candidate.sql`.
- Frontend preparado, com feature flag desativada.

Testes locais e prévia visual foram aprovados nas etapas anteriores. O candidato
`docs/band-invitations-containment-candidate.sql` foi criado e passou em 8/8
testes específicos em PostgreSQL 17 isolado. A auditoria local foi aprovada com
ressalvas. A contenção não foi aplicada nem validada no Supabase Demo; os testes
locais não certificam o estado remoto. Não repetir essas verificações sem mudança,
falha ou divergência que justifique novo teste.

## Evidências confirmadas e compatibilidade

Segundo as evidências do Demo fornecidas pelo responsável:

- `public.bandup_delete_band(uuid,text,uuid)` pertence a postgres, é SECURITY
  DEFINER, exige READ COMMITTED, utiliza locks e executa DELETE em public.bands.
- As seis FKs existentes para bands usam ON DELETE CASCADE; os triggers de bands
  e band_members foram identificados. Na consulta realizada não havia trigger
  personalizado em band_join_requests.
- `private.prevent_last_band_admin_removal` permite a exclusão em cascata quando
  a banda já foi excluída. Essa lacuna de compatibilidade está esclarecida;
  não desabilitar nem enfraquecer a proteção do último administrador.

A FK candidata de band_invitations para bands também usa CASCADE. O corpo
confirmado da RPC permite que a FK remova os convites ao excluir a banda,
incluindo seu histórico. Isso não demonstra uma execução integrada após instalar
os convites nem ausência de contenção com todos os objetos remotos.

O preflight da migration histórica de exclusão enumera seis tabelas e rejeitaria
a FK adicional dos convites. É uma guarda de instalação, não uma guarda executada
pela RPC em cada exclusão. Não reaplicar nem modificar essa migration para
instalar convites. O histórico remoto divergente não será reconciliado por este
roteiro: não usar db push, migration repair ou reaplicação histórica.

## Preparação, autorização e execução

1. Preparar identificação do destino, executor apto, janela breve, artefatos
   exatos e plano de contenção. Confirmar recurso de backup/recuperação disponível
   e seus limites antes da aplicação; não presumir restauração seletiva ou PITR.
2. Registrar versão e SHA-256 de cada script, versão do frontend, valor da flag,
   responsável, autorização e horário. Registrar o estado anterior relevante de
   ACLs/objetos e resultados sem copiar dados pessoais para logs operacionais.
3. Obter autorização para hardening e sua validação. Executar o candidato
   integral em transação própria, parando no primeiro erro. Verificar ausência
   de INSERT/UPDATE efetivos para clientes, preservação de SELECT/DELETE e dos
   fluxos de criação, aprovação e saída. Falha bloqueia o backend.
4. Obter autorização para backend e validação controlada. Executar integralmente
   o candidato em READ COMMITTED, em transação separada, sem pausas. Conferir
   objetos/ACLs/RLS, trigger de referências, cobertura de músicos disponíveis e
   contratos pela API. Validar envio, decisão, integração com pedidos e exclusão
   com CASCADE somente com dados descartáveis autorizados.
5. Liberar a flag apenas após os gates aprovados, sem divergências abertas e com
   autorização separada para rebuild/deploy. Registrar resultados e COMMIT de
   cada etapa; não repetir automaticamente mutações com resposta perdida.

O hardening usa ACCESS EXCLUSIVE em band_members. O backend altera constraints
de band_join_requests com lock exclusivo e usa SHARE ROW EXCLUSIVE na
disponibilidade durante instalação da trigger e backfill até COMMIT. SELECT
comum na disponibilidade continua permitido; escritas aguardam. Os limites de
3s por espera de lock e 30s por comando não limitam a duração global da transação.
Clientes concorrentes podem atingir seus próprios timeouts. Não ampliar limites
ou alterar grants/policies para fazer uma instalação passar.

## Classificar o resultado antes de agir

| Estado | Evidência mínima e ação |
| --- | --- |
| Não iniciado | Sem execução autorizada: manter a flag desligada e não inferir instalação pela existência de um arquivo ou pelo histórico de migrations. |
| Falha antes de COMMIT | Parar no primeiro erro; confirmar ROLLBACK ou término da sessão e verificar o estado da etapa. Não continuar fragmentos. |
| Instalação confirmada | Confirmação de COMMIT e estado persistido coerente em nova sessão autorizada, mais verificações da etapa. Confirmar só objetos não substitui conferir ACLs, constraints e trigger/backfill. |
| Resultado incerto | Perda de conexão perto do COMMIT: não presumir sucesso nem rollback; suspender a próxima etapa e reconciliar estado persistido com logs e artefato. Não reenviar o script. |
| Falha parcial entre etapas | Hardening confirmado e backend ausente/revertido é estado possível e seguro para manter a flag desligada; preservar o hardening. |
| Estado misto dentro de uma etapa | A transação integral deveria ser atômica. Objetos/ACLs incompatíveis com o resultado esperado sugerem execução fragmentada, concorrência administrativa ou estado anterior diferente; interromper e investigar, sem completar fragmentos. |

Registrar separadamente o estado do hardening, backend, validação e frontend.
COMMIT confirmado não significa validação aprovada. Após backend confirmado e
validação falha, tratar como incidente pós-COMMIT, não como instalação ausente.

## Contenção após COMMIT

### Frontend

Manter ou voltar a flag para desativada exige rebuild/deploy autorizado, pois é
uma variável pública incorporada ao build. Sessões antigas podem continuar com
o código anterior. A flag não é uma barreira de autorização e não impede chamadas
diretas às RPCs. Não declarar contenção do banco apenas porque a interface sumiu.

### RPCs de mutação

Candidato preparado em `docs/band-invitations-containment-candidate.sql`, testado
localmente e auditado com ressalvas, sem aplicação ou validação no Demo. Sua
execução exige autorização específica e revoga EXECUTE de authenticated somente
nas duas assinaturas de mutação:

- `public.bandup_invite_musician(uuid,uuid)` — interrompe novos envios.
- `public.bandup_decide_invitation(uuid,text)` — interrompe aceite e também recusa,
  pois ambas as decisões compartilham a mesma função. Bloqueio exclusivo de aceite
  exigiria outra mudança revisada; não improvisar alteração do corpo.

Antes de executar qualquer contenção, conferir os caminhos efetivos de EXECUTE
dessas assinaturas: authenticated, PUBLIC, memberships, outros grants e chamadas
indiretas por definers. A revogação estreita de authenticated só basta se não
houver caminho residual. Não revogar permissões de papéis compartilhados ou de
outras RPCs indiscriminadamente; divergência exige redesenho e autorização.
O candidato aborta integralmente diante de grants inesperados, inclusive PUBLIC
ou outros papéis; uma tentativa abortada não estabelece contenção. Wrappers
remotos privilegiados permanecem risco não certificado pela auditoria local.
Coordenar ausência de GRANT, alterações de papéis e DDL concorrentes: o candidato
não serializa essas mudanças administrativas.

Manter listagem/descoberta se estiverem seguras. Se o incidente envolver exposição
de dados, avaliar contenção específica das leituras em autorização separada.
Não conceder escrita direta em tabelas como substituição das RPCs.

Mudança de EXECUTE não cancela chamadas já iniciadas nem elimina a capacidade de
owners/superusers. Confirmar cessação das mutações clientes pela API e examinar
transações ainda ativas antes de declarar contenção concluída; cache/API e sessões
existentes precisam ser considerados. Cancelamento de sessões exige autorização
própria e avaliação do impacto. Não há garantia de congelamento global: aprovação
legada pode superseder convites e exclusão de banda/usuário ainda pode removê-los.
Se esses caminhos estiverem implicados, interromper a operação afetada e solicitar
contenção adicional específica, sem desabilitar triggers de integridade.

### Banco e dados

Após COMMIT, ROLLBACK não desfaz a etapa. Preferir manter esquema e dados,
conter entradas e corrigir para a frente com artefato separado revisado.
Preservar convites pendentes e terminais, datas, referências, associações criadas,
FKs, índices e constraints. Não reabrir decisões, recriar pendências ou remover
associações automaticamente. Não usar DROP, TRUNCATE ou limpeza de dados como
recuperação. Não restaurar indiscriminadamente permissões do hardening.

Na regressão pós-hardening, interromper o fluxo afetado e revisar o caminho
definer/permissão específico; não devolver INSERT/UPDATE direto aos clientes.
Na regressão pós-backend, manter o hardening mesmo se as RPCs de convites forem
contidas. Registrar decisões já confirmadas antes de qualquer correção de dados.

CASCADE continua intencionalmente ativo: preservação durante recuperação não
impede exclusões legítimas de bandas/usuários. Uma exclusão já confirmada não é
desfeita recriando a banda; tombstones e outros efeitos devem ser respeitados.
Se for necessária restauração, avaliar backup em ambiente separado e plano
específico de reconciliação autorizado; não sobrescrever o Demo nem prometer
recuperar histórico removido sem evidência de backup suficiente.

## Interrupção, recuperação e reabertura

Interromper novas etapas e solicitar nova autorização se ocorrer: estado incerto
ou misto, timeout repetido, regressão nos fluxos existentes, divergência de
ACL/trigger/constraint, falha de autorização, inconsistência de dados ou necessidade
de ampliar contenção, cancelar sessões ou alterar dados. Não fazer retry cego.

Antes de reabrir: causa identificada, correção específica revisada, testes
proporcionais à falha e validação controlada autorizada concluídos; reconciliar
mutações com resultado incerto e confirmar integridade e ausência de caminho de
escrita não autorizado. Repor somente os grants exatos registrados para as RPCs
contidas, sob autorização, preservando o hardening. Confirmar o comportamento
pela API antes de autorizar ativação do frontend.

Registrar em cada incidente: artefato/hash, estado de cada etapa, horário e
resultado observado, evidência do COMMIT ou da incerteza, contenção aprovada e
efetivamente aplicada, operações em curso, correção e critério de reabertura.

Pendências reais: confirmar os caminhos efetivos de permissão e wrappers no
destino apenas quando autorizado; avaliar chamadas em andamento, concorrência
administrativa e comportamento da API/cache/sessões. Os 8/8 testes incluem decisão
já executada aguardando COMMIT, sem certificar uma função ainda em execução ou
o comportamento da API. A compatibilidade informada da proteção do último
administrador não exige nova coleta sem sinal de mudança.
Próximo passo: obter autorização específica para a inspeção remota pendente antes
de qualquer futura aplicação. Execução da contenção e recuperação continuam
dependendo de autorizações específicas separadas; a recuperação deve repor somente
o EXECUTE originalmente registrado, sem grant option ou privilégios adicionais.
Este roteiro não autoriza instalação, alteração de ACLs ou deploy.
