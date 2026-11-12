# Fotos dos solicitantes: candidata local

Status: preparada para revisão; **não aplicada ao Demo**. Sem integração frontend.
Arquivo: `supabase/migrations/20261112140000_pending_request_avatars.sql`.

## Contrato e escopo

`public.bandup_pending_request_avatars(p_band_id uuid, p_request_ids uuid[])`
retorna exclusivamente `TABLE(request_id uuid, avatar_url text)`.

O cliente futuro envia os IDs da página já carregada por
`createBandEntryService().adminRequests(bandId, offset, true)`, no máximo 20.
A autorização exige `auth.uid()`, papel JWT `authenticated` e participação `admin`
nessa banda, consultada diretamente no banco. Metadados não autorizam nada.
Externos, membros comuns e administradores de outra banda recebem a mesma recusa
`42501`, inclusive para banda ausente/NULL; a autorização precede validação do lote.

Só aparecem pedidos dessa banda ainda pendentes, dentre os IDs fornecidos.
IDs de outras bandas, inexistentes e pedidos decididos/cancelados são omitidos.
Duplicatas não duplicam resultados. Lote vazio retorna vazio; NULL, elemento NULL,
matriz multidimensional e mais de 20 IDs são rejeitados. Não há parâmetro user_id,
diretório de pessoas, busca por e-mail ou paginação independente da lista privada.
Resultados são ordenados por ID; o frontend futuro deve montar um mapa por
request_id, preservando a ordenação/paginação original dos pedidos.

## URL e privacidade

A RPC lê internamente somente `auth.users.id/raw_user_meta_data`, por meio de
SECURITY DEFINER. Não concede acesso à tabela Auth nem retorna requester_id,
e-mail, bio, nomes ou metadados completos. A associação é pelo requester_id do
pedido autorizado, nunca um ID arbitrário fornecido como identidade do usuário.

Só aceita avatar_url JSON string com origem exata
`https://zwmihhdvvpqgyavworgh.supabase.co`, caminho público do bucket `avatars`,
pasta igual ao UUID do solicitante e arquivo UUID v4 canônico `.jpg/.png/.webp`,
como `avatarObjectPath` e as policies de avatars já existentes.
Credenciais, outra origem/bucket/pessoa, query, fragmento, caminho codificado,
subpastas, SVG e URLs legadas/de provedores retornam NULL. Não usa `picture`.
Essa validação é intencionalmente mais restrita que o renderizador pessoal,
que também admite fotos externas. O arquivo pode não existir: não há leitura de
Storage/bytes; futuramente ProfileAvatar deverá oferecer iniciais em onError.
Metadata continua sendo apresentação editável, não comprovação de identidade.

O bucket permanece público. A RPC autoriza uma nova forma de descobrir a URL
vinculada a um pedido; isso não deve ser tratado como acesso público a perfis.
Nenhuma policy, grant de tabela, função antiga, dado ou objeto Storage é alterado.
REVOKE/GRANT atingem somente a função nova, na mesma transação de sua criação.
Owners/configurações são fixados; ACLs extras/default ou EXECUTE herdado por
anon/service_role abortam toda a instalação. Papéis administrativos continuam
tendo seus privilégios implícitos; não há promessa de isolamento de superusers.

## Evidência e limites do schema

O DDL original de band_join_requests **não está presente** nas migrations locais.
Os contratos existentes (`bandup_rpc_definicoes_instaladas.sql`, a candidata
all_bands_search_review e src/lib/band-entry.ts) referenciam id, band_id,
requester_id e status='pending'. Os testes usam fixtures sintéticas com esses
campos; não afirmam reproduzir o Demo.

A candidata verifica colunas/tipos, ID unicamente indexado, RLS habilitada,
executor postgres com bypass já existente, bucket avatars público, schema usage,
Auth helpers e colisões antes de criar a RPC. Aceita status text/varchar ou enum
com rótulo pending; outros contratos param sem ajustes de schema/grants.
Origem fixa ao Demo deve ser revisada antes de qualquer uso em outro projeto.

