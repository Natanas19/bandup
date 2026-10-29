# Bootstrap sintético de publicação — preparado para revisão

## Atualização de evidências — 28/10/2026

O usuário confirmou a execução bem-sucedida do laboratório de compatibilidade em
PostgreSQL 17.11, porta 5434: M1–M6 e M8, fixtures sintéticas, Bridge → Url → M10
e suítes nas fases previstas. Após M10, Publication, Profiles e UrlTests foram
repetidas com ROLLBACK e sem erros; FunctionalTests também passou após M10.
Esta consolidação não executou SQL nem acessou bancos. O [registro consolidado](compatibility-lab-evidence.md)
distingue o relato confirmado dos hashes dos arquivos atuais; não há logs ou
hashes comprovadamente executados anexados. Produção permanece bloqueada: artefato
20261004120000 ausente, ledger não reconciliado, validação de produção pendente e
`supabase db push` bloqueado.

Os avisos de preparação/não execução e contagens abaixo são registros históricos
das respectivas revisões, não o estado atual do ensaio informado.


**Nenhum script desta infraestrutura foi executado. Não houve conexão ou SQL.**
Destino informado pelo usuário: PostgreSQL **17.11**, UTF8, **127.0.0.1:5434**,
banco **bandup_publication_compat_test**, system identifier **7701800113631615116**.
A porta **5433 é proibida**: pertence ao banco restaurado e permanece intocável.
Produção e qualquer outra identidade são rejeitadas. Não alterar serviços PostgreSQL.

## Arquivos e responsabilidades

| Arquivo em `supabase/tests/` | Função |
| --- | --- |
| `Invoke-CompatibilityLab.ps1` | Launcher Windows preparado; conexão fixa e lista fechada de artefatos; uma etapa por chamada |
| `compatibility_lab_identity.sql` | Consulta de identidade em transação READ ONLY antes do artefato, na mesma sessão psql |
| `compatibility_lab_identity_check.sql` | Núcleo compartilhado, incluído dentro das transações das fixtures antes de escritas |
| `compatibility_lab_bootstrap.sql` | Roles básicas e Auth mínimo, com preflight de vazio e COMMIT próprio |
| `compatibility_lab_bootstrap_checks.sql` | Verificações futuras de identidade simulada e ACLs; ROLLBACK |
| `compatibility_post_m8.sql` | Artefato PostM8: contratos de catálogo após M8, antes de fixtures; READ ONLY/ROLLBACK |
| `publication_compatibility_target.sql` | Gate existente das fixtures, agora delegado ao destino exclusivo 5434 |

As verificações offline ficam em `tests/compatibility-lab-infrastructure.test.cjs`
e `tests/publication-compatibility.test.cjs`. Elas leem os scripts como texto; não
os importam, avaliam ou executam. Nenhuma migration ou manifesto foi alterado.

## Duas barreiras antes das escritas

1. Antes de iniciar psql, o launcher fixa host e hostaddr em 127.0.0.1, porta 5434,
   banco e login administrativo `postgres`. Não aceita conexão, SQL ou arquivo
   arbitrário por parâmetro. Exige `-Artifact` da lista fechada e a opção explícita
   `-ExecuteReviewedSql`; a opção não substitui autorização humana de execução.
2. Depois de conectar, o primeiro arquivo confirma endereço/porta vistos pelo
   servidor, banco, system identifier fixo, versão exata, UTF8, superuser e sessão
   original. Usa READ ONLY e encerra com ROLLBACK. Erro ou identidade diferente
   interrompe psql com ON_ERROR_STOP antes do próximo arquivo. Não há reconexão
   entre o gate e o artefato.

O identificador do cluster só pode ser confirmado por consulta ao servidor.
Portanto, o mecanismo impede SQL de instalação/teste em destino não aprovado;
não promete verificar um cluster real sem conectar e executar metadados. A consulta
de identidade seria o único SQL enviado ao destino incorreto na porta fixa. Nesta
preparação, nem essa consulta foi executada.

