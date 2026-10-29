# Publicação global: ramo de compatibilidade preparado

## Descoberta posterior: contrato histórico diferente

Foram lidos offline os 19 statements de `20261004120000_public_read_layer` no
ledger do backup. A [comparação histórica e proposta de testes](historical-public-read-layer-compatibility.md)
registra diferenças que o Bridge atual deve rejeitar, sem recomendar remoção
dos gates. O laboratório aprovado usou uma fixture sintética distinta. O arquivo
original continua ausente; conteúdo arquivado não comprova sua procedência.
Os resultados e avisos anteriores abaixo são preservados com esse limite.

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


Estado: implementação e testes SQL **preparados, não executados**. Nenhum acesso
a banco, produção, outro worktree ou laboratório é necessário nesta preparação.
O aplicativo continua consumindo `public_band_profiles` com as mesmas cinco colunas.

## Regra e alteração deliberada

| Banda | Link | Interfaces públicas antigas e nova |
| --- | --- | --- |
| privada | privado ou público | sem perfil/banda/eventos/links públicos dessa banda |
| pública | privado | perfil visível, link oculto |
| pública | público | perfil e link visíveis |

`bands.is_public` é validada e preservada, inclusive valores true. A nova
`social_links.is_public` é NOT NULL DEFAULT false: links existentes ficam privados
em TODAS as projeções. Isso é mudança intencional e deve ser comunicada, não
convertida em backfill automático de publicação. O default não apaga ou normaliza
URLs. Integrantes continuam lendo links privados pelas políticas internas.
Somente admin autenticado da própria banda altera publicação. Banda nova começa
privada; links não podem ser transferidos entre bandas. As regras M6/M8 continuam.

## Arquivos novos e contratos

- `supabase/migrations/20261028000000_legacy_publication_compatibility.sql`:
  exige o contrato legado revisado e os dois guards M6; cria reader exclusivo
  `bandup_profile_reader`, coluna de links, funções/triggers de publicação e view
  de perfis. Restringe IN PLACE a política `social_links_select_for_public_reader`
  e a definição de `public_social_links`, exigindo banda e link públicos.
- Não se adiciona uma política permissiva para "corrigir" a política antiga:
  a combinação OR manteria exposição. A alteração da política histórica é a
  exceção necessária e justificada à preservação, com mesmo nome/papel/comando.
- A view histórica mantém OID, colunas, tipos, owner, opções e ACLs. Suas linhas
  agora obedecem à regra aprovada. `public_bands` e `public_events` não são editadas;
  suas definições canônicas e condições de banda pública são conferidas.
- O único grant novo no reader antigo é SELECT da nova coluna de links, usada
  pelo filtro. Não se recria a role nem revoga membership antiga do executor.
- O reader novo não tem login/bypass, não é dono de fontes e não lê eventos,
  tarefas ou membros. Não há membership entre leitores e papéis da aplicação.
- O snapshot compara fontes, ACLs anteriores, guards, funções, constraints,
  memberships antigas e identidade/ACLs/opções das três views; somente as mudanças
  explicitamente listadas são excluídas e conferidas por pós-condições próprias.
- `supabase/migrations/20261028010000_legacy_external_link_url_safety.sql` é o
  ramo revisado da proteção de URLs: mantém corpos do validador e guard originais,
  valida seis políticas de links e os dois leitores, filtra URLs tanto na view
  agregada quanto na view antiga. Preserva identidades/ACLs e a ordenação JSON.

Os preflights abortam em colisão, sobrecarga, tipo/default/owner/ACL inesperado,
política pública adicional ou definição histórica diferente. NÃO usar
`IF NOT EXISTS`, remover gates ou substituir objetos para fazer a aplicação passar.
Equivalências de deparser não previstas também exigem revisão, não aprovação automática.

## Ordem: um ramo preparado não é uma sequência de produção determinada

**NÃO executar `supabase db push` nem aplicar todos os arquivos por ordenação.**
Os novos timestamps identificam propostas versionadas; não resolvem o histórico
divergente. O runner convencional tentaria a M7 original antes desses arquivos,
e ela rejeita o legado. A M9 original também é incompatível com o reader isolado
e as seis políticas. Não executar M7 e ramo substituto, ou as duas variantes de M9,
no mesmo destino. Nenhuma destas fontes insere versões no ledger por si só.

