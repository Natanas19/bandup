# Diagnóstico de produção do BandUp: roteiro somente leitura

Atualização de 28/10: as descrições de M7/M9 originais abaixo não selecionam o ramo
para o esquema legado. Consulte o [roteiro de compatibilidade](publication-compatibility.md)
e seu manifesto: M8 anterior ao bridge, alternativas originais excluídas e proteção
entre etapas. Esses artefatos continuam preparados, sem SQL executado; não mudam
as autorizações ou os limites de coleta deste diagnóstico.

## Estado e autorização

**Preparado; não executado, não conectado, não validado pelo PostgreSQL.** Esta
etapa autoriza somente revisão local, ajustes de documentação/roteiro e testes
offline. A separação agora é física, sem includes ou chamadas entre arquivos:

- **Fase 1:** [`supabase-production-readonly.sql`](supabase-production-readonly.sql),
  somente catálogos estruturais; não lê linhas do ledger nem tabelas da aplicação.
- **Fase 2:** [`supabase-production-readonly-data.sql`](supabase-production-readonly-data.sql),
  versões do ledger, contagens e legados; exige autorização posterior específica.

Cada arquivo tem sua própria transação READ ONLY e ROLLBACK. Nenhum deles concede
autorização de execução. Nenhum serviço, banco ou laboratório foi acessado.

Verificação reproduzível sem banco: `python docs/check_supabase_readonly.py`.
O [verificador offline](check_supabase_readonly.py) só lê os dois arquivos SQL,
testa uma allowlist lexical, casos negativos e o limite UTF-16; não é parser SQL,
não resolve tipos/objetos e não atesta o servidor. Executar sem `-O`.

Branch local: `feature/security-record-ownership`. O usuário informou que o código
está no GitHub, o Preview está Ready, a Production Branch é `main` e as migrations
9/10 passaram em laboratórios isolados. Também informou que Preview e Production
aparentemente compartilham Supabase. Esses fatos remotos não foram verificados
nesta etapa; o compartilhamento deve ser tratado como possível até confirmação.

## Pré-requisitos das migrations

### Atualização A1/A2 informada pelo usuário — 2026-10-27

Esta atualização é análise local do resultado informado, sem conexão ou execução
SQL pelo agente. A3–A10 não foram executadas nesta revisão. Os estados históricos
de preparação deste documento não devem ser confundidos com a coleta A1/A2 já
informada pelo usuário.

A1: `read_only=true`, PostgreSQL 17.11, UTF8, `rolsuper=false`,
`rolbypassrls=true`, `can_connect=true`. A2: as cinco tabelas existem como
`relkind=r`, com RLS habilitado e `executor_select=true`; o ledger existe;
`public.public_band_profiles` está ausente e `executor_rls_active=false`.
O bypass explica a RLS inativa para o executor; não significa RLS desabilitado
nas tabelas, nem comprova as políticas de `anon`/`authenticated` ou do reader.

**Conclusão: bloqueio para aplicar a Migration 9.** A criação original ocorre
na **Migration 7**, `20261020000000_public_band_profiles.sql`, linha 182.
A ausência só é esperada num estado anterior à 7 (por exemplo, 1–6 aplicadas).
Não é o estado esperado de uma base com 1–8 completas antes da 9. A1/A2 não
comprovam quais migrations foram aplicadas: pode haver atraso de migrations,
alvo incorreto ou drift. Se a 7 consta como aplicada e a view falta, há divergência
entre histórico e schema. Ausência no histórico tampouco prova ausência de DDL.

A Migration 7 usa BEGIN/COMMIT e cria também `is_public` nas duas tabelas,
o papel `bandup_public_reader`, duas funções/guards de publicação e duas
políticas de leitura. Marcadores parciais exigem investigação; não reaplicar a 7
automaticamente, pois seu preflight rejeita colisões. A 8 altera o guard de
autoria/banda das tarefas e não cria a view.

