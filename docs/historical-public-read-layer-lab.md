# Ensaio histórico independente — preparado, não executado

Preparação de 29/10/2026. Nenhum banco foi acessado, nenhum cluster foi criado e
nenhum SQL foi executado nesta implementação. Os artefatos reproduzem o conteúdo
registrado no ledger do dump, não o arquivo histórico original nem a produção.

## Bloqueio de identidade obrigatório

Não existe identidade aprovada para o novo cluster. Por isso
`supabase/tests/historical_lab_identity_check.sql` lança uma exceção incondicional.
Todos os pontos de entrada SQL o incluem antes de objetos ou dados. Essa recusa
é intencional, não deve ser retirada para executar o ensaio.

Os includes `historical_public_read_layer_contract.sql` e
`historical_public_read_layer_data.sql` também definem ON_ERROR_STOP e invocam
diretamente o mesmo gate antes de qualquer trabalho. Executá-los isoladamente
não contorna mais a recusa. Não há variável de sessão ou flag psql de confiança
que substitua a verificação. A futura implementação do gate precisa revalidar
identidade e contexto do procedimento revisado em cada invocação, na mesma
sessão/transação. Hoje todas essas invocações continuam incondicionalmente
bloqueadas; um arquivo SQL não impede por si só uma conexão manual ao alvo errado.

Uma revisão futura deve vincular o gate a host loopback, porta nova, banco novo,
system identifier real previamente aprovado, PostgreSQL 17.11 UTF8 e sessão
administrativa fresca. Deve rejeitar explicitamente **5433**, **5434** e o cluster
`7701800113631615116`. Não basta criar outro banco: as roles são globais ao cluster.
O cluster atual e o restaurado permanecem intocáveis.

Não foi reutilizado nem modificado `Invoke-CompatibilityLab.ps1`. Não há launcher
novo autorizado a conectar. Antes de executar, revisar um procedimento independente
que fixe identidade, neutralize overrides PG e passe pelo gate na mesma sessão
antes de cada artefato, inclusive migrations sem gate próprio. A publicação e
`supabase db push` continuam bloqueados. Não registrar versões no ledger.

## Arquivos e fronteiras de confiança

| Arquivo em `supabase/tests/` | Finalidade |
| --- | --- |
| `historical_public_read_layer.statements.json` | 19 strings decodificadas, metadados de origem e hash canônico |
| `historical_lab_identity_check.sql` | Recusa incondicional até revisão de uma identidade independente |
| `historical_lab_bootstrap.sql` | Bootstrap Auth sintético existente, com gate independente; COMMIT futuro |
| `historical_post_m8.sql` | Mesmas verificações PostM8 existentes, com gate independente; READ ONLY/ROLLBACK |
| `historical_public_read_layer_fixture.sql` | Os 19 elementos na ordem arquivada; wrapper/precondições novos; COMMIT futuro |
| `historical_public_read_layer_contract.sql` | Include de verificações e views temporárias esperadas; sem transação própria |
| `historical_public_read_layer_data.sql` | Include de dados fictícios, somente dentro de transação gated com ROLLBACK |
| `historical_public_read_layer_checks.sql` | Baseline positivo, comportamento temporal, views e negações exatas de privilégio |
| `historical_public_read_layer_negative.sql` | 31 mutações isoladas; erro de setup é falha; rejeição com SQLSTATE/mensagem exatos |
| `historical_bridge_rejection.sql` | Somente bloco reviewed_contract atual do Bridge, copiado exatamente; rejeição esperada por CREATE |

`tests/historical-public-read-layer-artifacts.cjs` só lê arquivos ao ser importado;
seus builders produzem texto em memória. O teste estático verifica sincronização
da fixture, bootstrap, PostM8 e bloco do Bridge, sem executar seus comandos.

A comparação do JSON usa UTF-8 de `JSON.stringify(statements)`, sem BOM ou newline
final: `51437fbe5bebfd41b6baac17d4be80956d7b952d4a385aa84f52391b50706445`.
É o hash da representação previamente analisada, não do JSON com metadados ou do
arquivo SQL original. O dump não é dependência dos testes estáticos.

## Ordem futura, após revisão e autorização separadas

1. Preparar fora deste procedimento um cluster novo, vazio e isolado; aprovar
   sua identidade e revisar o gate/procedimento. Não escolher ou descobrir o
   destino automaticamente e não apagar/recriar qualquer cluster existente.
2. Executar `historical_lab_bootstrap.sql` uma vez. Auth/roles/defaults são um
   ambiente sintético explicitamente declarado, não o ambiente histórico original.
3. Selecionar individualmente M1–M5, M6 e M8 pelos arquivos atuais revisados.
   M1–M5/M8 precisam de transação externa onde não têm uma própria. Não aplicar
   M7/M9 originais, Bridge, Url ou M10 nessa sequência de reprodução.
4. Executar `historical_post_m8.sql` e exigir sucesso/ROLLBACK antes da fixture.
5. Executar uma vez `historical_public_read_layer_fixture.sql`. O COMMIT pertence
   ao wrapper do ensaio, não é uma transação original comprovada. Não semear dados
   nem normalizar grants dentro dos 19 statements.
