# Triagem mínima de metadados para entrada em bandas

**Preparada, não executada.** Este roteiro não certifica `bandup-demo`, não aplica
a proposta e não altera seus bloqueios. Não utiliza histórico de migrations como
evidência de schema. Nenhum arquivo anterior foi alterado nesta preparação.

## Consulta e limites

Arquivo: [prerequisites-readonly.sql](prerequisites-readonly.sql).
É um único relatório SQL, com transação REPEATABLE READ READ ONLY, timeouts locais
e ROLLBACK. Retorna `section` e `details` (JSON) para facilitar revisão conjunta.

Lê somente catálogos PostgreSQL, nunca linhas de bands, band_members, auth.users,
pedidos, views públicas ou ledger. Não conta usuários/bandas, consulta JWT, configura
claims, troca role, chama auth.uid(), executa RPCs, triggers ou funções da aplicação.
Os deparsers pg_get_expr/pg_get_functiondef/pg_get_constraintdef/pg_get_indexdef/
pg_get_triggerdef e os verificadores has_*_privilege são funções internas de
metadados; recuperam definições/permissões, não executam o SQL recuperado.

Escopo: três tabelas de origem; todas as colunas de band_members (necessárias para
entender INSERT com campos omitidos), somente id de bands/auth.users; constraints,
índices, RLS e triggers pertinentes; funções referenciadas e helpers locais de
autorização; schemas public/auth/private; roles da aplicação/executor e seus
ancestrais/owners; ACLs padrão do possível executor; nomes dos novos objetos.
Event triggers habilitados são incluídos porque podem interceptar DDL do candidato.
Não se leem tabelas de tarefas/eventos/links nem definições das views de publicação.

Os resultados são metadados internos. Definições de funções/defaults podem conter
literais escritos por administradores: revisar antes de compartilhar, sem publicar
eventuais segredos ou informações pessoais embutidas em código. O relatório usa
OIDs para roles, sem inventariar nomes de contas. OID 0 em ACL/policy significa PUBLIC.

## Condições para uma execução futura

Nenhuma execução está autorizada nesta entrega. Em etapa separada autorizada:

1. Confirmar externamente o projeto exato `bandup-demo`, destino da conexão e role
   já autorizada. current_database() pode retornar `postgres` em vários projetos;
   não prova identidade do projeto. Não incluir senha/token/string de conexão na saída.
2. Usar sessão dedicada PostgreSQL 15+ com acesso aos catálogos necessários, sem
   transação anterior nem operação concorrente na mesma conexão. O script não faz
   conexão nem escolhe executor. Se o futuro owner da migration for outro, sua
   capacidade/default ACL não foi avaliada por esta sessão e deve ser revisada.
3. Executar o arquivo completo, parar no primeiro erro/timeout e encerrar com
   ROLLBACK ou desconexão. Não executar o candidato, fixtures ou testes SQL junto.
   Não aumentar privilégios, remover RLS ou tentar consultas de dados para contornar
   uma coleta incompleta. Não há retries automáticos.
4. Preservar todas as seções do relatório para revisão interna, com data e revisão
   dos arquivos. Se o cliente truncar JSON/linhas, considerar a coleta incompleta.

Não há alteração persistente: SET LOCAL afeta apenas a transação do diagnóstico.
Uma transação READ ONLY ainda utiliza recursos/locks de catálogo; os limites de
tempo reduzem o impacto, sem prometer ausência absoluta de contenção.

## Interpretação e bloqueios