A Migration 9 (`20261027000000_external_link_url_safety.sql`) exige a view
no primeiro preflight (linhas 10–20) e aborta com
`URL safety requires PostgreSQL 15+ and the existing public profile schema`.
O `CREATE OR REPLACE VIEW` posterior não é um mecanismo de bootstrap.
Com a ausência informada, a transação falha antes do DDL novo; é necessário
encerrar a transação abortada com rollback, não continuar ou remover o guard.
Não usar a aplicação da migration como teste de diagnóstico.

Além de PostgreSQL 15+ e `private`, a 9 depende de: view histórica de tipo `v`,
owner reader sem poderes elevados, opções exatas `security_barrier=true` e
`security_invoker=false`, definição/colunas/ACLs históricas; reader sem CREATE
em public, sem memberships de anon/authenticated/service_role e sem ser dono
das fontes; RLS nas cinco tabelas e ausência de SELECT anônimo inclusive por
coluna; `social_links.url` text NOT NULL e `is_public` boolean NOT NULL default
false; guard de publicação habilitado, único trigger de usuário em social_links;
cinco políticas nessa tabela e política reader de bands com expressões/papéis
esperados; ausência das funções/trigger novos e dos temporários reservados.
O executor ainda precisa dos poderes de DDL/ownership, TEMP e grants necessários;
`rolbypassrls` e SELECT não comprovam essas capacidades. A ausência da view também
impede a 10, que depende da 9 e referencia a view no snapshot.

**Próximo passo seguro:** conferir a identificação do projeto/branch Supabase
fora do SQL e obter, sob autorização separada, apenas os metadados focados abaixo.
Depois, reconciliar o histórico já disponível com os dez nomes locais, em especial
`20261020000000`, `20261023000000`, `20261027000000` e `20261027010000`.
A existência do ledger não informa suas versões. Sua leitura é de tabela comum,
foi adiada para a fase 2 e não está autorizada por esta atualização. Se necessário,
autorizar separadamente essa leitura após validar tipo, estrutura e permissões.
Também será necessário comparar definições, owners, ACLs, memberships, políticas,
triggers e dependências com o contrato histórico antes de qualquer reparo/aplicação;
a consulta curta abaixo só identifica marcadores, não atesta esse contrato completo.

