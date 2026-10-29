# Histórico real versus migrations locais — 2026-10-27

Atualização de 28/10: para a camada pública legada, o
[ramo de compatibilidade](publication-compatibility.md) e seu manifesto distinguem
as alternativas M7/M9 da sequência original descrita abaixo. M8 é pré-requisito do
bridge. Não aplicar a ordem histórica abaixo ao legado nem executar `db push`.
Reconciliação do artefato ausente e do ledger continua pendente; SQL não foi executado.

Análise exclusivamente local, baseada no histórico informado pelo usuário.
Nenhuma conexão, execução SQL, acesso a laboratório ou alteração de banco.

Versões informadas: 20261001000000, 20261002160000, 20261002170000,
20261002190800, 20261002200000, **20261004120000**.

## Bloqueio anterior à Migration 7

A sexta versão real NÃO corresponde à sexta migration local:
`20261017180000_record_ownership_guards.sql`. O relato em
`supabase/tests/record_ownership_guards.md`, seção Additional acceptance tests
before publication, menciona `20261004120000_public_read_layer` como proposta
histórica ausente do checkout. Isso não comprova o conteúdo aplicado no destino.
É necessário obter o artefato histórico já existente e compará-lo com o schema;
não consultar statements do ledger, reparar histórico ou reaplicar por suposição.

Ausência da view é compatível com a 7 não registrada, mas não exclui objetos
manuais/parciais. Não há base para afirmar que 1–6 locais estejam completas.

## Efeitos exatos de 7 e 8

- 7: `20261020000000_public_band_profiles.sql` adiciona a bands e social_links
  `is_public boolean NOT NULL DEFAULT false`; cria funções invoker
  `private.guard_band_publication()` e `private.guard_social_link_publication()`,
  triggers `bands_guard_publication` e `social_links_guard_publication`
  BEFORE INSERT OR UPDATE; revoga EXECUTE público/aplicação nessas funções.
  Só admin autenticado altera publicação; banda nova não pode nascer pública;
  links não podem mudar de banda. Cria papel bandup_public_reader NOLOGIN,
  NOINHERIT e sem poderes elevados/bypass, USAGE em public, SELECT restrito a
  colunas das duas fontes e políticas bands_select_for_profile_reader e
  social_links_select_for_profile_reader. Cria public_band_profiles com name,
  slug, description, logo_url e links JSONB, apenas bandas e links publicados.
  View pertence ao reader, security_barrier=true/security_invoker=false;
  SELECT para anon/authenticated, sem privilégios diretos novos nas fontes para
  visitantes. Remove CREATE temporário do reader e membership temporária do
  executor. Tudo em BEGIN/COMMIT, com preflight de colisões/pré-requisitos.
- 8: `20261023000000_tasks_ownership_immutable.sql` substitui somente
  `private.prevent_task_author_or_band_change()`, mantendo SECURITY DEFINER,
  search_path vazio e row_security=off. Passa a rejeitar qualquer mudança de
  tasks.band_id/created_by, inclusive por admin, com SQLSTATE 23514 e marcador
  tasks_ownership_immutable. Não cria trigger: depende do trigger histórico
  tasks_prevent_author_or_band_change. O arquivo não contém BEGIN/COMMIT próprio.
  Nome e presença da função não distinguem a definição inicial da revisão 8.

## Dependências

A 7 exige private.is_band_admin(uuid), events_guard_ownership e
band_members_guard_band_id habilitados, criados pela sexta migration LOCAL.
Também exige RLS e ausência de SELECT anônimo nas cinco tabelas (inclusive coluna),
e ausência de todos os objetos novos da 7.

A 9 exige os objetos da 7 e seus contratos exatos: view/dono/opções/definição/ACLs,
reader/memberships, colunas, políticas e trigger de publicação. View ausente aborta
o primeiro preflight antes do DDL. A 9 não verifica explicitamente o corpo da 8;
a sequência revisada exige a 8 para fechar a transferência de autoria/banda.

A 10 exige funções/trigger da 9, guards de publicação da 7, guards da sexta local,
trigger histórico das tarefas, 17 contratos de colunas, exatamente 11 triggers
antes da aplicação, ownership/privilégios e view no snapshot. Ela não compara
explicitamente o corpo da função da 8: presença do trigger não comprova a regra.
Após a 10: 16 triggers nas cinco tabelas. Metadados não substituem validar funções.

## Consultas preparadas, NÃO executadas

Triagem focada em catálogos: não executa funções da aplicação nem deparsers,
não lê dados de negócio ou conteúdo de migrations do ledger. Os corpos retornados
são definições de funções instaladas, para comparação local, não chamadas dessas
funções. SQL destinado à revisão manual; não é atestado de contrato integral.
Os nomes/OIDs permitem identificar ausências e desvios sem casts regclass falharem.
Nenhum objeto encontrado prova instalação por migration, e ausência no histórico
não prova ausência de DDL manual. Resultados devem permanecer internos.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL row_security = off;