| Seções | Confirmar | Bloqueia ou exige esclarecimento |
| --- | --- | --- |
| 01 | read_only=on; versão suportada; fresh_role=true para o executor futuro | Identidade externa incerta, role diferente da pretendida, sessão incompleta. |
| 02 | bands, band_members e auth.users presentes como tabelas ordinárias (`kind=r`) | Objeto ausente, view/particionamento ou outro tipo não contemplado pelo candidato. |
| 03 | bands.id e users.id UUID NOT NULL; band_members.band_id/user_id UUID NOT NULL e role text NOT NULL | Tipo/domain/enum divergente; campo obrigatório adicional sem default/identity compatível. |
| 03–05 | ID de membership gerável quando omitido; defaults dos demais campos aceitáveis | Default com dependência ausente, função insegura, restrição que impossibilite INSERT mínimo. Gerado/identity não significa automaticamente compatível. |
| 04–05 | PK/unique válida, não parcial, adequada para FK a bands.id/users.id; unicidade imediata validada `(band_id,user_id)` em band_members | Falta de chave referenciável; candidato exige constraint UNIQUE na ordem indicada, não só índice equivalente; índice inválido/não pronto; FK ausente/divergente. |
| 04 | FKs de membership para bands/auth.users; CHECK permite admin/member e impede papéis arbitrários | Vínculo sem integridade ou papéis com semântica divergente. Revisar ações ON DELETE/UPDATE. |
| 02, 06 | RLS habilitada em bands/band_members; leitura de membership próprio/admin da banda; mutações administrativas limitadas | Política que permite autoentrada, administração cruzada ou leitura privada por outsiders; ausência de SELECT necessário. |
| 07–08 | Trigger de criador/admin e proteções de último admin/identidade conforme contratos efetivos; INSERT member sem efeito inesperado | Trigger desabilitado, corpo divergente, dependência desconhecida, reatribuição/promoção automática ou ordem de locks incompatível. |
| 08, 21 | auth.uid() escalar UUID sem argumentos e contrato confiável de claims; pg_catalog.gen_random_uuid() escalar UUID | Função ausente, assinatura/tipo incompatível, corpo/owner não confiável. Nome sozinho não comprova contrato. |
| 09–12 | anon/authenticated sem superuser/bypass; não podem assumir/herdar o owner elevado do candidato | Membership direta/transitiva no owner; autenticado proprietário das fontes ou outro caminho elevado sem revisão. service_role pode ter bypass esperado, mas não deve herdar o owner do candidato, conforme seu gate. |
| 13–16 | Executor futuro pode criar em public, usar schemas e acessar fontes/funções necessárias; aplicação acessa só o previsto por ACL+RLS | Owner sem capacidade para SELECT/locks/INSERT/REFERENCES, privilégio inesperado por herança, schema privado sem USAGE quando requerido. |
| 17 | Defaults globais e de public do executor permitem o desenho de revogações explícitas | Grantee diferente dos previstos no gate do candidato; default ACL divergente/incompleta. Nenhuma linha significa defaults nativos, não ausência de permissões. |
| 18 | Todos os nomes propostos com present=false | Qualquer tabela, índice ou overload de RPC existente: parar, não substituir nem reaplicar. |
| 19–20 | Sem interceptador/regra inesperado, ou definição já revisada | Event trigger habilitado ou regra de reescrita que não tenha sido compreendido. Não desativar para aplicar. |

### Cuidados de leitura

- Roles/políticas: comandos de policy são `r` SELECT, `a` INSERT, `w` UPDATE,
  `d` DELETE e `*` ALL. Políticas permissivas se combinam por OR e restritivas por
  AND, conforme comandos e roles aplicáveis. Uma política segura não neutraliza
  outra permissiva. Avaliar USING e WITH CHECK, incluindo herança de roles.
- Grants: `has_table_privilege=true` não significa acesso irrestrito às linhas;
  RLS continua relevante. Grants por coluna também aparecem. O diagnóstico não
  tenta SELECT como usuários para descobrir o resultado efetivo das políticas.
- SELECT FOR SHARE/UPDATE exige privilégios de locking além de SELECT. O futuro
  owner precisa de UPDATE adequado em bands/band_members, INSERT em band_members,
  REFERENCES em bands.id/users.id e USAGE dos schemas usados, mesmo com bypass RLS.
- Funções: SECURITY DEFINER não é erro por si só; revisar owner, search_path,
  row_security, ACL e corpo. Funções SECURITY INVOKER usam o contexto do chamador.
  O proprietário elevado do candidato deve passar o gate e possuir os privilégios
  necessários. Privilegios do coletor não certificam outro futuro owner.
- As definições dos helpers/triggers locais são referências de comparação, não
  requisito de instalar todas as migrations. Helpers opcionais ausentes só bloqueiam
  se necessários ao contrato efetivo. Em particular, não exigir M5/M7, is_public,
  event_id ou a cadeia pública legada para esta feature.
- As seções 07–08 incluem definições já instaladas. Um trigger de membership pode
  mencionar tarefas em seu corpo; isso não consulta tarefas nem autoriza inspecionar
  seus registros. Dependências adicionais exigem revisão específica posterior.
- pg_depend não registra todas as chamadas em corpos PL/pgSQL/SQL definidos como
  strings nem SQL dinâmico. Ler os corpos; referência indireta não coletada deve
  ser documentada e solicitada em coleta adicional delimitada, nunca inferida.
- Event triggers habilitados são metadados globais relevantes à futura DDL. O
  script não cria DDL nem aciona esses triggers.

## Resultado esperado da triagem

Classificar cada contrato como **confirmado por metadados**, **incompatível** ou
**inconclusivo**. Nenhum resultado é gerado automaticamente como “aprovado”.
Qualquer incompatibilidade ou dependência crítica inconclusiva mantém aplicação
bloqueada. Falta de visibilidade de catálogo também é inconclusiva, não ausência
comprovada do objeto. Se a coleta não retornar funções/políticas/triggers que
outras definições referenciam, interromper a avaliação.

Mesmo com metadados compatíveis, continuam pendentes: revisão humana da proposta,
backup/restauração, ensaio SQL e concorrente em alvo isolado, autenticação/JWT e
PostgREST, compatibilidade comportamental e aprovação explícita para aplicação.
Não foram examinados dados, existência de bandas/membros concretos, histórico de
migrations ou integridade material das linhas. Esta triagem não remove os gates
de execução da proposta e não é um ensaio de instalação.