O launcher usa `psql -X -w`, ignora psqlrc e limpa temporariamente variáveis `PG*`,
incluindo PGSERVICE, PGOPTIONS, destinos e credenciais herdadas. Restaura o ambiente
em finally sem imprimir valores. Sem `-PassFile`, desabilita pgpass implícito por
um caminho aleatório inexistente, sem criar arquivo. Se a autenticação exigir senha,
a execução falhará fechada; um PassFile explicitamente revisado, fora do Git e em
caminho absoluto de disco local, poderá ser fornecido em etapa autorizada. Senhas
não são parâmetros nem gravadas pelo launcher. Revisar também o executável psql
resolvido no PATH e as permissões do arquivo de credenciais antes de qualquer uso.
O pager fica desativado. Depois da identidade aprovada, são definidos limites de
statement/idle transaction de 60 segundos e lock de 5 segundos na sessão local.

A lista fechada respeita o manifesto e exclui M7/M9 originais. Ela não é um sandbox
para SQL adulterado: todos os arquivos e includes devem ser revisados antes de uso.
O launcher confere ordem e alternativas declaradas no manifesto, mas não comprova
que etapas anteriores foram executadas. Não há runner automático, retry, limpeza,
criação de banco/cluster, instalação de extensão, serviço ou reparo de ledger.
As migrations históricas não receberam gates internos: sua rota preparada de
execução é exclusivamente o launcher. Este mecanismo não impede um administrador
de ignorar o procedimento e usar outro cliente SQL diretamente.

## Conteúdo mínimo do bootstrap

- Cria `anon`, `authenticated`, `service_role` com NOLOGIN, NOINHERIT e sem poderes
  elevados, BYPASSRLS ou memberships. Service role aqui é um papel sintético limitado,
  não uma reprodução dos poderes do Supabase real.
- Cria `auth`, `auth.users(id uuid PRIMARY KEY)` vazia e `auth.uid() RETURNS uuid`.
  Todos pertencem ao executor; auth.users tem RLS habilitada e nenhuma política ou
  grant para a aplicação. O superuser do harness insere os usuários fictícios.
- `auth.uid()` é SQL, STABLE, SECURITY INVOKER, search_path vazio: prioriza o claim
  direto não vazio, depois o `sub` do JSON; sem identidade retorna NULL. UUID/JSON
  malformados produzem erro; não são convertidos silenciosamente em identidade.
- Revoga PUBLIC em Auth e concede às três roles apenas USAGE no schema e EXECUTE
  em uid. Em public concede USAGE e remove CREATE de PUBLIC e dessas roles.
- Não cria private, helpers BandUp ou readers. A primeira migration cria private;
  a fixture cria bandup_public_reader; o bridge cria bandup_profile_reader.
- Não instala pgcrypto, uuid-ossp, extensions, auth.jwt(), auth.role(), GoTrue,
  PostgREST, Storage ou Realtime. gen_random_uuid() é nativo no PostgreSQL 17;
  SQL/PLpgSQL são requisitos. Não copia Auth ou dados do banco restaurado.

O preflight rejeita roles já existentes, objetos/schemas de aplicação, extensões
além de plpgsql, event triggers, ACLs inesperadas de public e defaults de privilégios
do executor. Não há IF NOT EXISTS nem reparo implícito. O executor deve ter TEMP e
poderes de criação; o bootstrap não troca owners existentes. Fontes e funções
criadas nas etapas posteriores devem permanecer sob o mesmo executor.

Não alterar globalmente defaults de EXECUTE para fazer o ensaio passar: helpers
temporários das suítes dependem de acesso às suas funções. As migrations definem
os grants/revokes dos objetos persistentes. Defaults inesperados exigem revisão,
inclusive o bloqueio já documentado da M10 para grants ao novo reader.

## Revisão e ordem futura — não executar nesta preparação

1. Revisar os novos arquivos e os includes; confirmar o destino informado sem
   tratar os relatórios antigos como evidência de execução neste cluster.
2. Obter autorização separada para conexão/SQL, credencial local e escolha do
   artefato. O launcher requer PowerShell e psql instalados; não os instala.
