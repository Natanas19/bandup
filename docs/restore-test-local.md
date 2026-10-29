# Ensaio local de restauração do BandUp

**Procedimento para revisão externa. Não executado. Não autoriza execução.**

Revisão estática desta versão: seis blocos PowerShell analisados pelo parser
local sem execução dos comandos de restauração/conexão, sem erros de sintaxe.
A seleção em memória conferiu 91 identidades obrigatórias contra apenas o TOC;
testes negativos rejeitaram a falta de auth.uid() e uma função private extra.
SQL revisado estaticamente, não compilado nem executado em PostgreSQL.
Revisão das definições essenciais concluída estaticamente, por extração
`--schema-only` em memória, sem conexão e sem registros. O limite externo de
10 minutos está definido na etapa 3. **Pronto para revisão final; não executado
nem aprovado em runtime.** Nenhum registro do backup foi lido.

Objetivo: restaurar seletivamente o estado do BandUp anterior às migrations
locais 6–10, sem reconstruir o banco pelas migrations e sem acessar produção.
Este ensaio é parcial: valida dados e estrutura essencial, não toda a plataforma.

## Ambiente e dependências

- Windows com servidor e clientes PostgreSQL 17.11 instalados.
- Executáveis em `C:\Program Files\PostgreSQL\17\bin`.
- Destino exclusivo: `127.0.0.1:5433`, banco vazio `bandup_restore_test`.
- Autenticação SCRAM; usar senha exclusivamente local nos prompts.
- Administrador do cluster local capaz de criar papéis e extensões.
- `pgcrypto` e `uuid-ossp` disponíveis, mas não instaladas no banco.
- `pg_stat_statements` disponível, mas desnecessária neste ensaio.
- `supabase_vault` indisponível e excluída.
- Backup original custom: `C:\Users\Usuário\BandUp-Backups\bandup-pre-migrations.dump`.
- Tamanho informado: 416818 bytes.
- SHA-256 informado: `0CE7F630719D36396CFA5336960A92699210C11B5C6F5D805C47BC24A0929E96`.
- Catálogo previamente lido com sucesso; não há buckets de Storage, conforme informado.

Antes de executar: conferir que o servidor escuta somente no loopback e que o
cluster é descartável. Loopback limita acesso de entrada, mas não bloqueia tráfego
de saída. Não iniciar aplicação, Auth, PostgREST ou tarefas agendadas neste destino.
Os checks de destino identificam endereço/porta/banco, não a identidade física
do cluster: o operador deve confirmar que é o cluster local descartável esperado.
O dump é uma fonte de SQL executável: a seleção de catálogo não substitui revisão
das definições necessárias se a origem ou dependências não forem confiáveis.

## Objetos selecionados

- Schemas `auth` e `private`; `public` já deve existir vazio.
- Tabelas `public.bands`, `public.band_members`, `public.events`, `public.tasks`,
  `public.social_links`, com dados, constraints, índices selecionados, triggers,
  políticas e habilitação de RLS.
- Todas as funções `private` presentes nesse backup. O catálogo revisado contém
  `add_band_creator_as_admin`, `is_band_admin`, `is_band_member`,
  `is_band_member_for_user`, `prevent_last_band_admin_removal`,
  `prevent_task_author_or_band_change` e `set_updated_at`.
- Views históricas `public.public_bands`, `public.public_events` e
  `public.public_social_links`. Não substituir pela view da migration 7.
- Funções reais do backup `auth.uid()`, `auth.role()` e `auth.jwt()`.
- Tabela real `auth.users`, seus dados, chave primária e habilitação de RLS.

A presença da camada pública histórica no catálogo é evidência de objetos do
backup, não prova de sua origem na versão desconhecida `20261004120000`.

### Dependências referenciais

- Membros/autores/atribuídos apontam para `auth.users`.
- Registros da banda apontam para `bands`.
- Atribuição de tarefa depende do vínculo composto de membro.
- Tarefa/evento depende do evento da mesma banda e sua chave candidata.
- Funções privadas e políticas usam funções `auth.*`.
- Defaults podem depender de funções UUID; o bootstrap fornece as extensões.

Não há Auth simulado neste procedimento: as funções e `auth.users` vêm do backup.
Isso não instala o serviço Auth nem valida login/JWT. Os papéis locais, por outro
lado, são substitutos limitados, conforme explicado abaixo.

## Exclusões e limites de fidelidade

- Sem event triggers, publicações, serviços e outros schemas internos.
- Sem `supabase_vault` ou `pg_stat_statements`.
- Sem ownership ou ACLs originais (`--no-owner --no-acl`).
- Sem default ACLs do projeto de origem.
- Sem índices secundários e demais componentes de Auth além da PK de `auth.users`.
- Sem histórico do ledger: este é um ensaio de objetos/dados, não de registro de versões.
- Sem aplicação de migrations 6–10 e sem execução das suítes/fixtures de laboratório.