O SELECT STABLE usa o snapshot da instrução. Uma demissão/decisão confirmada é
respeitada na próxima chamada; não há lock que retire uma URL já lida nem garantia
de sincronização com alterações confirmadas depois do início da instrução.

## Testes isolados

```powershell
$env:BANDUP_REQUEST_AVATAR_LOCAL_TESTS = 'create-isolated-cluster'
node tests/postgres/request-avatars-isolated.cjs --execute
```

Runner manual, sem execução ao importar. Cria cluster PostgreSQL 17 em TEMP,
somente loopback, porta aleatória diferente de 5433, banco com UUID, e verifica
database/address/port/version/data_directory/session_user/current_user em toda
conexão antes de enviar SQL de fixture/teste. Limpa variáveis PG herdadas; não lê
.env, não recebe URL de conexão e não conecta a banco existente/remoto.
Encerra o servidor e preserva banco/logs/result.json. Windows pode exigir aprovação
fora do sandbox para iniciar pg_ctl. Não apagar/reiniciar clusters anteriores.

Cobertura: admin, membro, externo solicitante, admin de outra banda, anônimo,
UID ausente, papel JWT incorreto, perda de cargo, lote misto com pedidos de outras
bandas, estados encerrados, limites, duplicatas, duas páginas e 20 casos de URL.
Testa status text e enum em bancos separados, nega acesso direto a auth.users,
compara policies/grants/funções/bucket anteriores, testa drift de coluna, colisão,
default ACL adicional e grant herdado com rollback. Auth/JWTs são simulados;
não valida autenticação HTTP, cache PostgREST ou entrega dos arquivos.

Validação local em 12/11/2026: **94 asserções SQL aprovadas** (49 no banco com
status text, incluindo gates de instalação; 45 no banco com enum), sete grupos
de validação concluídos. Servidor encerrado; bancos e manifesto preservados no
TEMP, diretório terminado em `bandup-request-avatars-9BVosJ`.
SHA-256 da candidata testada:
`b8aa823b5e4ab67df9b61195625387be8d32f354d952b37388cb945537e2f12b`.
Os 44 testes automatizados selecionados e lint também passaram.

## Antes de propor aplicação remota

Confirmar projeto, backup, janela e autorização específica em etapa separada.
Não usar db push/migration repair: o ledger conhecido está divergente.
Conferir em leitura o schema real, índices, RLS, grants efetivos/defaults e papéis
herdados; a comparação de fixtures não substitui auditoria do destino.
Consultas iniciais sem ler conteúdo de contas/pedidos:

```sql
SELECT table_schema,table_name,column_name,data_type,udt_schema,udt_name
FROM information_schema.columns
WHERE (table_schema='public' AND table_name IN ('bands','band_members','band_join_requests'))
   OR (table_schema='auth' AND table_name='users' AND column_name IN ('id','raw_user_meta_data'))
ORDER BY table_schema,table_name,ordinal_position;

SELECT c.oid::regclass,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c WHERE c.oid IN (to_regclass('public.bands'),
 to_regclass('public.band_members'),to_regclass('public.band_join_requests'),to_regclass('auth.users'));

SELECT indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='band_join_requests';

SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE (schemaname='public' AND tablename IN ('bands','band_members','band_join_requests'))
 OR (schemaname='storage' AND tablename='objects');

SELECT id,public FROM storage.buckets WHERE id='avatars';

SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner),p.proacl,p.proconfig,pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND n.nspname IN ('public','private','auth')
 AND p.proname IN ('bandup_pending_request_avatars','uid','role');

SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl
FROM pg_default_acl;
```

Se houver divergência, parar e revisar; não retirar gates nem corrigir grants para
forçar aplicação. Integração frontend, aplicação e smoke tests remotos não fazem
parte desta etapa.