Consulta mínima de triagem **preparada, não executada**. Somente catálogos,
sem linhas do ledger, dados de negócio, deparsers ou funções da aplicação.
Não chama nem substitui a execução de A3–A10. Para eventual sessão dedicada
futura, requer autorização própria; não executar os arquivos de diagnóstico inteiros.

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SELECT 'relation' AS category, n.nspname AS schema_name,
       c.relname AS object_name, c.relkind::text AS detail
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname = 'public_band_profiles'
UNION ALL
SELECT 'column', n.nspname, c.relname || '.' || a.attname,
       a.atttypid::text
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE a.attnum > 0 AND NOT a.attisdropped AND
 ((n.nspname = 'public' AND c.relname IN ('bands','social_links')
   AND a.attname = 'is_public') OR
  (n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations'))
UNION ALL
SELECT 'role', NULL, r.rolname, NULL
FROM pg_catalog.pg_roles r WHERE r.rolname = 'bandup_public_reader'
UNION ALL
SELECT 'function', n.nspname, p.proname, p.pronargs::text
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname IN
 ('guard_band_publication','guard_social_link_publication',
  'is_safe_external_url_v1','guard_external_link_url_v1')
UNION ALL
SELECT 'trigger', n.nspname, c.relname || '.' || t.tgname,
       t.tgenabled::text
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname IN
 ('bands_guard_publication','social_links_guard_publication',
  'social_links_zz_guard_external_url')
UNION ALL
SELECT 'policy', n.nspname, c.relname || '.' || p.polname, p.polcmd::text
FROM pg_catalog.pg_policy p
JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND
 ((c.relname = 'bands' AND p.polname = 'bands_select_for_profile_reader') OR
  (c.relname = 'social_links' AND p.polname = 'social_links_select_for_profile_reader'))
ORDER BY 1, 2, 3;
ROLLBACK;
```

Nenhuma linha de marcador significa ausência no catálogo consultado, não prova
histórico de aplicação. View homônima em outro schema não satisfaz a Migration 9.
Em erro/timeout, parar e encerrar com rollback; não conceder privilégios ou repetir
automaticamente. A consulta não foi validada por execução PostgreSQL.

A ordem dos dez arquivos é: schema inicial → exclusão administrativa de tarefas
→ exclusão administrativa de eventos → tipos personalizados de evento → vínculo
opcional tarefa/evento da mesma banda → guards de propriedade de eventos/vínculos
→ publicação e view pública → autoria/banda imutáveis de tarefas → URLs (9) →
integridade funcional (10). Não reaplicar as migrations 1–8 nem presumir que sua
presença no histórico comprove equivalência dos objetos instalados.

| Etapa | Pré-requisitos e efeito esperado |
| --- | --- |
| Antes da 9 | PostgreSQL 15+; schema `private`; cinco tabelas com RLS; view histórica com dono `bandup_public_reader`, opções exatas e ACLs esperadas; colunas URL/publicação, políticas e triggers sem drift; nomes novos livres. São esperados 10 triggers de usuário nas cinco tabelas se 1–8 estiverem intactas. |
| Migration 9 | Cria `private.is_safe_external_url_v1(text)`, `private.guard_external_link_url_v1()` e `social_links_zz_guard_external_url`; concede EXECUTE apenas ao novo validador para os quatro papéis previstos; substitui a definição da view mantendo identidade, colunas, dono e ACLs. Não reescreve registros. |
| Antes da 10 | PostgreSQL 15+, UTF-8, funções da 9, 17 contratos de colunas, exatamente 11 triggers de usuário com funções/tipos/estado esperados; executor com poderes efetivos de proprietário nas cinco tabelas, CREATE em `private` e TEMP no banco. |
| Migration 10 | Cria `private.guard_functional_integrity_v1()` e um trigger BEFORE INSERT OR UPDATE em cada uma das cinco tabelas. Total esperado após ambas: 16 triggers de usuário. Preserva view, constraints, RLS, funções anteriores, proprietários e ACLs existentes. |

As duas têm BEGIN/COMMIT próprios e lock timeout de cinco segundos. A 9 também
cria objetos temporários durante sua execução; isso não pertence ao diagnóstico.
Colisões ou discrepâncias, inclusive diferenças do deparser de políticas entre
versões, exigem revisão; não se remove um preflight para fazer a aplicação passar.

## Escopo seguro do SQL

O roteiro usa somente BEGIN READ ONLY, SET LOCAL de parâmetros de sessão,
SELECT/WITH e ROLLBACK. Não inclui DDL, DML, funções da aplicação, DO, SQL dinâmico,
fixtures, troca de papel, `set_config`, EXPLAIN ANALYZE ou leitura de `auth.users`.
Os verbos de privilégios presentes em literais são dados para funções de inspeção,
não comandos. O `search_path` fica limitado a `pg_catalog`; tabelas são qualificadas.

As saídas contêm metadados, OIDs, versões numéricas do histórico e contagens
agregadas. Não retornam registros, IDs de usuários/bandas, nomes de bandas,
e-mails, URLs, slugs, senhas ou tokens. Os nomes de objetos são metadados; mesmo
assim, mantenha o relatório em canal controlado, pois contagens e estrutura são
informações internas. Não enviar resultados automaticamente para outro serviço.

Na revisão foram removidos todos os `pg_get_*` de definição/expressão e também
`format_type`. Deparsers podem chamar funções de saída de tipos personalizados
ao representar constantes; calcular um hash depois não impediria esse efeito.
A fase 1 agora usa hashes de texto já armazenado e árvores internas do catálogo
(`adbin`, `polqual`, `ev_action`, `conbin`, `prosqlbody` etc.), sem deparse ou avaliação.
Lê tipos e funções de entrada/saída como OIDs, sem chamá-los. `prosrc`, argumentos
de trigger e defaults nunca são retornados em claro. Não são hashes de DDL completo:
metadados complementares precisam ser comparados, e diferenças de corpo/hash
não provam nem descartam equivalência semântica.

As chamadas diretas da fase 1 são funções internas qualificadas em `pg_catalog`:
inspeção de ACLs/membership/RLS, parâmetros de sessão, relógio, contagem, hashes e
serialização de tipos internos. `row_security_active` consulta a aplicabilidade
da RLS, não executa as expressões das políticas. A view de sistema `pg_roles`
projeta metadados do PostgreSQL; nenhuma função de aplicação, de saída de tipo
customizado, política de negócio ou view pública é avaliada por esta fase.
Isso pressupõe PostgreSQL 15+ com catálogos e implementações internas íntegros;
não é possível atestar remotamente essa premissa por inspeção de arquivos locais.

MD5 é referência de comparação, não proteção de segredos ou assinatura. OIDs e
árvores são próprios do cluster/versão; os novos fingerprints não são diretamente
comparáveis aos fingerprints anteriores de DDL deparseado. Não imprimir definições
desconhecidas para investigar diferenças. Dependências diretas não cobrem chamadas
transitivas, SQL dinâmico ou código de extensões. Este roteiro não é aprovação
automática nem substitui o preflight completo das migrations.

## Blocos e privilégios

| Bloco | Consulta | Acesso restrito e limites | Visibilidade ampliada necessária |
| --- | --- | --- | --- |
| A1–A2 | Versão/encoding, papel, presença, dono e cobertura RLS | CONNECT e acesso usual a catálogos permitem parte do inventário; erros/objetos invisíveis impedem conclusão | Identidade do projeto/host deve ser conferida fora do SQL antes da sessão; `current_database()` sozinho costuma ser insuficiente |
| A3–A5 | Schemas, ACLs efetivas/declaradas, colunas, view e defaults | Não consulta linhas nem a view; requer visibilidade dos catálogos e das rotinas internas de inspeção | Revisão de donos e privilégios de todos os objetos; ACL nula significa defaults, não ausência de acesso |
| A6–A10 | Funções, triggers, constraints, índices, RLS/políticas, dependências e papéis | Muitas consultas são possíveis sem superusuário; podem existir restrições específicas do provedor | Inspeção completa de memberships, funções e ACLs; não consultar `pg_authid`, configurações de conexão ou variáveis secretas |
| Fase 2 / B | Histórico de migrations, somente `version` e quantidade | Exige USAGE em `supabase_migrations` e SELECT na coluna/tabela correspondente | Papel administrativo existente pode ser necessário; ausência de histórico não significa banco vazio. A leitura foi adiada porque o ledger é tabela comum, não catálogo de sistema |
| Fase 2 / C | Dados legados e contagens das cinco tabelas | USAGE em `public` e SELECT nas colunas utilizadas | Para inventário integral, papel já autorizado com SELECT e visão de todas as linhas, por BYPASSRLS/superusuário ou propriedade efetiva sem FORCE RLS |

Não conceder privilégios ou alterar RLS para executar o diagnóstico. Se o papel
disponível tiver cobertura parcial, identificar os resultados como **parciais** e
interromper a decisão de produção. `executor_rls_active=true` em A2 impede tratar
as contagens como inventário integral, mesmo que retornem zero. Propriedade não
basta quando FORCE RLS está ativo; BYPASSRLS não concede SELECT por si só.
Não usar chave service_role como substituto de uma conexão SQL autorizada.
A fase 2 configura `SET LOCAL row_security = off`: isso **não desliga nem burla
RLS**, e não concede acesso; faz falhar a consulta se uma política tiver de filtrar
linhas para o executor. Não remover essa proteção para obter contagens parciais.

CREATE/TEMP/propriedade aparecem apenas como capacidades futuras inspecionadas;
não são necessárias para este roteiro. A aplicação futura da 9 requer também
poderes para criar funções/trigger, substituir a view de outro dono e administrar
as ACLs das funções novas. O papel administrativo de laboratório não comprova
que o executor disponível no Supabase tenha esses poderes.

## Duas fases com autorizações independentes, nunca nesta etapa

1. Obter autorização de leitura vinculada ao projeto/host e papel exatos, após
   revisar o arquivo e sua versão. Não há endpoint ou credencial no roteiro e
   nenhuma identificação de banco é inferida automaticamente.
2. Na primeira fase, autorizar somente o arquivo de metadados completo. Ele termina
   em ROLLBACK e não contém consultas B/C. Revisar os resultados fora da transação;
   não manter sessão aberta enquanto aguarda autorização humana.
3. Antes de B/C, confirmar estrutura/tipos esperados, coluna `version` do ledger,
   cobertura SELECT integral e segurança das definições/dependências existentes.
   Conferir relações físicas comuns, ausência de dados via view/FDW, tipos nativos
   exatos (incluindo ledger.version), collations, colunas geradas, métodos de acesso,
   operator classes e caminhos indiretos do planner/índices. Mesmo SELECT pode
   executar código personalizado. READ ONLY não impede efeitos externos.
   A fase 2 não tem pureza integral comprovada apenas por esta revisão local;
   dependências transitivas/dinâmicas desconhecidas ou drift bloqueiam autorização.
4. Somente com nova autorização para a fase 2, em nova sessão dedicada, usar o
   arquivo de dados separado, com parada no primeiro erro, sem reconexão ou retry.
   Não substituir referências ausentes nem omitir uma consulta que falhou para
   produzir um resultado verde. Em cliente psql, usar modo sem startup pessoal
   e parada por erro (`-X`, `ON_ERROR_STOP=1`); não gerar conexão nesta etapa.
   Em erro, encerrar com ROLLBACK se a sessão ainda estiver aberta. Cada passagem
   tem snapshot próprio; mudanças entre passagens precisam de nova comparação.
5. Limites: statement timeout 30s, lock timeout 2s, idle timeout 60s. Timeout ou
   desconexão invalida a passagem; não aumentar limites ou repetir sem revisão.
   O limite de statement é por instrução, não orçamento total da fase. É necessário
   definir uma duração total operacional antes de autorizar. Não usar execução
   que envolva os arquivos em escrita/DDL ou reconecte após timeout.

## Falhas, custo e exposição revisados

| Consultas | Falhas possíveis | Conduta |
| --- | --- | --- |
| Fase 1 / A1–A10 | Sem CONNECT/SELECT em catálogo ou EXECUTE em builtin; campos de catálogo incompatíveis com a versão; objeto concorrente removido; hashing indisponível | PostgreSQL 15+ é requisito; abortar no primeiro erro, sem conceder privilégios, fallback ou interpretar saída incompleta como aprovação |
| A2–A10 | Relação/papel/função esperados ausentes produzem ausência/NULL ou menos linhas; relação de tipo inesperado pode invalidar inspeção de ACL | Ausência não é sucesso nem prova de migration não aplicada; conferir inventário e tipos, não só ausência de erro |
| Fase 2 / B | Ledger/schema/coluna `version` ausente ou sem USAGE/SELECT; tipo inesperado; RLS aplicável | Consulta falha deliberadamente; não inferir histórico vazio nem construir ledger nesta etapa |
| Fase 2 / C | Tabelas/colunas ausentes, tipos divergentes, permissões insuficientes ou RLS aplicável | Parar; nenhum saneamento, cast corretivo ou expansão de privilégio autorizado |
| Ambas | `statement_timeout`, `lock_timeout`, idle timeout ou transação abortada após erro | ROLLBACK/encerramento; revisão antes de outra tentativa; não continuar consultas em conexão nova sem o preâmbulo |

Exemplos sensíveis à versão incluem `pg_proc.prosqlbody`/`prosupport`, campos de
`pg_attribute`, a sintaxe das funções internas de ACL e a estrutura do ledger.
O A1 informa a versão, mas não desvia automaticamente os comandos posteriores:
versão fora do requisito é condição para parar, não para adaptar SQL no destino.
Leituras de ACL podem falhar sobre um objeto de tipo inesperado, mesmo quando seu
nome existe. As árvores internas podem mudar entre versões sem mudança funcional.

A fase 1 lê catálogos e não toma locks explícitos de linha ou acessa linhas das
tabelas de negócio. Ainda pode disputar recursos/locks de catálogos e não congela
DDL concorrente. A fase 2 toma ACCESS SHARE nas relações consultadas até ROLLBACK:
normalmente permite DML, mas conflita com ACCESS EXCLUSIVE de DDL. Snapshots longos
retêm versões e podem prejudicar vacuum. Existem scans completos repetidos, joins,
regexes, agregações e análises por caractere. A expansão UTF-16 foi limitada a 2048
caracteres por slug; slugs maiores já ultrapassam o limite. Isso limita a expansão,
não o custo total de ler textos/tabelas grandes. Executar futuramente em janela
de baixa carga com orçamento aprovado; nenhuma medição de custo real foi feita.

Não há row locks, `LOCK TABLE`, EXPLAIN ANALYZE, consultas a `auth.users`, linhas da
view pública ou saídas individuais de negócio. Metadados podem conter nomes de
objetos escolhidos por administradores, inclusive nomes acidentalmente sensíveis;
contagens pequenas e fingerprints também são informação interna. Guardar a saída
com acesso controlado e revisar antes de compartilhar. Não imprimir erros com
valores da fase 2; registrar código de erro/bloco, sem detalhes ou parâmetros reais.

## Interpretação de dados legados

- URLs: o bloco C4 reproduz controles, esquema, autoridade, DNS ASCII, IPv4
  canônico, limite de 8192 bytes e portas da 9 sem instalar/chamar o validador.
  **IPv6 entre colchetes permanece `unresolved_ipv6`**; não é classificado como
  compatível, pois não fazemos cast `inet` que possa abortar a consulta sobre dados
  ruins. Até uma única ocorrência exige um complemento somente leitura revisado
  antes de concluir compatibilidade. Zero incompatíveis sem resolver essa categoria
  não aprova a migration. Não é feito DNS, HTTP ou teste de destino de redirecionamento.
- `selected_links` conta a flag do link; `publicly_visible_before_m9` exige também
  banda pública. Links publicados incompatíveis desaparecerão da view após a 9,
  sem exclusão dos registros. UPDATE que mantenha a flag pública valida a URL,
  mesmo se só editar metadados; ocultar URL legada inalterada segue permitido.
- A validação SQL é mais restritiva que o parser JavaScript. URLs Unicode/punycode,
  IPv4 abreviado e outros casos aceitos no frontend podem ser rejeitados pelo banco;
  nenhuma correção ou normalização de dados está incluída neste diagnóstico.
- A 10 preserva campos legados inalterados em UPDATE. Inserções e campos alterados
  precisam cumprir as regras. UPSERT valida o candidato INSERT primeiro. Formulários
  que normalizem texto ou datas podem tornar um valor efetivamente diferente.
- Eventos passados não são automaticamente inválidos: a regra de futuro se aplica
  a INSERT/mudança de início, comparada a `statement_timestamp()`. Instante igual
  com outro offset não é reagendamento. Campos opcionais nulos são permitidos;
  avaliar `null_values` conforme A5, não como falha universal.
- O roteiro não testa autenticação, gravações, triggers em execução, concorrência,
  cache ou HTTP/PostgREST. Não testa referências a usuários por consulta a
  `auth.users`; a integridade dessas FKs é inspecionada por metadados/constraints.

## Conferência das evidências locais

| Fonte local revisada | O que registra | O que não comprova |
| --- | --- | --- |
| `external_link_url_safety.md` | 86 casos SQL aprovados historicamente; falha de fixture antigo; suíte/gate revisados ainda marcados como não executados | Aprovação da revisão atual completa nem compatibilidade de produção |
| `functional_integrity.md` e `sql_test_execution.md` | Migration 10, fixture e gate revisado preparados; explicitamente não executados nesses relatos | Resultado SQL final da 10 e das suítes posteriores |
| `public_band_profiles.md` e `record_ownership_guards.md` | Ensaios mínimos históricos e avisos sobre revisão posterior não executada | Instalação do Supabase real, Auth/PostgREST ou revisão posterior aprovada |
| `docs/auditoria-final.md` | 197 testes JavaScript e build isolado aprovados na preparação anterior | Compilação/execução das migrations no PostgreSQL real |
| Informação posterior do usuário | Migrations 9/10 validadas em laboratórios PostgreSQL isolados | Evidência reproduzível anexada à versão dos arquivos e validação de produção |

Não foi localizado nesses relatórios um registro final que reconcilie a informação
posterior com os avisos de preparação. Eles foram preservados como históricos;
não transformamos resultados informados em testes executados nesta etapa.
Solicitar o relatório final já existente por canal autorizado: versão PostgreSQL,
SHA-256 dos SQL/fixtures/suítes, data, resultados/SQLSTATE/saída final, preservação
dos dados e catálogo antes/depois, papéis utilizados, falhas e limites conhecidos.
Não acessar o laboratório nem repetir testes para preencher essa lacuna.

A reconciliação detalhada, com hashes atuais das fontes e o resultado dos testes
offline desta revisão, está em [supabase-migration-evidence.md](supabase-migration-evidence.md).
Resultado offline não altera o status SQL dos relatórios históricos.

## Condições obrigatórias antes de autorizar aplicação

- [ ] Confirmar projeto/host, responsáveis, papel executor e que 9/10 ainda estão
  ausentes; reconciliar histórico 1–8 com objetos efetivos. Não reaplicar por ausência
  apenas no ledger nem presumir que estes SQL registrem o histórico automaticamente.
- [ ] Diagnóstico autorizado concluído, sem erros, cobertura parcial, drift,
  colisões ou contagens não resolvidas; definições compatíveis com as referências
  revisadas, incluindo privilégios padrão e capacidade do executor de migração.
- [ ] Relatórios finais dos laboratórios correspondem aos arquivos exatos atuais,
  com preservação de dados/catálogo e limites de Auth/HTTP/concorrência explicitados.
- [ ] Impacto dos legados aprovado, especialmente links publicados omitidos pela 9;
  nenhum saneamento automático ou alteração de política/parser incluído.
- [ ] Identificar SHA realmente em produção, clientes antigos e Preview; confirmar
  isolamento de ambiente e compatibilidade dos fluxos de escrita com ambos os guards.
- [ ] Backup/PITR, retenção, RPO/RTO e restauração ensaiada em destino separado;
  recuperação de schema/ACLs/dados e objetos de Storage confirmada, sem presumir
  que o backup do banco inclua os arquivos armazenados.
- [ ] Janela e controle de gravações autorizados; aplicar 9 uma vez, validar, depois
  10 uma vez e validar. Não combinar suas transações nem executar suítes/fixtures
  de laboratório em produção; testes de escrita reais precisam de escopo próprio.
- [ ] Baseline e critérios de parada definidos. Após COMMIT, rollback do frontend
  não desfaz banco: correção futura revisada ou restauração/PITR autorizada deve
  considerar escritas posteriores e não reabrir publicação insegura.
- [ ] Autorizações separadas para diagnóstico, backup, aplicação, validação com
  escrita e promoção do código. Preview Ready não autoriza nenhuma dessas ações.

**Estado após revisão:** a fase 1 está preparada para solicitar autorização
específica do projeto/host, papel, arquivo e janela; não foi autorizada nem
executada. Não lê o histórico de versões: apenas a estrutura/permissões do ledger.
A fase 2 permanece bloqueada até revisão dos resultados da fase 1 e autorização
posterior. Os relatórios finais de laboratório continuam pendentes de reconciliação
documental; essa lacuna bloqueia a aplicação, não a preparação da coleta estrutural.