Owners serão os do executor local. Isso afeta SECURITY DEFINER e contexto das
views; não avaliar isolamento da aplicação com esse arranjo. Políticas RLS são
restauradas, mas seus grants e papéis efetivos não são uma réplica de produção.
Não conectar o aplicativo ao banco de ensaio.

O backup e `auth.users` contêm dados sensíveis. O carregamento será direto pelo
pg_restore, sem SELECT de linhas nem exportação textual. Manter destino e logs
restritos. Erros de COPY podem incluir valores: não imprimir logs automaticamente.

## 1. Preparar variáveis e seleção pelo catálogo

Executar futuramente em PowerShell, na mesma sessão para todas as etapas.
Os blocos precisam ser executados na ordem, sem pular as paradas de revisão.
Cria arquivos somente em nova pasta privada de trabalho fora do projeto.
Não altera o backup original.

```powershell
$ErrorActionPreference = 'Stop'
# PowerShell 7: tratar o exit code explicitamente; Windows PowerShell 5.1 também
# pode gerar ErrorRecord no stderr nativo, capturado pelos try/catch abaixo.
$PSNativeCommandUseErrorActionPreference = $false

$bin = 'C:\Program Files\PostgreSQL\17\bin'
$backup = 'C:\Users\Usuário\BandUp-Backups\bandup-pre-migrations.dump'
$work = Join-Path $env:USERPROFILE (
    'BandUp-Backups\restore-review-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
)
$expectedHash = '0CE7F630719D36396CFA5336960A92699210C11B5C6F5D805C47BC24A0929E96'
$localConnection = "host=127.0.0.1 hostaddr=127.0.0.1 port=5433 dbname=bandup_restore_test user=postgres sslmode=disable connect_timeout=5 options='-c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=60000 -c transaction_timeout=600000'"
# Não mostrar valores. Evita serviço, opções ou senha de produção herdados.
if (@(Get-ChildItem Env: | Where-Object { $_.Name -like 'PG*' }).Count -ne 0) {
    throw 'Variáveis PG* presentes: revisar ambiente antes de continuar, sem expor valores.'
}

if ((Get-Item -LiteralPath $backup).Length -ne 416818) {
    throw 'Tamanho do backup divergente.'
}
if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'Hash do backup divergente.'
}

New-Item -ItemType Directory -Path $work | Out-Null

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $work /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Não foi possível restringir a pasta de trabalho.'
}

$toc = @(& "$bin\pg_restore.exe" --list $backup)
if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao listar o catálogo.'
}

# Manifesto fechado do catálogo previamente revisado. Não são padrões permissivos.
# Cada identidade abaixo deve existir EXATAMENTE uma vez no arquivo original.
$required = @('SCHEMA|-|auth', 'SCHEMA|-|private')
foreach ($name in @('uid()', 'role()', 'jwt()')) {
    $required += "FUNCTION|auth|$name"
}
foreach ($name in @(
    'add_band_creator_as_admin()', 'is_band_admin(uuid)',
    'is_band_member(uuid)', 'is_band_member_for_user(uuid,uuid)',
    'prevent_last_band_admin_removal()',
    'prevent_task_author_or_band_change()', 'set_updated_at()'
)) { $required += "FUNCTION|private|$name" }

$tables = @('bands','band_members','events','tasks','social_links')
foreach ($name in $tables) {
    foreach ($kind in @('TABLE','TABLE DATA','ROW SECURITY')) {
        $required += "$kind|public|$name"
    }
}
foreach ($kind in @('TABLE','TABLE DATA','ROW SECURITY')) {
    $required += "$kind|auth|users"
}
$required += 'CONSTRAINT|auth|users users_pkey'
foreach ($name in @('public_bands','public_events','public_social_links')) {
    $required += "VIEW|public|$name"
}

$constraints = @(
    'band_members band_members_band_id_user_id_key', 'band_members band_members_pkey',
    'bands bands_pkey', 'bands bands_slug_key',
    'events events_band_id_id_key', 'events events_pkey',
    'social_links social_links_pkey', 'tasks tasks_pkey'
)
$foreignKeys = @(
    'band_members band_members_band_id_fkey', 'band_members band_members_user_id_fkey',
    'events events_band_id_fkey', 'events events_created_by_fkey',
    'social_links social_links_band_id_fkey',
    'tasks tasks_assigned_to_band_member_fkey', 'tasks tasks_assigned_to_fkey',
    'tasks tasks_band_id_fkey', 'tasks tasks_created_by_fkey',
    'tasks tasks_event_same_band_fkey'
)
$indexes = @(
    'band_members_user_id_idx', 'events_band_id_start_at_idx', 'events_created_by_idx',
    'social_links_band_id_idx', 'tasks_assigned_to_idx',
    'tasks_band_id_assigned_to_idx', 'tasks_band_id_due_date_idx',
    'tasks_band_id_event_id_idx', 'tasks_band_id_status_idx', 'tasks_created_by_idx'
)
$triggers = @(
    'band_members band_members_prevent_last_admin_removal',
    'bands bands_add_creator_as_admin', 'bands bands_set_updated_at',
    'events events_set_updated_at',
    'tasks tasks_prevent_author_or_band_change', 'tasks tasks_set_updated_at'
)
$policies = @(
    'band_members band_members_delete_for_admins',
    'band_members band_members_insert_for_admins',
    'band_members band_members_select_for_band_members',
    'band_members band_members_update_for_admins',
    'bands bands_delete_for_admins', 'bands bands_insert_for_authenticated_users',
    'bands bands_select_for_members', 'bands bands_select_for_public_reader',
    'bands bands_update_for_admins',
    'events events_delete_for_admins', 'events events_insert_for_band_members',
    'events events_select_for_band_members', 'events events_select_for_public_reader',
    'events events_update_for_admins_or_creators',
    'social_links social_links_delete_for_admins',
    'social_links social_links_insert_for_admins',
    'social_links social_links_select_for_band_members',
    'social_links social_links_select_for_public_reader',
    'social_links social_links_update_for_admins',
    'tasks tasks_delete_for_admins', 'tasks tasks_insert_for_band_members',
    'tasks tasks_select_for_band_members', 'tasks tasks_update_for_admins_or_involved_members'
)
foreach ($name in $constraints) { $required += "CONSTRAINT|public|$name" }
foreach ($name in $foreignKeys) { $required += "FK CONSTRAINT|public|$name" }
foreach ($name in $indexes) { $required += "INDEX|public|$name" }
foreach ($name in $triggers) { $required += "TRIGGER|public|$name" }
foreach ($name in $policies) { $required += "POLICY|public|$name" }
if ($required.Count -ne 91 -or @($required | Select-Object -Unique).Count -ne 91) {
    throw 'Manifesto obrigatório inconsistente.'
}

$entries = @()
$selected = @()
$prefix = '^\d+;\s+\d+\s+\d+\s+'
$entryPattern = $prefix + '(?<kind>FK CONSTRAINT|TABLE DATA|ROW SECURITY|SCHEMA|FUNCTION|TABLE|VIEW|CONSTRAINT|INDEX|TRIGGER|POLICY) (?<schema>\S+) (?<identity>.*?) (?<owner>\S+)\s*$'
foreach ($line in $toc) {
    if ($line -match $entryPattern) {
        $kind = $Matches['kind']
        $schema = $Matches['schema']
        $objectIdentity = $Matches['identity']
        if ($kind -eq 'FUNCTION') {
            $objectIdentity = $objectIdentity -replace '\s+', ''
        }
        $key = "$kind|$schema|$objectIdentity"
        $entries += [pscustomobject]@{ Key = $key; Line = $line }
        if ($required -ccontains $key) { $selected += $line }
    }
}
foreach ($key in $required) {
    if (@($entries | Where-Object { $_.Key -ceq $key }).Count -ne 1) {
        throw "Objeto obrigatório ausente ou duplicado no catálogo: $key"
    }
}
if ($selected.Count -ne 91) { throw 'Seleção divergente do manifesto.' }

# Qualquer entrada extra em public/private exige revisão, incluindo DEFAULT,
# SEQUENCE, tipos, regras e novos índices. ACL/DEFAULT ACL/COMMENT são exclusões
# deliberadas; não fornecem objetos essenciais para esta restauração parcial.
foreach ($line in $toc) {
    if ($line -match ($prefix + '.+? (public|private) ') -and
        $line -notmatch ($prefix + '(ACL|DEFAULT ACL|COMMENT) ') -and
        $line -notmatch ($prefix + 'SCHEMA ') -and
        $selected -cnotcontains $line) {
        throw 'Objeto extra em public/private: revisar catálogo antes de continuar.'
    }
}

$listFile = Join-Path $work 'bandup-essential.list'
[IO.File]::WriteAllLines(
    $listFile,
    [string[]]$selected,
    [Text.UTF8Encoding]::new($false)
)

# Exibe somente metadados selecionados, nunca registros das tabelas.
$selected

# Arquivo UTF-8 + PGCLIENTENCODING evitam a conversão de pipes para ANSI/ASCII
# do Windows PowerShell. Não abre conexão até que a função seja chamada.
function Invoke-LocalSql {
    param([string]$Label, [string]$Sql)
    if ($localConnection -notlike 'host=127.0.0.1 hostaddr=127.0.0.1 port=5433 dbname=bandup_restore_test user=postgres *') {
        throw 'Conexão local alterada.'
    }
    $sqlPath = Join-Path $work ($Label + '.sql')
    $outPath = Join-Path $work ($Label + '-private.out')
    $errPath = Join-Path $work ($Label + '-private.err')
    [IO.File]::WriteAllText($sqlPath, $Sql, [Text.UTF8Encoding]::new($false))
    $oldEncoding = $env:PGCLIENTENCODING
    try {
        $env:PGCLIENTENCODING = 'UTF8'
        & "$bin\psql.exe" -X -W -q -A -t `
            --dbname=$localConnection --set=ON_ERROR_STOP=1 --file=$sqlPath `
            1> $outPath 2> $errPath
        $sqlExit = $LASTEXITCODE
    } catch {
        throw 'Falha no cliente SQL local; revisar somente os logs privados.'
    } finally {
        $env:PGCLIENTENCODING = $oldEncoding
    }
    if ($sqlExit -ne 0) { throw 'SQL local falhou; interromper o procedimento.' }
    return $outPath
}
```

