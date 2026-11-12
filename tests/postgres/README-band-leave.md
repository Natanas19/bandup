# Testes locais da saída voluntária

Destino único: PostgreSQL **17**, `127.0.0.1:5433`, banco **bandup_leave_test**, usuário **postgres**.
Nenhum comando abaixo foi executado durante a preparação. Setup, testes reais e limpeza escrevem no banco e devem ser executados somente na etapa autorizada.

## Isolamento e dependências

- Node.js e `psql` 17 no PATH. No Windows, o executável pode estar em `C:\Program Files\PostgreSQL\17\bin`.
- O banco descartável já deve existir. O bootstrap não cria nem exclui bancos.
- A URL aceita é exatamente `postgresql://postgres@127.0.0.1:5433/bandup_leave_test`. Senhas, query strings, serviços, sockets, aliases, outras portas/hosts/bancos e valores implícitos são rejeitados.
- Remova configurações `PG*` herdadas da sessão antes de executar. Apenas `PGPASSFILE` é aceito para autenticação já configurada. Não coloque senhas na URL, no repositório ou nos logs. `psql -w` impede prompts e `-X` ignora scripts de inicialização.
- Cada subprocesso verifica banco, endereço/porta reais do servidor, usuário de sessão/efetivo e versão **antes de receber SQL de escrita**. Testes, sessões concorrentes e limpeza exigem também o marcador do bootstrap.
- A verificação vale para o servidor PostgreSQL diretamente acessado nesse endereço; não configure túneis ou proxies nessa porta.

## Bootstrap revisável

`band-leave-bootstrap.sql` cria somente schemas de suporte/Auth simulado, `auth.users(id)`, `auth.uid()`, `auth.role()`, três tabelas (`bands`, `band_members`, `tasks`) e os dois triggers necessários. Os corpos das funções dos triggers são copiados literalmente da migration inicial e comparados por teste estático. As funções de Auth leem claims SQL da sessão; não validam JWTs reais.

As roles `authenticated`, `anon`, `service_role` são **globais ao cluster PostgreSQL**. Roles ausentes são criadas como NOLOGIN e registradas no manifesto. Roles existentes são reutilizadas somente se não tiverem privilégios elevados nem associações herdadas; seus atributos não são alterados. Prefira um cluster dedicado a testes se houver outras aplicações usando essas roles.

O bootstrap recusa nomes de objetos existentes. Não substitui `auth`, `private`, tabelas ou funções preexistentes. As tabelas locais têm RLS habilitado e nenhum grant de acesso às roles da aplicação: a suíte exercita a RPC SECURITY DEFINER e o trigger, não as políticas RLS completas da aplicação. Não altera políticas do projeto.

O runner `band-leave-local.cjs setup` envia o bootstrap e depois o conteúdo da migration `20261111140000_bandup_leave_band.sql`, sem modificá-la e sem usar Supabase CLI. São duas transações: se a instalação da RPC falhar, a base pode ficar preparada; use a limpeza revisada antes de repetir. Nenhum dado, credencial, dump ou serviço do Demo é necessário.

## Execução futura, na raiz do repositório

Após revisar e autorizar a etapa de escrita, em uma sessão com autenticação local já configurada:

```powershell
$env:PATH = 'C:\Program Files\PostgreSQL\17\bin;' + $env:PATH
$env:BANDUP_LEAVE_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5433/bandup_leave_test'
node tests/postgres/band-leave-local.cjs setup
node --test tests/band-leave-postgres.test.cjs
```

Execute cada comando somente se o anterior terminar com código 0. O teste não faz setup automaticamente. Sem URL, a suíte real é ignorada. Não execute vários setups/testes/limpezas simultaneamente. Não adicione outros objetos aos namespaces reservados desse ambiente.

A suíte cobre autorização por claims/grants, ausência de associação, transferência por antiguidade/desempate, preservação das tarefas, rollback explícito e conflitos entre sessões. Não comprova autenticação HTTP real, políticas completas do Demo nem recuperação automática após duas saídas concorrentes. Os subprocessos têm limite de vida de 15 segundos; falhas são relatadas sem imprimir diagnósticos de conexão.

## Limpeza futura

```powershell
node tests/postgres/band-leave-local.cjs cleanup
Remove-Item Env:BANDUP_LEAVE_TEST_DATABASE_URL
```

O teste normalmente remove suas fixtures por UUID em `finally`. Interrupção abrupta pode deixar resíduos. A limpeza completa elimina também esses resíduos ao remover **somente** as tabelas, RPC, funções e schemas explicitamente criados pelo bootstrap, exigindo o marcador local. Remove apenas roles registradas como criadas nessa instalação; preserva roles preexistentes. Não remove banco, schema `public`, outros objetos ou dependências com `CASCADE`. Dependência inesperada causa falha e rollback da limpeza. Não substitua falhas por `DROP OWNED`, `DROP DATABASE` ou `CASCADE`.

## Verificações sem banco

```powershell
node --test tests/band-leave-preparation.test.cjs tests/band-leave.test.cjs
node --check tests/helpers/band-leave-postgres.cjs
node --check tests/postgres/band-leave-local.cjs
node --check tests/band-leave-postgres.test.cjs
git diff --check
```

Os testes de preparação usam processos simulados e leitura de arquivos. Não iniciam `psql` nem abrem conexões. A análise sintática/execução do SQL continua pendente até a etapa autorizada de banco real.
