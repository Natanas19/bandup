# RPC candidata: avatares dos integrantes

Somente preparação local. Nenhuma aplicação no Demo, alteração do frontend ou reconciliação de ledger foi realizada.

## Contrato e segurança

`public.bandup_member_avatars(p_band_id uuid, p_user_ids uuid[])` retorna somente `user_id uuid, avatar_url text`. Exige sessão `authenticated` e participação atual (`admin` ou `member`) na banda. Usuários externos e bandas inexistentes recebem a mesma negativa, antes da validação dos argumentos.

Cada chamada recebe no máximo 20 IDs, incluindo repetições. Arrays vazios são aceitos; arrays nulos, multidimensionais, com elementos nulos ou maiores são rejeitados. IDs duplicados não duplicam resultados. Usuários desconhecidos, removidos ou de outra banda são omitidos. A ordenação é por UUID; o consumidor deverá associar por `user_id`, consultando somente a página existente de integrantes, sem tratar a função como diretório ou paginador.

A URL só é retornada se corresponder exatamente a `https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/avatars/<user_id>/<UUIDv4 minúsculo>.(jpg|png|webp)`, conforme o uploader atual. Fotos ausentes, legadas, origem diferente, outro usuário/bucket, queries, fragmentos e caminhos não canônicos retornam NULL. Isso valida o endereço, não a existência, conteúdo ou disponibilidade do arquivo; o frontend futuro precisará manter fallback.

A função lê internamente `auth.users`, mas não concede acesso à tabela nem retorna e-mail ou metadados completos. Usa SECURITY DEFINER, owner postgres, search_path fixo e apenas EXECUTE para authenticated. Nenhuma policy, grant de origem ou RPC existente é modificada. ACL inesperada herdada/default causa rollback, sem tentativa de reparo. Metadados editáveis nunca autorizam a operação; a associação em `band_members` autoriza.

A autorização observa o snapshot da instrução PostgreSQL. Remoção de participação afeta chamadas seguintes; não revoga URLs públicas já conhecidas nem uma leitura já iniciada. Fotos em bucket público não se tornam privadas por esta RPC.

## Compatibilidade e aplicação futura

Não se presume correspondência entre repositório e Demo. Antes de qualquer aplicação, confirmar identidade inequívoca do projeto autorizado, definição real das tabelas, helpers, roles, privilégios, RLS e ausência de colisão do nome. A candidata verifica tipos das seis colunas utilizadas, índice único válido não parcial de `(band_id,user_id)`, unicidade de `auth.users.id`, RLS de bands/band_members, bucket avatars público, executor postgres com bypass existente, privilégios de leitura e ACL efetiva da nova função. Um schema com role enum, por exemplo, exige revisão; o contrato local exige text.

Consultas exclusivamente de leitura úteis para revisão do destino:

```sql
SELECT current_database(), current_user, version(); -- não prova sozinho a identidade do projeto
SELECT n.nspname, c.relname, a.attname, format_type(a.atttypid,a.atttypmod)
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname,c.relname) IN (('public','bands'),('public','band_members'),('auth','users'))
AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,a.attnum;
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE (schemaname,tablename) IN (('public','band_members'),('auth','users'));
SELECT oid::regclass,relrowsecurity,relforcerowsecurity FROM pg_class
WHERE oid IN ('public.bands'::regclass,'public.band_members'::regclass);
SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN ('bands','band_members');
SELECT id,public FROM storage.buckets WHERE id='avatars';
SELECT p.oid::regprocedure,p.proowner::regrole,p.proacl,p.proconfig,
       pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private','auth') AND p.proname IN
('bandup_member_avatars','bandup_member_display_names','bandup_pending_request_avatars','uid','role');
SELECT rolname,rolsuper,rolbypassrls FROM pg_roles
WHERE rolname IN ('postgres','anon','authenticated','service_role');
SELECT * FROM pg_default_acl;
SELECT * FROM pg_auth_members;
```

Examinar também privilégios efetivos com `has_schema_privilege`, `has_column_privilege`, `has_function_privilege` e `pg_has_role`, reproduzindo os gates da candidata sem executar seu DDL. Não coletar registros de usuários ou credenciais. A origem fixa deve ser revisada se outro projeto for o destino.

Uma aplicação futura requer autorização separada, backup e janela compatíveis com o site publicado. O backup lógico não contém binários do Storage nem comprova restauração testada. Aplicar exclusivamente o arquivo integral, uma vez, em sua transação; erro exige rollback e diagnóstico, sem reaplicar fragmentos. Não usar db push/migration repair nem alterar ledger divergente. Após commit confirmado, verificar contrato, ACL e metadados da função com SQL de leitura. Não executar recuperação pós-commit automaticamente.

## Testes locais

Runner manual: `tests/postgres/member-avatars-isolated.cjs`. Requer PostgreSQL 17 e opt-in `BANDUP_MEMBER_AVATAR_LOCAL_TESTS=create-isolated-cluster`, seguido de `node tests/postgres/member-avatars-isolated.cjs --execute`.

Cria cluster novo em TEMP, porta efêmera exclusivamente loopback, banco aleatório e dados sintéticos. Cada conexão confirma banco, porta, data_directory, versão e identidade antes de executar testes. Não lê .env, não usa bancos existentes e limpa variáveis PG herdadas. Instala as duas RPCs históricas apenas nesse banco sintético e compara suas definições e permissões após a candidata. Retém manifesto/logs locais e encerra o servidor.

Cobertura: administrador, membro comum, externo, anônimo, banda estrangeira, participação em duas bandas, remoção de caller/target, limites, duplicações, dois lotes, 20 casos de URL, projeção mínima, bloqueio de auth.users, imutabilidade de policies/grants/RPCs/buckets, gates de schema/RLS/bucket e ACLs inesperadas. Não simula JWT real via HTTP nem testa arquivos físicos do Storage. Nenhum teste comprova o schema remoto.

Valida??o em 12/11/2026: 56 assertions SQL e 8 grupos aprovados, servidor encerrado e fonte inalterada. SHA-256 da candidata: `2fbef14ddee8ce2418dbe36b5a4c4249461e1765d81cbe00d4cd21c496ad9e3e`. Manifesto local: `C:/Users/USURIO~2/AppData/Local/Temp/bandup-member-avatars-W75yJa/result.json`.