**Seleção obrigatória:** são 91 entradas, incluindo seis TABLE DATA. A comparação
é por identidade, não apenas quantidade. A ausência de uma entrada ou presença de
objetos extras no escopo causa parada. Não adaptar o manifesto para esconder erro.

### 1A. Revisão obrigatória das dependências, antes de conectar ao destino

O TOC não descreve colunas, defaults, corpos, expressões de índices/políticas,
dependências dinâmicas ou roles citados dentro de SQL. Portanto, o manifesto
sozinho NÃO demonstra completude. O bloco abaixo prepara somente DDL em arquivo
privado, sem TABLE DATA e sem imprimir definições no terminal. NÃO o execute com
`psql`: ele é apenas material de revisão.

```powershell
$schemaReview = Join-Path $work 'selected-schema-review-private.sql'
$schemaError = Join-Path $work 'schema-extraction-errors-private.log'
try {
    & "$bin\pg_restore.exe" --schema-only --use-list=$listFile `
        --no-owner --no-acl --file=$schemaReview $backup 2> $schemaError
    $schemaExit = $LASTEXITCODE
} catch { throw 'Falha na extração de metadados; revisar log privado.' }
if ($schemaExit -ne 0) { throw 'Extração de metadados incompleta.' }

# Manter false até revisão explícita de TODOS os itens abaixo.
$dependenciesApproved = $false
```

Revisar localmente o DDL sem copiá-lo para relatórios públicos: defaults e funções
podem conter constantes sensíveis. Registrar, fora do projeto, o resultado:

- **Roles:** todos os roles das políticas devem ser apenas PUBLIC (pseudo-role),
  postgres e os quatro substitutos locais. Verificar também nomes hardcoded,
  `SET ROLE`, ownership e testes de papel dentro dos corpos. Outros roles bloqueiam.
- **Funções:** revisar as dez assinaturas selecionadas, os corpos e referências
  transitivas/dinâmicas, linguagens, configurações e tipos de retorno/argumentos.
  Referências a Vault, rede, serviços, foreign tables, cron ou schemas excluídos
  bloqueiam. Não executar funções para descobrir dependências.
- **Views:** revisar as três definições, colunas, funções, security options e
  dependências entre views/fontes. Contexto de owner original não é reproduzido.
- **Defaults, CHECKs, generated columns e índices:** confirmar tipos, collations,
  métodos/operator classes e funções disponíveis no PostgreSQL 17 ou nas duas
  extensões escolhidas. Conferir que não precisam de sequences/defaults separados
  ou extensões excluídas. Não confiar só nos nomes dos índices.
- **FKs:** confirmar dez FKs públicas, as nove constraints p/u selecionadas e que
  `auth.users.id` basta como destino externo. Todas as demais dependências da
  definição real de auth.users precisam existir; não supor isso pela migration local.
- **RLS:** conferir os roles/expressões das 23 políticas e as seis habilitações de
  RLS; checar FORCE RLS, regras e triggers adicionais no DDL/catálogo. Revisar
  especialmente as três políticas da camada pública histórica desconhecida.
- **Auth:** tabela e funções reais, sem API Auth. Exclusão dos índices secundários
  de auth.users é deliberada e só aceitável se nenhuma dependência selecionada
  exigir esses índices/constraints. Não substituí-los silenciosamente por stubs.
- **Extensões:** pgcrypto/uuid-ossp locais devem fornecer as referências reais no
  schema esperado. pg_stat_statements e supabase_vault continuam excluídas somente
  se não houver dependência selecionada delas. Verificar encoding/collation relevantes.

### Resultado da revisão estática das definições

Para o backup identificado pelo SHA-256 deste documento, as definições foram
extraídas somente com `--schema-only --no-owner --no-acl`, em memória; não foram
lidos COPY/INSERT de dados. Foram revisadas 83 seções de definições essenciais
(as outras oito entradas do manifesto são os dois schemas e seis TABLE DATA).
Não foi gerado nem executado script de restauração durante essa revisão.

| Grupo | Dependências encontradas e conclusão |
| --- | --- |
| Dez funções | Sete private em SQL/plpgsql e três auth SQL STABLE. Referências a tabelas public e funções selecionadas; auth.* lê configurações de claims por funções nativas. Nenhum EXECUTE dinâmico nos corpos, biblioteca externa ou referência a Vault/rede/cron identificada. Funções auth reais não têm o mesmo search_path explícito das funções private: preservar a definição, sem simular autenticação nem executá-las no ensaio. |
| Seis tabelas | Tipos nativos PostgreSQL; defaults gen_random_uuid(), now(), constantes e NULL. gen_random_uuid existe no pg_catalog do PostgreSQL 17. auth.users tem generated column baseada em LEAST e CHECK nativo; nenhuma dependência de enums/types dos demais objetos auth. |
| FKs/constraints | Dez FKs públicas apontam somente para as tabelas selecionadas. As chaves de auth.users.id, band_members(band_id,user_id) e events(band_id,id) estão selecionadas. Nenhuma FK selecionada depende de índice/constraint Auth secundário excluído. CHECKs inline usam operadores/funções nativos, não novas entradas do TOC. |
| Dez índices independentes | Btree sobre colunas, sem predicados WHERE ou COLLATE explícito; nenhuma operator class de extensão identificada. Índices de PK/UNIQUE são criados pelas nove constraints selecionadas. A collation efetiva do destino ainda é uma característica de runtime; não declarar equivalência entre Windows e a origem. |
| Três views históricas | Usam bands/events/social_links, EXISTS e now(); todas com security_barrier=true/security_invoker=false. Sem dependência de outra view ou schema interno excluído. Seus owners locais diferentes tornam o ensaio inadequado para provar segurança de leitura pública. |
| 23 políticas | Roles explícitos apenas authenticated e bandup_public_reader. Expressões usam tabelas selecionadas, auth.uid() e helpers private selecionados; nenhum papel adicional identificado. Seis habilitações RLS selecionadas; sem FORCE RLS identificado no DDL essencial. |
| Seis triggers | Invocam helpers private selecionados. Não há trigger essencial apontando a extensão/schema excluído. Os dados são carregados antes de sua criação; não são testes de comportamento desses handlers. |
| Extensões/roles | pgcrypto/uuid-ossp permanecem disponíveis no bootstrap, mas não foi identificada dependência essencial delas além de funções nativas também disponíveis no 17. Nenhuma referência essencial a supabase_vault/pg_stat_statements. Owners e ACLs de origem são deliberadamente omitidos; não são pré-requisitos implícitos nem prova de grants recuperados. |

Não foi identificado bloqueio estático de dependências para a restauração
**parcial** proposta. Essa conclusão é específica do hash e não elimina falhas
de runtime ou validação das linhas pelas constraints. A identidade de roles e
owners originais, funções Auth reais e a limitação da camada pública estão
explicitadas, sem substituição silenciosa.

Após revisão final do operador, registrar a aceitação das exclusões e definir
`$dependenciesApproved = $true` na sessão futura. Manter o valor inicial false
como proteção contra execução sem revisão. Qualquer alteração do hash ou seleção
invalida a conclusão e exige nova revisão; não ampliar a seleção automaticamente.

## 2. Confirmar destino vazio e preparar dependências locais

O bootstrap não é uma migration do BandUp. Requer administrador do cluster local.
Os papéis criados são substitutos NOLOGIN/NOBYPASSRLS, sem privilégios elevados;
não reproduzem integralmente os papéis gerenciados de produção.

Papéis são globais ao cluster. Se os nomes já existirem, o procedimento para,
sem modificá-los nem reutilizá-los silenciosamente. Se o bootstrap funcionar e
outra etapa falhar, não executá-lo novamente sem revisar o estado remanescente.

```powershell
if (-not $dependenciesApproved) { throw 'Dependências ainda não aprovadas.' }
$bootstrap = @'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog;