3. Selecionar `Bootstrap`, depois `BootstrapChecks` em sessões independentes.
   Esta última confere ausência de identidade, fallback JSON, prioridade do claim,
   entradas malformadas e negação de acesso direto a auth.users nos três papéis.
4. Seguir M1, M2, M3, M4, M5, M6, M8; selecionar **PostM8** e exigir validação dos
   contratos e 8 triggers, sem erros e com ROLLBACK, antes de qualquer fixture. O launcher
   envolve M1–M5/M8 em BEGIN/COMMIT após o gate; preserva transações próprias de M6
   e demais arquivos. Nunca usar --single-transaction sobre toda a sequência.
5. Seguir o [procedimento de publicação](publication-compatibility.md):
   LegacyFixture → UrlFixture → NegativeBridge → Bridge → Interstage/NegativeUrl
   → Url → Publication/Profiles/UrlTests. Respeitar sessões separadas e baselines.
6. Somente depois preparar FunctionalFixture, revisar M10 e seguir FunctionalTests
   e regressões. Não antecipar a fixture funcional para antes do guard de URLs.

Cada seleção resulta em apenas uma invocação psql, com gate inicial e sem ledger.
Os includes das fixtures repetem a identidade dentro da própria transação. Fixtures
legada, de URLs e funcional têm COMMIT deliberado; testes de verificação terminam
com ROLLBACK. Erro, interrupção ou perda de conexão exige inspeção do estado antes
de qualquer próxima etapa; não há garantia de que uma queda perto de COMMIT desfez
uma etapa. Não repetir bootstrap após sucesso: as roles e objetos já existirão.

## Limites

Claims são definidos por sessão para simular usuários: não verificam JWT e não
representam autenticação HTTP. Os testes não comprovam Supabase completo, produção,
concorrência ou recuperação. Fixtures contêm valores deliberadamente inválidos;
este banco é exclusivamente sintético. SQL e launcher continuam sem validação em
runtime; uma atualização de versão/porta/cluster deve exigir nova revisão explícita,
nunca flexibilização do gate. O manifesto e suas alternativas permanecem intactos.

## Verificação pós-M8

O usuário informou COMMIT sem erros de M1–M5, M6 e M8 no laboratório 5434. Esse
relato não substitui a conferência dos contratos instalados. Foi preparado o novo
artefato explícito **PostM8**, associado a `supabase/tests/compatibility_post_m8.sql`.
Nenhum SQL dessa verificação foi executado nesta implementação.

O launcher repete o gate de identidade existente na mesma conexão e não envolve
PostM8 em BEGIN/COMMIT adicionais. O arquivo abre sua própria transação
**REPEATABLE READ READ ONLY**, confirma novamente a identidade e termina com
**ROLLBACK**. ON_ERROR_STOP e RAISE EXCEPTION interrompem na primeira divergência;
erro não produz um resultado de aprovação. Não há DDL, DML, objetos temporários,
troca de papel ou leitura de dados das tabelas. Os blocos DO consultam catálogos,
sem chamar as funções da aplicação ou exercitar triggers com escritas.

Cobertura estrutural:

- Exige a fase anterior ao legado: ausência dos dois readers e de outras tabelas,
  views ou relações públicas não previstas; exige schemas auth/private/public.
- Confere as cinco tabelas permanentes, sem herança/particionamento, RLS habilitada,
  FORCE RLS desabilitada e owner igual ao executor. Auth/private têm o mesmo owner;
  o banco pertence ao executor e public deve pertencer ao executor ou à role nativa
  pg_database_owner. Owners não são alterados; diferenças exigem revisão.
- Confere **40 colunas**: presença, tipo nativo, typmod, collation padrão, nulabilidade,
  defaults, ausência de identity/generated e colunas extras. Inclui `tasks.event_id`
  nullable da M5; flags de publicação ainda não podem existir.
- Confere **23 constraints**: oito PK/UNIQUE, dez FKs e cinco CHECKs, sem extras.
  Verifica validação, deferrabilidade, colunas e ordem das chaves, índices de suporte
  válidos e únicos, referências e ações das FKs. Em especial, a M5 exige SET NULL
  somente de event_id, preservando band_id; a FK composta de atribuição mantém NO ACTION.
  A CHECK de event_type é a versão aberta da M4, não a enumeração inicial.