-- Q1: fontes e todas as views públicas; detectar camada antiga e publicação parcial.
SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.reloptions,
       c.relrowsecurity, c.relforcerowsecurity,
       a.attname, a.atttypid, a.attnotnull, a.attgenerated, d.adbin::text
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
 AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public' AND
 (c.relname IN ('bands','band_members','tasks','events','social_links',
               'public_band_profiles') OR c.relkind IN ('v','m'))
ORDER BY c.relname, a.attnum;

-- Q2: reader e memberships diretas; OIDs não expõem identidades de usuários.
SELECT r.oid, r.rolname, r.rolcanlogin, r.rolinherit, r.rolsuper,
       r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
       m.roleid, m.member, m.admin_option
FROM pg_catalog.pg_roles r
LEFT JOIN pg_catalog.pg_auth_members m ON m.roleid = r.oid OR m.member = r.oid
WHERE r.rolname = 'bandup_public_reader';

-- Q3: todas as funções private, inclusive sobrecargas e funções históricas.
SELECT p.oid, p.proname, p.prokind, p.proargtypes, p.prorettype,
       p.proowner, p.prosecdef, p.proconfig, p.proacl, p.prosrc
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private'
ORDER BY p.proname, p.oid;

-- Q4: triggers efetivos nas cinco fontes, inclusive extras/desabilitados.
SELECT c.relname, t.tgname, t.tgenabled, t.tgtype, t.tgfoid,
       t.tgattr, t.tgargs, t.tgqual::text
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
 AND c.relname IN ('bands','band_members','tasks','events','social_links')
ORDER BY c.relname, t.tgname;

-- Q5: políticas, incluindo eventual camada pública histórica.
SELECT c.relname, p.polname, p.polcmd, p.polpermissive, p.polroles,
       p.polqual::text, p.polwithcheck::text
FROM pg_catalog.pg_policy p
JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
 AND c.relname IN ('bands','band_members','tasks','events','social_links')
ORDER BY c.relname, p.polname;

ROLLBACK;
```

Estas consultas não validam integralmente ACLs efetivas, privilégios por coluna,
membership transitiva, dependências/regras das views ou schema CREATE/USAGE.
Esses itens e as definições da camada histórica precisam de revisão específica
após a triagem, antes de aplicar qualquer migration. Parar em erro/timeout e
encerrar com ROLLBACK, sem retry, concessões ou execução das migrations como teste.

## Dados atuais e ordem futura

Não há resultado de compatibilidade dos dados: nenhuma linha foi consultada.
A 7 não publica registros automaticamente (default false), mas altera schema e
comportamento; adição de colunas exige locks e poderes de criação/transferência
de role, além de ownership. A 8 não corrige dados: restringe UPDATE, inclusive
por admin. Ambas podem quebrar clientes que movam registros entre bandas.
A 9 preserva linhas, rejeita URLs novas/alteradas incompatíveis e URLs públicas
inválidas em updates; pode omitir links públicos legados na view. Ocultar link
com URL legada inalterada continua permitido. A 10 preserva campos legados
inalterados, mas valida INSERT e campos alterados (textos não vazios, slug,
timestamps finitos e início de evento novo/reagendado não passado). UPSERT
valida o candidato INSERT. Há risco com normalizações feitas pelo cliente.

Não preparar consulta de dados contra is_public antes de confirmar sua existência.
Após revisão dos metadados, preparar coleta agregada específica para schema real:
URLs incompatíveis/IPv6 inconclusivo, publicação, textos em branco, slugs,
timestamps e comportamento dos clientes. Não executar o arquivo de fase 2 inteiro.

Ordem futura condicional, não autorização:
1. Confirmar alvo e obter/reconciliar artefato 20261004120000; comparar objetos
   com as seis primeiras migrations locais. Não alterar ledger ou remover objetos.
2. Se guards locais da 6 faltarem, preparar resolução revisada dessa lacuna;
   aplicar a 6 local somente se comprovadamente pendente e sem colisões.
3. Resolver divergências antes da 7; backup/restauração, janela, executor e
   compatibilidade de clientes/dados precisam estar aprovados.
4. Aplicar/validar 7, depois 8, depois 9, depois 10, cada etapa separadamente,
   somente após autorização futura. Se objetos já forem equivalentes, definir
   reconciliação revisada; não reaplicar por ausência no ledger.
5. Validar contratos e histórico a cada etapa. As fontes não inserem versões
   no ledger automaticamente; usar mecanismo de migrations revisado. Não combinar
   as transações existentes nem disparar db push sem revisar todas as pendências.

Estado: bloqueadas 7–10 até esclarecer a sexta versão divergente, objetos reais,
colisões, privilégios e riscos dos dados/clientes. View ausente não é motivo para
criar view isolada ou pular os preflights.