DO $check$
BEGIN
  IF current_database() <> 'bandup_restore_test'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR inet_server_port() <> 5433 THEN
    RAISE EXCEPTION 'Destino local inesperado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace
    WHERE nspname IN ('auth', 'private', 'extensions')
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_event_trigger
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'Destino não está vazio ou possui event triggers';
  END IF;
END;
$check$;

DO $roles$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'bandup_public_reader'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name
    ) THEN
      RAISE EXCEPTION 'Papel já existente: revisar antes de prosseguir';
    END IF;

    EXECUTE pg_catalog.format(
      'CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      role_name
    );
  END LOOP;
END;
$roles$;

CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;

COMMIT;
'@

$null = Invoke-LocalSql -Label 'bootstrap' -Sql $bootstrap
```

## 3. Restaurar a seleção, sem migrations novas

```powershell
if (-not $dependenciesApproved) { throw 'Dependências ainda não aprovadas.' }
if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'Backup alterado.'
}
if (@(Compare-Object -ReferenceObject $selected -DifferenceObject @(
    [IO.File]::ReadAllLines($listFile)
) -CaseSensitive).Count -ne 0) { throw 'Seleção alterada.' }
if ($localConnection -notlike 'host=127.0.0.1 hostaddr=127.0.0.1 port=5433 dbname=bandup_restore_test user=postgres *') {
    throw 'Conexão local alterada.'
}
$errorLog = Join-Path $work 'restore-errors-private.log'