- Confere as **20 políticas** derivadas de M1, M2 e M3, incluindo deletes somente
  para admins em tasks/events, comandos, permissividade, role authenticated e
  expressões USING/WITH CHECK. Expressões preservam agrupamento AND/OR: não se
  removem parênteses para considerar políticas diferentes equivalentes.
- Confere ACLs de tabelas/colunas/schemas, CRUD de authenticated, ausência de grants
  extras e de grant option, roles limitadas e sem memberships. Os readers ainda
  devem estar ausentes; não se concedem privilégios para fazer o teste passar.
- Reutiliza **literalmente `contractBlock('bridge')`** de
  `tests/publication-contracts.cjs`: nove funções históricas e oito triggers, com
  corpo, assinatura, owner, ACLs, atributos de segurança e configurações. Os triggers
  exigem nome, tabela, eventos, função vinculada, habilitação, ausência de WHEN,
  UPDATE OF, argumentos, deferrabilidade e transition tables, sem triggers extras.
  Com readers ausentes, os trechos destinados a leitores não entram em execução.
- M8 é confirmada pelo corpo revisado de `prevent_task_author_or_band_change()`
  e seu SECURITY DEFINER/search_path/row_security/ACL/owner, além do vínculo do trigger.
  Isso diferencia M8 da versão inicial que permitia transferências por admin;
  não é um teste comportamental por UPDATE nem prova de concorrência.

`tests/post-m8-contracts.cjs` gera a fonte SQL offline reutilizando o módulo
existente. Colunas e políticas são extraídas das migrations locais; os contratos
de constraints são explícitos e vinculados às fontes por testes estáticos.
`tests/post-m8-contracts.test.cjs` exige igualdade entre fonte gerada e artefato,
reuso literal, cobertura e ausência de operações de escrita/chamadas da aplicação.
Importar o gerador somente lê fontes; não gera arquivos automaticamente nem usa rede.

As comparações do deparser são estritas para PostgreSQL 17.11. Diferença de expressão
ou representação exige investigação; não relaxar o gate para obter aprovação.
MD5 dos corpos serve para detectar deriva, não comprovar origem. SQL/PLpgSQL e a
ortografia canônica das expressões não foram compilados nem validados no servidor.
Somente após autorização separada, execução de PostM8 e resultado sem divergências
deve-se considerar LegacyFixture. O manifesto e a sequência original não mudaram.

Validação offline desta implementação: **24 testes aprovados**, incluindo geração,
gramática das políticas, vínculo com fontes históricas, cobertura e ausência de
escritas; lint dos arquivos JavaScript envolvidos e parse AST do launcher sem erros.
`git diff --check` sem erros. Nenhum SQL ou launcher foi executado. Arquivos desta
etapa: `compatibility_post_m8.sql`, `Invoke-CompatibilityLab.ps1`, os dois arquivos
`tests/post-m8-contracts*.cjs`, `tests/compatibility-lab-infrastructure.test.cjs` e
os documentos `publication-compatibility.md` e `compatibility-lab-bootstrap.md`.

## Verificação desta preparação

- 18 testes locais de fontes aprovados, sem conexão ou execução dos artefatos SQL/PowerShell.
- ESLint dos dois arquivos de testes sem erros.
- Parser AST do PowerShell sem erros; o launcher não foi invocado.
- `git diff --check` sem erros. Sem build, SQL, conexão, commit, push ou deploy.

O registro de preparação inicial cria os cinco artefatos de infraestrutura da tabela
(antes da inclusão posterior de PostM8),
este documento e o teste `compatibility-lab-infrastructure.test.cjs`; atualiza o
gate `publication_compatibility_target.sql`, o teste `publication-compatibility.test.cjs`
e o procedimento `docs/publication-compatibility.md`. São 10 arquivos ao todo.
Manifesto, migrations, lockfile e arquivos dos outros laboratórios foram preservados.
