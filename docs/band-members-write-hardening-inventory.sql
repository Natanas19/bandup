-- SOMENTE CONSULTAS DE CATALOGO. Proposta para futura coleta autorizada.
-- Nao executado no Demo. Exportar resultados completos, sem dados pessoais.
-- ATUALIZACAO: ACL tabela/coluna/PUBLIC e ausencia de heranca de authenticated
-- para postgres/supabase_admin ja confirmadas pelo usuario. Reutilizar resultados;
-- NAO repetir essas consultas. Arquivo e referencia, nao executar integralmente.
-- Selecionar somente lacunas essenciais indicadas no documento da proposta.
SELECT version(), current_database(), current_user;
SELECT c.oid::regclass AS relation, pg_get_userbyid(c.relowner) AS owner,
  c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c WHERE c.oid='public.band_members'::regclass;
SELECT a.attname,a.attacl FROM pg_attribute a
WHERE a.attrelid='public.band_members'::regclass AND a.attnum>0 AND NOT a.attisdropped;
-- ACLs cruas preservam grantor, PUBLIC (=0) e grant options.
SELECT 'table' AS scope,NULL::text AS column_name,x.*
FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
WHERE c.oid='public.band_members'::regclass
UNION ALL
SELECT 'column',a.attname,x.* FROM pg_attribute a
CROSS JOIN LATERAL aclexplode(a.attacl) x
WHERE a.attrelid='public.band_members'::regclass AND a.attnum>0 AND NOT a.attisdropped;
SELECT oid,rolname,rolsuper,rolbypassrls,rolcreaterole,rolinherit,rolcanlogin
FROM pg_roles ORDER BY rolname;
-- to_jsonb inclui inherit_option/set_option onde a versao os oferece.
SELECT to_jsonb(m) AS membership FROM pg_auth_members m ORDER BY roleid,member;
SELECT r.rolname,
  pg_has_role('authenticated',r.oid,'MEMBER') AS authenticated_member,
  pg_has_role('authenticated',r.oid,'USAGE') AS authenticated_inherits,
  has_table_privilege(r.oid,'public.band_members','SELECT') AS can_select,
  has_table_privilege(r.oid,'public.band_members','DELETE') AS can_delete,
  has_table_privilege(r.oid,'public.band_members','INSERT') AS table_insert,
  has_table_privilege(r.oid,'public.band_members','UPDATE') AS table_update,
  has_any_column_privilege(r.oid,'public.band_members','INSERT') AS column_insert,
  has_any_column_privilege(r.oid,'public.band_members','UPDATE') AS column_update
FROM pg_roles r ORDER BY r.rolname;
SELECT p.* FROM pg_policies p WHERE schemaname='public' AND tablename='band_members';
SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.policyname)::text,'[]')) AS policies_md5
FROM pg_policies p WHERE schemaname='public' AND tablename='band_members';
SELECT t.tgrelid::regclass AS relation,t.tgname,t.tgenabled,
  t.tgfoid::regprocedure AS function,pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t WHERE t.tgrelid IN ('public.band_members'::regclass,'public.bands'::regclass)
AND NOT t.tgisinternal ORDER BY t.tgrelid,t.tgname;
SELECT md5(coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,
  'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true))
  ORDER BY t.tgname)::text,'[]')) AS triggers_md5
FROM pg_trigger t WHERE t.tgrelid='public.band_members'::regclass AND NOT t.tgisinternal;
-- Revisar tambem invokers: podem chamar definers, views ou SQL dinamico.
SELECT p.oid::regprocedure::text AS identity,pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef,p.proconfig,p.proacl,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  md5(pg_get_functiondef(p.oid)) AS definition_md5,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind IN ('f','p') AND n.nspname IN ('public','private') ORDER BY identity;
SELECT conrelid::regclass AS child,confrelid::regclass AS parent,conname,
  pg_get_constraintdef(oid,true) AS definition FROM pg_constraint
WHERE conrelid='public.band_members'::regclass OR confrelid='public.band_members'::regclass;
SELECT pg_describe_object(d.classid,d.objid,d.objsubid) AS dependent,d.deptype
FROM pg_depend d WHERE d.refclassid='pg_class'::regclass
AND d.refobjid='public.band_members'::regclass;
SELECT schemaname,viewname,definition FROM pg_views WHERE schemaname IN ('public','private');
SELECT * FROM pg_default_acl;
-- pg_depend nao descobre integralmente corpos PL/pgSQL/SQL dinamico.
-- Dependencias e rotinas fora de public/private, endpoints customizados e
-- memberships do authenticator requerem revisao humana com visibilidade completa.