# O filho usa senha LOCAL transitória no próprio ambiente, nunca nos argumentos,
# no ambiente persistente da sessão, no documento ou em arquivos de senha.
# A conta administradora do Windows pode inspecionar memória de processos;
# não usar senha de produção nem compartilhar a sessão de execução.
$localPassword = Read-Host 'Senha do postgres LOCAL (127.0.0.1:5433)' -AsSecureString
$psi = [Diagnostics.ProcessStartInfo]::new()
$psi.FileName = Join-Path $bin 'pg_restore.exe'
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.Arguments = ('--no-password --dbname="{0}" --use-list="{1}" --no-owner --no-acl --exit-on-error --single-transaction "{2}"' -f $localConnection, $listFile, $backup)
$psi.EnvironmentVariables['PGCLIENTENCODING'] = 'UTF8'
$restoreProcess = [Diagnostics.Process]::new()
$restoreProcess.StartInfo = $psi
$stdoutFile = $null
$stderrFile = $null
$passwordPointer = [IntPtr]::Zero
$restoreExit = $null
$timedOut = $false
try {
    $stdoutFile = [IO.File]::Create((Join-Path $work 'restore-private.out'))
    $stderrFile = [IO.File]::Create($errorLog)
    try {
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($localPassword)
        $psi.EnvironmentVariables['PGPASSWORD'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        if (-not $restoreProcess.Start()) { throw 'Processo não iniciado.' }
    } finally {
        $psi.EnvironmentVariables.Remove('PGPASSWORD')
        if ($passwordPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        }
        $localPassword.Dispose()
    }
    # Streams binários assíncronos: não bloquear por buffers cheios e não exibir
    # mensagens COPY que possam conter dados pessoais.
    $stdoutTask = $restoreProcess.StandardOutput.BaseStream.CopyToAsync($stdoutFile)
    $stderrTask = $restoreProcess.StandardError.BaseStream.CopyToAsync($stderrFile)
    if (-not $restoreProcess.WaitForExit(600000)) {
        $timedOut = $true
        $restoreProcess.Kill()
        if (-not $restoreProcess.WaitForExit(30000)) {
            throw 'Cliente não encerrou: intervenção local necessária.'
        }
    }
    $restoreExit = $restoreProcess.ExitCode
    $logTasks = [Threading.Tasks.Task[]]@($stdoutTask, $stderrTask)
    if (-not [Threading.Tasks.Task]::WaitAll($logTasks, 30000)) {
        throw 'Logs não encerraram no prazo; resultado inconclusivo.'
    }
} catch {
    try {
        if (-not $restoreProcess.HasExited) {
            $restoreProcess.Kill()
            $null = $restoreProcess.WaitForExit(30000)
        }
    } catch { }
    throw 'Erro no processo local; parar e revisar estado/logs privados, sem retry.'
} finally {
    if ($null -ne $stdoutFile) { $stdoutFile.Dispose() }
    if ($null -ne $stderrFile) { $stderrFile.Dispose() }
    $restoreProcess.Dispose()
}
if ($timedOut) {
    throw 'Limite de 10 minutos excedido. Estado inconclusivo: verificar transação local antes de qualquer ação.'
}
if ($restoreExit -ne 0) {
    throw 'Restauração falhou. Parar; não imprimir o log nem repetir automaticamente.'
}
```

Não usar `--clean`, `--create`, `--disable-triggers` ou
`session_replication_role=replica`. A ordem normal carrega dados antes dos
triggers/FKs de pós-dados. A criação das FKs valida as referências restauradas.

O bootstrap é transação separada e permanece se a restauração falhar. A
restauração usa transação única com parada em erros. Não continuar sobre destino
de estado desconhecido. Não há limpeza automática neste procedimento.

### Limite operacional e interrupção

O limite externo é **10 minutos por tentativa**, sem paralelismo e com transação
única. Para um arquivo de aproximadamente 407 KiB em disco local é uma margem
conservadora, não estimativa de duração: tamanho comprimido não determina custo
de expansão/índices. Ao atingir o prazo, o controlador encerra somente o processo
filho iniciado por ele, aguarda até 30s pelo encerramento e até 30s pelos logs.
Não enumera nem encerra outros processos PostgreSQL. Um erro também interrompe
o procedimento; não há retry, DROP ou reinicialização automática.

O DDL extraído contém SET statement_timeout/lock_timeout/
idle_in_transaction_session_timeout/transaction_timeout = 0. Por isso, os limites
iniciais da conexão NÃO bastam; o watchdog externo não depende desses SETs e não
altera o dump.

Encerrar o cliente fecha a conexão e a transação não confirmada deve ser revertida
pelo servidor ao detectar a desconexão. **Não é garantia de rollback instantâneo:**
o backend pode demorar a perceber e COMMIT pode ter terminado antes da interrupção.
Timeout/queda perto do COMMIT deixa resultado inconclusivo, mesmo com logs incompletos.
Antes de qualquer nova tentativa, conferir manualmente somente no destino fixo
se o backend terminou e qual inventário permaneceu. Não executar validação enquanto
a restauração puder estar ativa; não declarar falha atômica só pelo exit code.
O bootstrap anterior permanece em qualquer caso. Qualquer limpeza/recriação é
uma ação separada, com alvo confirmado e nova revisão; não está automatizada.

## 4. Validação agregada e de metadados

Não mostra linhas individuais de usuários ou das tabelas de negócio. Contagens
também são informação interna. A ausência dos guards posteriores é verificada
para evitar testar acidentalmente um estado já migrado.

```powershell
$validation = @'
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

DO $check$
BEGIN
  IF current_database() <> 'bandup_restore_test'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR inet_server_port() <> 5433 THEN
    RAISE EXCEPTION 'Destino inesperado';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('bands','band_members','events','tasks','social_links')
      AND c.relkind = 'r' AND c.relrowsecurity
  ) <> 5 THEN
    RAISE EXCEPTION 'Tabelas ou RLS divergentes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('bands','band_members','events','tasks','social_links')
      AND k.contype IN ('f','c') AND NOT k.convalidated
  ) THEN
    RAISE EXCEPTION 'Constraint não validada: revisar origem e restauração';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN (
        'guard_event_ownership','guard_band_member_band',
        'guard_band_publication','guard_social_link_publication',
        'is_safe_external_url_v1','guard_external_link_url_v1',
        'guard_functional_integrity_v1'
      )
  ) THEN
    RAISE EXCEPTION 'Estado posterior ao baseline esperado';
  END IF;