O caminho de instalação limpa original permanece documentado pelos dez arquivos
anteriores; os novos preflights são exclusivamente para o ramo legado. Não há
no-op silencioso para um schema de outro ramo. A automação de instalação limpa
precisa de manifesto de ramo explícito antes de incluir as propostas novas.

### Ensaio sintético futuro, somente com autorização separada

1. Preparar um NOVO cluster/destino descartável `bandup_publication_compat_test`
   em **127.0.0.1:5434**, PostgreSQL 17.11 UTF8, system identifier obrigatório
   **7701800113631615116**. O banco restaurado em **5433 é intocável e proibido**.
   Não criar/recriar o cluster informado nem parar/trocar servidores. A fixture cria um
   papel global: outro banco no mesmo cluster com bandup_public_reader existente
   não satisfaz o estado inicial. Não reutilizar produção nem assumir que o banco
   restaurado de dados reais seja descartável. O estado do laboratório foi informado
   pelo usuário; não foi verificado por conexão nesta preparação.
2. Revisar primeiro a [infraestrutura sintética](compatibility-lab-bootstrap.md),
   seu launcher, gate, bootstrap e verificações. Todos estão preparados, não executados.
   Em futura etapa autorizada, instalar bootstrap Auth/roles/grants e validar Auth
   antes das primeiras cinco migrations
   locais, M6 e M8, sem repetir migrations já instaladas. M8 deve estar verificada
   ANTES da compatibilidade. O launcher preparado aceita um artefato explícito por
   vez e não executa a sequência automaticamente. Verificar capacidades antes de fixtures.
   Após M8, selecionar **PostM8** para a conferência somente leitura descrita na
   [infraestrutura sintética](compatibility-lab-bootstrap.md#verificação-pós-m8).
   Ela deve terminar sem erros e com ROLLBACK antes de liberar a etapa 3. Não usar
   BootstrapChecks, NegativeBridge ou o bridge como substituto dessa conferência.
3. Executar separadamente `legacy_publication_fixture.sql`: cria um contrato
   legado SINTÉTICO e dados fictícios com COMMIT. Não é recuperação do SQL ausente
   `20261004120000`, nem prova de equivalência a produção.
4. Executar `compatibility_url_fixture.sql` (COMMIT sintético): preserva o corpus
   de URLs anterior ao upgrade. Executar `compatibility_negative_bridge.sql`
   (ROLLBACK): exige baseline válido e rejeita 28 mutações, revertendo cada uma.
   Aplicar uma vez `20261028000000_legacy_publication_compatibility.sql`.
   Verificar preservação de IDs, publicações de bandas, dados, ACLs e definições.
5. Executar `compatibility_interstage_publication.sql` e
   `compatibility_negative_url.sql`, separadamente com ROLLBACK, ANTES da etapa
   URL. Publicação por INSERT, UPDATE e UPSERT deve ser rejeitada com
   `social_links_url_stage_required`; as views não podem expor links.
6. Aplicar uma vez o ramo URL `20261028010000_legacy_external_link_url_safety.sql`.
7. Executar `publication_compatibility.sql` e `compatibility_public_band_profiles.sql`
   e `compatibility_url_safety.sql`, em sessões separadas, cada uma com ROLLBACK.
   Conferir baseline após cada sessão.
8. Antes da M10, executar separadamente a fixture sintética
   `compatibility_functional_integrity_legacy_fixture.sql` (COMMIT deliberado).
9. Revisar e considerar a M10 original somente após confirmar seus contratos:
   PostgreSQL UTF8, 17 contratos de coluna, poderes de ownership/CREATE/TEMP,
   funções e triggers anteriores corretos conforme a fonte e **11 triggers**
   no total nas cinco tabelas. M10 não exige o reader antigo como owner da view.
   Ela não valida explicitamente o corpo da M8: isso continua sendo requisito.
10. Após M10, executar `compatibility_functional_integrity.sql`, depois as duas
   suítes de publicação e `compatibility_url_safety.sql` em sessões separadas.
   Esperados 16 triggers ao final. Não repetir os negativos de preflight após
   migrations posteriores: os baselines exigem a fase exata.
   As variantes de testes só mudam identidade do destino e reader da projeção;
   os casos de validação anteriores permanecem. Não aplicar fixtures SQL em produção.

Todos os scripts novos de teste executáveis incluem `publication_compatibility_target.sql`
(o corpus `compatibility_url_cases.sql` é include de dados temporários, usado só depois do gate)
antes de escritas, exigindo explicitamente via `psql -v`:
`bandup_expected_database=bandup_publication_compat_test` e
`bandup_expected_system_identifier=<valor previamente aprovado>`.
O gate agora fixa também o ID autorizado `7701800113631615116`; os valores `psql -v`
continuam obrigatórios e devem coincidir com ele. Não há descoberta automática
ou concessão de privilégios pelo gate. As allowlists dos outros ambientes não foram
ampliadas. O gate exige
admin local, fresh session e ausência de bypass/ownership nas roles da aplicação.

A contagem de triggers é 8 após M6, 10 após compatibilidade, 11 após URLs e 16
após M10. A mudança de políticas de links é 5 legadas para 6 (4 internas +
1 legada ajustada + 1 do novo reader). Esses números não substituem definições.

## Diferenças do banco restaurado e pendências de produção

A restauração `--no-owner --no-acl` não satisfaz, por si só, o preflight. Um reader
existir e aparecer em políticas não prova que tenha SELECT nas colunas ou seja
owner das views. O ramo aborta nesses casos: não reconstrói grants/owners
silenciosamente. Para ensaio de segurança, reconstruir SOMENTE as permissões
comprovadas em evidência autorizada, ou usar o contrato sintético acima.

**A aplicação em produção permanece bloqueada** até reconciliar, sem escrita:

- Projeto/branch/host/papel e SHA implantado; ledger real versus nomes locais,
  principalmente `20261004120000`, M6 e quaisquer execuções manuais posteriores.
  Não reparar ledger ou marcar M7/M9 como aplicadas por conveniência.
- Definições e dependências de todas as views, funções/RPCs, políticas, triggers,
  tipos, colunas/defaults, ACLs por coluna/tabela/schema e memberships transitivas.
  Identificar outros caminhos públicos que não constem do checkout.
- Leitores com NOBYPASSRLS, sem ownership de fontes, e consumidores externos das
  três views antigas. Confirmar absence de SELECT anônimo direto nas fontes.
- Defaults de privilégios do executor, event triggers DDL e grants de EXECUTE.
  A M10 original revoga explicitamente o reader histórico, mas não o novo: se
  defaults concederem EXECUTE ao novo reader, parar e preparar correção revisada,
  sem editar a migration histórica aplicada. Revalidar defaults entre etapas.
- Efeito aprovado de ocultar links antigos e bloquear publicação em INSERT;
  rotina administrativa/service_role sem auth.uid também será rejeitada ao
  tentar alterar flags. Usar fluxo administrativo autenticado, não bypass.
- Backups/PITR recuperáveis, janela, limites de locks, baselines e critério de parada.

O contrato do aplicativo foi mantido: `public-server.ts` consulta somente
`public_band_profiles`, `band-publication.ts` confirma acesso admin e gravações,
e a página pública usa no-store. Sem mudanças de frontend necessárias para o
contrato atual; testes novos devem comprovar que o controle de link vale para
TODAS as views. Não se presume que a versão publicada seja este checkout.
Caches de clientes/consumidores antigos precisam de avaliação: a mudança controla
leituras futuras no banco, não recolhe conteúdo já entregue.

## Recuperação e validação

Antes de COMMIT, erro aborta a transação: encerrar, comparar baseline e não repetir
automaticamente. Após COMMIT, não remover a coluna/política nem restaurar o filtro
antigo que expõe links privados. Preferir correção futura que preserve o filtro
global ou suspensão temporária e revisada do acesso público afetado. Reversão de
frontend não desfaz schema. Restauração/PITR exige plano para escritas posteriores.

Offline, sem SQL/rede: `node --test tests/publication-compatibility.test.cjs`.
Esses testes verificam contratos das fontes, igualdade dos corpos dos guards e
validador, projeções públicas, gates e preservação das suites. Não são parser
PostgreSQL, execução de triggers, comparação de dados ou validação Supabase.
SQL/runtime, concorrência, HTTP/Auth/PostgREST e recuperação continuam pendentes.

### Registro histórico da preparação anterior (não revalida esta revisão)

- 133 testes offline aprovados nas suítes de compatibilidade, URLs, integridade,
  dados/perfis públicos, formulários e sessão privada; zero falhas na rodada final.
- A suíte nova tem nove casos, incluindo preservação dos corpos SQL históricos,
  snapshots idênticos antes/depois, filtragem global, isolamento, gates e variantes.
- ESLint do novo arquivo de testes sem erros reportados.
- Revisão lexical das duas fontes SQL: delimitadores/parenteses balanceados,
  transações explícitas e sem DDL de ocultação de conflitos. Não há parser SQL
  PostgreSQL instalado nesta preparação e as fontes não foram compiladas.
- Não foram executados SQL, migrations, fixtures, suites SQL, bootstrap ou testes
  em banco. Nenhuma evidência de produção ou de laboratório foi criada aqui.

## Revisão de segurança de 28/10/2026

O [manifesto explícito](../supabase/compatibility-publication.manifest.json) seleciona
**M6 + M8 verificadas → compatibilidade → URLs legado → M10**. As cinco migrations
iniciais e a camada pública histórica revisada são pré-requisitos. M7/M9 originais
são alternativas excluídas deste ramo; a ordenação da pasta não é um runner.
O manifesto não executa SQL, não autoriza implantação e não reconcilia o ledger.
`supabase db push` continua bloqueado para este checkout.

Os preflights comparam hashes MD5 dos corpos históricos locais, linguagem,
assinatura, retorno, segurança, volatilidade, configurações, proprietário e ACL.
Somente CRLF e whitespace ASCII nas bordas são normalizados. MD5 detecta deriva
das fontes; não comprova origem nem autentica conteúdo. São incluídos os helpers
de autorização, guards M6, M8 e triggers históricos; a segunda etapa também exige
os guards de publicação desta revisão. O verificador offline
`tests/publication-contracts.cjs` vincula esses blocos às fontes sem executar SQL.

São rejeitados triggers condicionais, UPDATE OF, argumentos extras, rebinding,
deferrabilidade, transições, desabilitação e inventário extra. Funções revisadas e
as cinco fontes devem ter o proprietário das bandas; diferenças legítimas exigem
revisão explícita. São conferidos RLS, ACLs por tabela/coluna, políticas PUBLIC e
dos leitores, acessos fora da projeção e falta dos grants necessários. Leitores
não podem escrever nas fontes. Anon/authenticated não podem receber memberships,
assumir o owner nem ter poderes elevados/CREATE nos schemas public e private.
O reader de perfis não pode ter memberships em nenhuma direção. O histórico só
admite membership de entrada do executor atual, sem ADMIN OPTION; não pode herdar
outras roles. Predicados canônicos são estritos, inclusive o alias `band`.
Definições aparentemente equivalentes precisam de revisão, não de bypass do gate.

### Intervalo entre etapas

Após o primeiro COMMIT, todos os links antigos estão privados e o guard rejeita
qualquer linha com `NEW.is_public=true` enquanto a função e o trigger de URLs não
existirem, com trigger habilitado, sem WHEN/UPDATE OF/argumentos e vinculado à função.
A segunda migration instala função, trigger e filtros nas duas views em
uma transação. Se falhar, links continuam privados; não remover o gate para liberar
publicação. Links privados podem receber URLs antigas nesse intervalo, mas não ficam
públicos. Não há promessa de recolher respostas/caches anteriores ao primeiro COMMIT
nem proteção contra um administrador que desabilite triggers.

### Cobertura preparada e limites

- Duas suítes negativas, **28 casos cada**, verificam baseline positivo antes/depois,
  exigem a mensagem de rejeição correta e desfazem cada mutação por subtransação.
  Falha ao executar a mutação é falha do teste. A sessão inteira termina com ROLLBACK.
- Corpus completo de **86 URLs**, compartilhado com os testes históricos: esquemas
  perigosos, credenciais, controles, barras invertidas, hosts/IP/portas e tamanho.
  NULL é validado diretamente; as outras 85 entradas são semeadas antes do upgrade,
  mantendo NOT NULL. INSERT, UPSERT, publicação e lote misto são exercitados.
- `public_social_links` e `public_band_profiles` são consultadas como anon após
  tentativas autenticadas. URLs inseguras devem continuar privadas, intactas e
  invisíveis; URLs aceitas devem aparecer nas duas projeções. O gate impede criar
  legitimamente um link inseguro público antes das URLs; os testes não desabilitam
  triggers para fabricar esse estado neste ramo.
- A suíte de publicação usa IDs próprios na contagem de links lidos pelo membro,
  permitindo coexistência com a fixture adicional. Fixtures com COMMIT exigem
  sessões separadas das suítes com ROLLBACK; nenhum teste é destinado a produção.

As novas suítes SQL estão **preparadas, não executadas nem compiladas por PostgreSQL**.
Os testes offline não provam RLS em runtime, concorrência, Auth/PostgREST ou o deparser.
A instalação permanece bloqueada até ensaio autorizado e reconciliação histórica.
Se defaults derem EXECUTE na M10 ao novo reader, sua pós-condição aborta: a fonte
histórica permanece intacta e a etapa fica bloqueada até correção futura revisada.
Revalidar defaults antes de M10; não alterar a migration histórica nem fabricar
versões aplicadas no ledger.

### Investigação do lockfile, sem alteração

O diff preexistente em `package-lock.json` remove somente `libc` de
`@next/swc-linux-{arm64,x64}-{gnu,musl}` (15.5.27). Versões, resolved e integridade
não mudaram; `package.json` não tem diff. A sessão tem Node 22.18.0 e npm 11.14.1.
Isso é compatível com regravação de metadados por ferramenta, mas a origem não foi
comprovada. Não houve instalação nem regeneração do lockfile nesta revisão. A remoção
reduz a seleção explícita entre glibc/musl; avaliar separadamente antes de incluir
esse diff num commit. O arquivo foi preservado.

### Verificação local desta revisão

- Suíte offline completa: 210 testes aprovados, zero falhas.
- Após reforçar também o gate com a identidade/habilitação do trigger URL:
  13 testes de compatibilidade novamente aprovados, zero falhas.
- ESLint dos dois arquivos JavaScript de compatibilidade sem erros.
- `git diff --check` sem erros. Nenhum build foi necessário para alterações SQL,
  de testes e documentação; nenhuma fonte Next.js foi alterada.
- Nenhum SQL, migration, fixture ou teste de banco foi executado. Nada foi enviado
  a produção ou a serviços externos; migrations históricas e lockfile preservados.

### Arquivos desta revisão

Na revisão de publicação anterior foram criados ou atualizados estes 20 arquivos;
a infraestrutura sintética posterior está listada em [seu documento](compatibility-lab-bootstrap.md).
Outros diffs preexistentes
foram preservados, inclusive `package-lock.json`:

- `supabase/migrations/20261028000000_legacy_publication_compatibility.sql`
- `supabase/migrations/20261028010000_legacy_external_link_url_safety.sql`
- `supabase/compatibility-publication.manifest.json`
- `supabase/tests/publication_compatibility.sql`
- `supabase/tests/compatibility_negative_bridge.sql`
- `supabase/tests/compatibility_negative_url.sql`
- `supabase/tests/compatibility_interstage_publication.sql`
- `supabase/tests/compatibility_url_cases.sql`
- `supabase/tests/compatibility_url_fixture.sql`
- `supabase/tests/compatibility_url_safety.sql`
- `tests/publication-contracts.cjs`
- `tests/publication-compatibility.test.cjs`
- `README.md`
- `docs/auditoria-final.md`
- `docs/publication-compatibility.md`
- `docs/supabase-missing-migrations-diagnosis.md`
- `docs/supabase-production-readonly.md`
- `supabase/tests/external_link_url_safety.md`
- `supabase/tests/functional_integrity.md`
- `supabase/tests/sql_test_execution.md`