6. Executar `historical_public_read_layer_checks.sql`: dados temporariamente
   inseridos, sucesso e ROLLBACK. O reader vê eventos presentes/futuros de banda
   pública; anon usa as views; authenticated/service_role recebem 42501 nas views.
   O dado inseguro de URL visível é uma limitação histórica testada, não aprovação.
7. Executar `historical_public_read_layer_negative.sql`: baseline válido, 31
   rejeições exatas, baseline restaurado após cada mutação e ROLLBACK final.
8. Executar `historical_bridge_rejection.sql`: exigir exclusivamente P0001 com
   `Reader powers/membership/schema ACL differs`; ausência de erro ou qualquer
   outro erro falha. Conferir novamente o contrato histórico; ROLLBACK.
9. Encerrar a fase. Ela não aplica o Bridge inteiro: verifica sua primeira
   barreira revisada de segurança. Não afirma que os demais preflights passaram
   nem que o erro de CREATE seja a única incompatibilidade.

Capturar hashes dos arquivos efetivamente usados, saída final, identidade não
secreta, executor e baselines. Falha exige parar e revisar; sem retries, reparos,
limpeza automática ou retomada sobre estado desconhecido.

## O que é histórico e o que é hipótese controlada

São preservados `start_at >= now()` na política e view, CREATE persistente,
membership do executor, grants por coluna, owners/opções e grants diretos anon-only.
Retirar CREATE/membership ou conceder SELECT a authenticated deve falhar no
verificador de fidelidade. Isso não transforma CREATE em estado final seguro.

O ambiente controlado usa roles de aplicação sem heranças, defaults revisados,
RLS habilitada e executor dono das fontes, sem atribuir esses fatos ao backup.
Os statements não descrevem todo esse estado. Grants efetivos e diretos são
conferidos separadamente. As funções temporárias do teste usam SECURITY INVOKER;
o teste das fontes acontece sob o reader, não como superuser.

### Controles adicionais de grants e membership

O checker exige entradas diretas de ACL, via `pg_namespace.nspacl` e
`aclexplode`, com conjuntos exatos e sem grant option: reader recebe CREATE/USAGE
em public; anon/authenticated/service_role recebem USAGE em public/auth;
authenticated recebe USAGE em private. Reader não recebe grants em auth/private,
nem anon/service_role em private. Os grants de aplicação são pressupostos
sintéticos do bootstrap/M1, não comandos atribuídos aos 19 statements.
O acesso efetivo é conferido separadamente: USAGE de PUBLIC ou herdado não
substitui uma entrada direta. O bootstrap também confirma seus grants diretos
de USAGE em public/auth. Um negativo conserva explicitamente USAGE via PUBLIC
enquanto retira apenas o grant direto do reader.

Para a membership arquivada, o perfil controlado exige sessão fresca de
superuser com atributo INHERIT, sem alterar o GRANT histórico. No PostgreSQL 17,
ADMIN de uma nova membership assume false, SET assume true e INHERIT deriva do
atributo do membro recebedor (executor), não do NOINHERIT da role concedida.
O checker exige uma única entrada para o executor com ADMIN=false,
INHERIT=true e SET=true, sem memberships de saída do reader. Também confere o
grantor bootstrap superuser (OID 10 no PostgreSQL 17): grants de superuser são
registrados sob esse grantor. São expectativas declaradas deste ambiente,
não prova das opções ou da identidade do executor original. Negativos alteram
individualmente ADMIN, INHERIT e SET e exigem rejeição exata.

Referências de semântica: [GRANT no PostgreSQL 17](https://www.postgresql.org/docs/17/sql-grant.html),
[pg_auth_members](https://www.postgresql.org/docs/17/catalog-pg-auth-members.html)
e [catálogo inicial pg_authid](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/include/catalog/pg_authid.dat).

Passado/presente/futuro usam o mesmo `now()` transacional. A leitura direta do
reader detecta perda do filtro na política mesmo que a view continue correta.
O checker mantém PUBLIC, escrita, bypass, ownership e grants extras rejeitados.
Os negativos não consideram uma mutação que falhou como rejeição bem-sucedida;
qualquer erro ou mensagem diferente do esperado propaga a falha.

As restrições temporais/ACLs alternativas não são aceitas pelo Bridge atual.
Uma transição exigirá decisões separadas sobre preservação temporal, retirada
explícita de CREATE/membership e eventual ampliação de acesso a authenticated.
Migrations propostas, fixtures e resultados do laboratório sintético permanecem
inalterados. Não usar estes artefatos para produzir uma migration substituta ou
modificar o ledger.

## Verificação offline e limitações

`node --test tests/historical-public-read-layer.test.cjs` lê apenas fontes locais.
Verifica hash, ordem dos statements, sincronização, gates, sentinelas de rollback,
SQLSTATE/mensagens esperados e cenários estáticos. Não é parser PostgreSQL nem
validação runtime de SQL, RLS, transações ou permissões. Nenhum resultado SQL novo
é declarado; os arquivos estão preparados, não compilados/executados no servidor.

O arquivo original/procedência seguem não comprovados, ledger não reconciliado,
produção, Auth/PostgREST, concorrência e recuperação pendentes. Consulte a
[comparação histórica](historical-public-read-layer-compatibility.md) e os
[resultados sintéticos anteriores](compatibility-lab-evidence.md).