END;
$check$;

SELECT 'bands' AS relation_name, count(*) AS rows FROM public.bands
UNION ALL SELECT 'band_members', count(*) FROM public.band_members
UNION ALL SELECT 'events', count(*) FROM public.events
UNION ALL SELECT 'tasks', count(*) FROM public.tasks
UNION ALL SELECT 'social_links', count(*) FROM public.social_links;

SELECT c.relname, t.tgname, t.tgenabled, t.tgtype
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

SELECT c.relname, p.polname, p.polcmd
FROM pg_catalog.pg_policy p
JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, p.polname;

ROLLBACK;
'@

$validationOutput = Invoke-LocalSql -Label 'validation' -Sql $validation
# Apenas contagens/metadados; manter a saída privada para comparação com baseline.
```

### 4A. Comparar automaticamente o inventário restaurado com o TOC selecionado

Não basta conferir que há cinco tabelas ou seis triggers. O bloco abaixo compara
identidades exatas de schemas, tabelas, funções/assinaturas, views, constraints,
índices independentes, triggers, políticas e habilitações RLS, detectando faltas
e extras nos schemas selecionados. Índices que sustentam constraints p/u são
contados pela própria constraint, não como entradas INDEX independentes.
TABLE DATA não é objeto de catálogo: sua recuperação depende do exit code da
restauração e da comparação de dados agregados/baseline, não deste inventário.

```powershell
$inventorySql = @'
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
DO $target$
BEGIN
  IF current_database() <> 'bandup_restore_test'
     OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
     OR inet_server_port() <> 5433 THEN
    RAISE EXCEPTION 'Destino inesperado';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger) THEN
    RAISE EXCEPTION 'Event trigger inesperado no destino';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon','authenticated','service_role','bandup_public_reader')
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
        AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
        AND NOT rolinherit) <> 4 THEN
    RAISE EXCEPTION 'Roles locais divergentes';
  END IF;
