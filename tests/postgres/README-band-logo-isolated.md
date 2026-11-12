# Validação da migration de fotos em PostgreSQL 17 puro

Executor manual: `band-logo-isolated.cjs`; dependências simuladas: `band-logo-isolated-bootstrap.sql`.
Não é descoberto pela suíte automática (`*.test.cjs`). Importar o executor não conecta.
Sem Docker, SDK Supabase, HTTP, leitura de .env ou conexão ao Demo.

## Isolamento

O executor usa exclusivamente os binários `C:/Program Files/PostgreSQL/17/bin`.
Cria diretório novo com mkdtemp no TEMP, inicializa um cluster novo e escolhe porta livre diferente de 5433.
Servidor ligado apenas a 127.0.0.1, sem socket Unix. Não conecta ao servidor existente da porta 5433.
Roles são globais ao cluster: por isso anon/authenticated/service_role e o papel de ACL são criados somente nessa instância privada.

Antes de enviar qualquer SQL de preparação/teste, cada conexão executa somente um SELECT e confere:
nome do banco, host, porta, PostgreSQL 17, diretório físico exato (resolvendo aliases Windows), session_user/current_user postgres.
Uma conexão administrativa ao postgres **do cluster novo** serve somente para CREATE DATABASE com nome novo e UUID.
Todo o schema/dado de teste é criado no banco `bandup_logo_test_<12 hex>` exclusivo dessa rodada.
PG* herdado é removido; não usa PGPASSWORD, PGPASSFILE ou serviços/configurações de conexão existentes.

A autenticação trust é exclusivamente deste servidor temporário em loopback, para fixtures sem senhas/tokens.
Não usar essa configuração em servidor compartilhado/produção. A instância é parada ao fim; os arquivos e o banco não são excluídos.
O runner inicia utilitários com windowsHide e escreve logs em arquivos, para não prender os handles do postmaster no Windows.
No sandbox do agente, pg_ctl pode exigir execução aprovada fora do sandbox por restrições de token do Windows.

## Execução controlada

```powershell
node --check tests/postgres/band-logo-isolated.cjs
$env:BANDUP_BAND_LOGO_LOCAL_TESTS = 'create-isolated-cluster'
node tests/postgres/band-logo-isolated.cjs --execute
```

Não há opção de apontar URL/host/banco existente. Cada execução cria novo cluster/banco, sem retomar ou limpar rodadas anteriores.
O diretório é impresso antes da inicialização. `result.json` contém destino, hashes, resultado por cenário e estado de parada.
`private-run.log` e `server.log` registram somente infraestrutura/SQL sintéticos, sem credenciais reais.
Guardar esses arquivos localmente, fora do Git. Não excluir banco/diretório sem autorização.
Para inspeção posterior, um operador poderá reiniciar somente o data_directory desse manifesto, mantendo a porta registrada; não confundir com o serviço 5433.

## O que é real e o que é simulado

**Real:** PostgreSQL 17, parser/compilação e execução SQL/PLpgSQL, roles, ACLs herdadas, RLS, policies permissivas/restritivas,
triggers, SECURITY DEFINER, transações/rollback e conflitos entre sessões.

**Simulado:** Auth consiste em auth.users(id), auth.uid()/auth.role() lendo GUCs de teste; não valida JWT nem sessão.
Storage consiste em buckets/objects com metadados JSONB; não existe arquivo binário ou servidor Storage.
O papel corrente é alterado com SET LOCAL ROLE em sessões administrativas guardadas. Isso reproduz checks do executor do PostgreSQL,
não autenticação de clientes/PostgREST. Proprietário das tabelas Storage é postgres nesta simulação.

Após o bootstrap são aplicados, sem editar fontes, o schema inicial local, a restrição de remoção, a RPC de saída e a migration de avatars.
Em seguida aplica-se integralmente `20261112100000_band_logos.sql`. Os hashes desta migration e de avatars são conferidos ao terminar.
O schema não é um clone do Demo e não contém dados importados dele.

## Cenários executados

- Preflight com grant herdado perigoso; postflight com EXECUTE herdado e SELECT herdado na tabela privada: instalação rejeitada e rollback completo.
- Criação normal dos objetos e verificações reais de ACL; policies avatars idênticas antes/depois.
- Criação de banda sem foto e trigger real que cria administrador.
- Associação de objeto válido da banda; retry; consumo/ausência de permissões privadas residuais.
- UPDATE/INSERT direto arbitrário/canônico, limpeza para NULL, GUC falsa, acesso à tabela privada/parser: rejeitados.
- Atualização de nome/descrição preservando foto: permitida. BEFORE trigger sintético que injeta URL: rejeitado pela guarda AFTER.
- Membro, externo, anon, objeto de outra banda, inexistente e caminho inválido: rejeitados.
- RPC rejeita metadados com MIME inválido, tamanho excessivo e tamanho malformado. **Não equivale a testar upload ou limite de bytes da API Storage.**
- Policy ALL concorrente, limitada aos buckets sintéticos band-logos/other-fixtures: não libera escrita cruzada, membro, anon, UPDATE, DELETE ou movimento para band-logos.
- SELECT anon sem erro de EXECUTE privado; outro bucket mantém acesso previsto. Avatar próprio funciona; avatar cruzado permanece negado.
- Remoção comum limpa assigned_to sem apagar tarefa; último administrador continua protegido.
- Duas sessões: lock de banda, ordem invertida com integrante, demissão concorrente, revogação após commit.
- RPC real de saída promove novo administrador; antigo perde associação e novo pode associar.

## Limites / próxima validação

Não foram testados signup, login, confirmação de e-mail, tokens, uploads de bytes, validação MIME/limites no serviço,
rotas list/info, sondagens em savepoints, gravações internas privilegiadas, versionamento, CDN, entrega pública ou CORS.
A URL fixa do Demo é somente texto retornado pela RPC; não é acessada.
Concorrência cobre os cenários SQL descritos, não todas as interações possíveis do Storage real.
Uma aprovação local não autoriza aplicar no Demo nem comprova prontidão de produção.
Manter os testes reais controlados do Supabase como pendência separada, com dados descartáveis e autorização.

## Registro da validação local

11/11/2026: PostgreSQL 17.11, **43/43 cenários aprovados**.
Banco retido: `bandup_logo_test_f50e833e142e`, porta temporária `58294`; instância parada ao final.
Manifesto e logs estão no diretório TEMP impresso pelo executor, terminado em `bandup-band-logos-LwDZBo`.
SHA-256 da migration original: `e82886f5f2ab636203519524b360692ba9d0d04d043e87eeda900ca631d53214`.
Hashes da migration e de avatars permaneceram iguais. Tentativas anteriores de infraestrutura/fixtures também foram preservadas, sem exclusão automática.