END;
$target$;
WITH scoped_relations AS (
  SELECT c.*, n.nspname
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public','private','auth')
), objects(key) AS (
  SELECT 'SCHEMA|-|' || nspname
  FROM pg_catalog.pg_namespace WHERE nspname IN ('auth','private')
  UNION ALL
  SELECT 'TABLE|' || nspname || '|' || relname
  FROM scoped_relations WHERE relkind IN ('r','p')
  UNION ALL
  SELECT 'VIEW|' || nspname || '|' || relname
  FROM scoped_relations WHERE relkind = 'v'
  UNION ALL
  SELECT 'ROW SECURITY|' || nspname || '|' || relname
  FROM scoped_relations WHERE relrowsecurity
  UNION ALL
  SELECT 'FUNCTION|' || n.nspname || '|' || p.proname || '(' ||
         pg_catalog.replace(pg_catalog.oidvectortypes(p.proargtypes), ' ', '') || ')'
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','private','auth') AND p.prokind = 'f'
  UNION ALL
  SELECT 'UNEXPECTED ROUTINE|' || n.nspname || '|' || p.proname
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','private','auth') AND p.prokind <> 'f'
  UNION ALL
  SELECT CASE WHEN k.contype = 'f' THEN 'FK CONSTRAINT|' ELSE 'CONSTRAINT|' END ||
         c.nspname || '|' || c.relname || ' ' || k.conname
  FROM pg_catalog.pg_constraint k
  JOIN scoped_relations c ON c.oid = k.conrelid
  WHERE k.contype IN ('p','u','x','f')
  UNION ALL
  SELECT 'INDEX|' || c.nspname || '|' || c.relname
  FROM scoped_relations c
  WHERE c.relkind IN ('i','I') AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint k
    WHERE k.conindid = c.oid AND k.contype IN ('p','u','x')
  )
  UNION ALL
  SELECT 'TRIGGER|' || c.nspname || '|' || c.relname || ' ' || t.tgname
  FROM pg_catalog.pg_trigger t
  JOIN scoped_relations c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'POLICY|' || c.nspname || '|' || c.relname || ' ' || p.polname
  FROM pg_catalog.pg_policy p
  JOIN scoped_relations c ON c.oid = p.polrelid
  UNION ALL
  SELECT 'UNEXPECTED RELATION|' || nspname || '|' || relname
  FROM scoped_relations WHERE relkind NOT IN ('r','p','v','i','I','t')
)
SELECT COALESCE(pg_catalog.json_agg(key ORDER BY key), '[]'::json) FROM objects;
ROLLBACK;
'@

$inventoryOutput = Invoke-LocalSql -Label 'inventory' -Sql $inventorySql
$actual = @((Get-Content -LiteralPath $inventoryOutput -Raw) | ConvertFrom-Json)
$expectedObjects = @($required | Where-Object { $_ -notlike 'TABLE DATA|*' })
if (@($actual | Select-Object -Unique).Count -ne $actual.Count) {
    throw 'Inventário restaurado com identidades duplicadas.'
}
$differences = @(Compare-Object -ReferenceObject $expectedObjects `
    -DifferenceObject $actual -CaseSensitive)
if ($differences.Count -ne 0) {
    # Apenas nomes de objetos, nunca registros de usuários.
    $differences | Format-Table -AutoSize
    throw 'Inventário restaurado diverge do catálogo selecionado.'
}
Write-Output 'Inventário de objetos selecionados corresponde ao catálogo.'
```

### 4B. Conferência de atributos que o TOC não descreve

Mesmo 4A aprovado não comprova equivalência de definições. Em sessão manual
posterior no MESMO destino, comparar com o DDL privado revisado em 1A:

- Colunas/tipos/nullability, defaults, generated columns e CHECKs, inclusive
  `is_public` e constraints da camada histórica; nunca reconstruir pela migration local.
- Destinos, colunas, ações ON DELETE/UPDATE e validação de todas as FKs.
- Índices de constraints e independentes: unicidade, colunas, expressões,
  predicados, operator classes, `indisvalid` e `indisready`.
- Triggers: funções vinculadas/assinaturas, flags, eventos, granularidade,
  condições e argumentos. Esperados: bands_add_creator_as_admin=5;
  bands_set_updated_at=19; events_set_updated_at=19;
  tasks_set_updated_at=19; tasks_prevent_author_or_band_change=19;
  band_members_prevent_last_admin_removal=27; todos habilitados em origin.
- Funções: linguagem, corpo/fingerprint com mesma representação, retorno,
  SECURITY DEFINER, configurações e dependências; views: definições e opções.
- Políticas: comando, permissividade, roles e expressões; flags RLS/FORCE RLS.
- Defaults de privilégios locais não devem conceder acesso inesperado a objetos;
  ACLs de origem foram omitidas e não podem ser declaradas restauradas.

Essa etapa requer um baseline extraído das definições de 1A, não hashes de arquivos
inteiros ou OIDs do cluster original. Se não houver comparação desses atributos,
classificar o resultado somente como **inventário e carga parcial aprovados**,
sem afirmar recuperação estrutural integral. Não usar SELECT de linhas individuais
para isso. Nenhuma consulta adicional é executada por este documento sozinho.

## Critérios de sucesso e revisão final

- Hash/tamanho correspondem ao original informado; original permanece intacto.
- Destino confirmado em loopback/porta/banco corretos e sem aplicação conectada.
- Seleção revisada inclui todos os objetos essenciais e suas dependências.
- Restauração retorna zero, sem erros ignorados.
- Cinco tabelas com RLS, seis triggers históricos e políticas correspondentes
  ao catálogo selecionado; conferir também as três views e funções selecionadas.
- FKs/constraints restauradas e válidas, índices presentes.
- Contagens comparadas com baseline do instante do backup, se disponível.
- Nenhuma migration nova aplicada, nenhum objeto novo preparado pelas migrations 6–10.
- Exclusões/adaptações registradas, sem declarar equivalência de segurança.

A validação automática compara cada identidade de objeto selecionado e detecta
extras no escopo. Corpos/expressões/atributos e resultados funcionais precisam da
conferência 4B; a lista do catálogo não os contém. Não declarar sucesso integral
apenas pelo exit code ou pelo inventário.

Sem baseline independente, é possível demonstrar que a seleção foi restaurada e
aceita pelas constraints, mas não comparar quantitativamente com produção naquele
instante. O catálogo legível sozinho não prova integridade de todos os blocos de dados.

## Fora do alcance

- Fidelidade de owners, grants, default privileges, memberships e contexto das views.
- Login real, validação de JWT, Auth completo, APIs e recarga de cache PostgREST.
- Event triggers de produção, extensões específicas, Vault e suas chaves externas.
- Storage: sem buckets conforme informado; não se presume que dump de banco
  inclua arquivos de Storage em outros cenários.
- Recuperação integral do projeto Supabase e validação das migrations seguintes.

Não remover papéis, banco ou diretórios automaticamente ao terminar. Qualquer
limpeza futura deve ter alvo confirmado e considerar os papéis globais e dados
sensíveis. Este documento não executa nem autoriza essa limpeza.
