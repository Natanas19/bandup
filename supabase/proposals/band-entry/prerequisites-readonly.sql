-- PREPARED, NOT EXECUTED. Metadata only; no connection/credentials/target discovery.
-- Read prerequisites-readonly.md before a separately authorized future execution.
-- PostgreSQL 15+; fresh dedicated session; stop on any error, do not retry automatically.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- One result set: section + JSON metadata. No SELECT from business relations,
-- no application function invocation, no ledger, no auth records or row counts.
WITH RECURSIVE
expected_relations(schema_name,relation_name) AS (VALUES
  ('public','bands'),('public','band_members'),('auth','users')
),
sources AS (
  SELECT e.*,c.oid,c.relkind,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
  FROM expected_relations e
  LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.schema_name
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=e.relation_name
),
source_columns AS (
  SELECT s.schema_name,s.relation_name,a.*,d.adbin,d.oid AS default_oid
  FROM sources s JOIN pg_catalog.pg_attribute a ON a.attrelid=s.oid
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attnum>0 AND NOT a.attisdropped
    AND (s.relation_name='band_members' OR a.attname='id')
),
source_policies AS (
  SELECT p.* FROM pg_catalog.pg_policy p JOIN sources s ON s.oid=p.polrelid
  WHERE s.schema_name='public'
),
source_triggers AS (
  SELECT t.* FROM pg_catalog.pg_trigger t JOIN sources s ON s.oid=t.tgrelid
  WHERE s.schema_name='public' AND NOT t.tgisinternal
),
ddl_triggers AS (
  SELECT e.* FROM pg_catalog.pg_event_trigger e WHERE e.evtenabled<>'D'
),
seed_functions AS (
  SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE (n.nspname='auth' AND p.proname='uid' AND p.pronargs=0)
     OR (n.nspname='pg_catalog' AND p.proname='gen_random_uuid' AND p.pronargs=0)
     OR (n.nspname='private' AND p.proname IN ('is_band_member','is_band_admin',
       'add_band_creator_as_admin','prevent_last_band_admin_removal','guard_band_member_band'))
  UNION SELECT tgfoid FROM source_triggers
  UNION SELECT evtfoid FROM ddl_triggers
  UNION SELECT d.refobjid FROM pg_catalog.pg_depend d
    JOIN source_policies p ON d.classid='pg_catalog.pg_policy'::regclass AND d.objid=p.oid
    WHERE d.refclassid='pg_catalog.pg_proc'::regclass
  UNION SELECT d.refobjid FROM pg_catalog.pg_depend d
    JOIN source_columns c ON d.classid='pg_catalog.pg_attrdef'::regclass AND d.objid=c.default_oid
    WHERE d.refclassid='pg_catalog.pg_proc'::regclass
),
function_oids(oid) AS (
  SELECT oid FROM seed_functions
  UNION
  SELECT d.refobjid FROM function_oids f JOIN pg_catalog.pg_depend d
    ON d.classid='pg_catalog.pg_proc'::regclass AND d.objid=f.oid
  JOIN pg_catalog.pg_proc p ON p.oid=d.refobjid
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE d.refclassid='pg_catalog.pg_proc'::regclass
    AND n.nspname NOT IN ('pg_catalog','information_schema')
),
functions AS (
  SELECT p.*,n.nspname FROM function_oids f JOIN pg_catalog.pg_proc p ON p.oid=f.oid
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f'
),
expected_subjects(subject,role_name) AS (VALUES
  ('executor',current_user::text),('session',session_user::text),
  ('anon','anon'),('authenticated','authenticated'),('service_role','service_role')
),
subjects AS (
  SELECT e.subject,r.oid,r.rolsuper,r.rolbypassrls,r.rolinherit,r.rolcanlogin
  FROM expected_subjects e LEFT JOIN pg_catalog.pg_roles r ON r.rolname=e.role_name
),
role_paths(start_oid,role_oid) AS (
  SELECT oid,oid FROM subjects WHERE oid IS NOT NULL
  UNION
  SELECT p.start_oid,m.roleid FROM role_paths p JOIN pg_catalog.pg_auth_members m ON m.member=p.role_oid
),
relevant_owners(oid) AS (
  SELECT relowner FROM sources WHERE oid IS NOT NULL
  UNION SELECT proowner FROM functions
  UNION SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname IN ('public','auth','private')
  UNION SELECT oid FROM subjects WHERE subject='executor'
),
planned_relations(name) AS (VALUES
  ('band_join_directory'),('band_join_requests'),('band_join_directory_pkey'),
  ('band_join_requests_pkey'),('band_join_one_pending'),
  ('band_join_requests_requester'),('band_join_requests_band_status')
),
planned_functions(name) AS (VALUES
  ('bandup_set_discovery'),('bandup_get_discovery'),('bandup_discover_bands'),
  ('bandup_request_entry'),('bandup_cancel_entry'),('bandup_decide_entry')
),
required_functions(schema_name,function_name) AS (VALUES ('auth','uid'),('pg_catalog','gen_random_uuid')),
report(section,details) AS (
  SELECT '01_session',pg_catalog.jsonb_build_object(
    'database',pg_catalog.current_database(),
    'version_num',pg_catalog.current_setting('server_version_num'),
    'read_only',pg_catalog.current_setting('transaction_read_only'),
    'isolation',pg_catalog.current_setting('transaction_isolation'),
    'encoding',pg_catalog.current_setting('server_encoding'),
    'fresh_role',current_user=session_user,
    'note','Database name alone does not identify the bandup-demo Supabase project')
  UNION ALL
  SELECT '02_relations',pg_catalog.jsonb_build_object(
    'schema',s.schema_name,'name',s.relation_name,'present',s.oid IS NOT NULL,
    'oid',s.oid,'kind',s.relkind,'owner_oid',s.relowner,'rls',s.relrowsecurity,'force_rls',s.relforcerowsecurity)
    FROM sources s
  UNION ALL
  SELECT '03_columns',pg_catalog.jsonb_build_object(
    'schema',c.schema_name,'table',c.relation_name,'column',c.attname,
    'type',pg_catalog.format_type(c.atttypid,c.atttypmod),'not_null',c.attnotnull,
    'identity',c.attidentity,'generated',c.attgenerated,
    'default',pg_catalog.pg_get_expr(c.adbin,c.attrelid,true),'column_acl',c.attacl)
    FROM source_columns c
  UNION ALL
  SELECT '04_constraints',pg_catalog.jsonb_build_object(
    'schema',s.schema_name,'table',s.relation_name,'name',c.conname,'type',c.contype,
    'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,
    'definition',pg_catalog.pg_get_constraintdef(c.oid,true),'index_oid',c.conindid)
    FROM pg_catalog.pg_constraint c JOIN sources s ON s.oid=c.conrelid
    WHERE s.relation_name='band_members' OR (c.contype IN ('p','u') AND c.conkey=ARRAY[
      (SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid=s.oid AND a.attname='id' AND NOT a.attisdropped)
    ]::smallint[])
  UNION ALL
  SELECT '05_indexes',pg_catalog.jsonb_build_object(
    'schema',s.schema_name,'table',s.relation_name,'index_oid',i.indexrelid,
    'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'immediate',i.indimmediate,
    'definition',pg_catalog.pg_get_indexdef(i.indexrelid))
    FROM pg_catalog.pg_index i JOIN sources s ON s.oid=i.indrelid
    WHERE s.relation_name='band_members' OR (i.indisunique AND i.indnkeyatts=1 AND
      i.indkey[0]=(SELECT a.attnum FROM pg_catalog.pg_attribute a
        WHERE a.attrelid=s.oid AND a.attname='id' AND NOT a.attisdropped))
  UNION ALL
  SELECT '06_rls_policies',pg_catalog.jsonb_build_object(
    'table_oid',p.polrelid,'name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
    'role_oids',p.polroles,'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid,true),
    'with_check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid,true)) FROM source_policies p
  UNION ALL
  SELECT '07_triggers',pg_catalog.jsonb_build_object(
    'table_oid',t.tgrelid,'name',t.tgname,'enabled',t.tgenabled,'function_oid',t.tgfoid,
    'definition',pg_catalog.pg_get_triggerdef(t.oid,true)) FROM source_triggers t
  UNION ALL
  SELECT '08_functions',pg_catalog.jsonb_build_object(
    'oid',p.oid,'schema',p.nspname,'name',p.proname,'owner_oid',p.proowner,
    'argument_types',p.proargtypes::text,'return_type',pg_catalog.format_type(p.prorettype,NULL),
    'security_definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl,
    'definition',pg_catalog.pg_get_functiondef(p.oid)) FROM functions p
  UNION ALL
  SELECT '09_roles',pg_catalog.jsonb_build_object(
    'subject',s.subject,'oid',s.oid,'present',s.oid IS NOT NULL,
    'superuser',s.rolsuper,'bypass_rls',s.rolbypassrls,'inherit',s.rolinherit,'login',s.rolcanlogin) FROM subjects s
  UNION ALL
  SELECT '09_owner_roles',pg_catalog.jsonb_build_object(
    'oid',r.oid,'superuser',r.rolsuper,'bypass_rls',r.rolbypassrls,'inherit',r.rolinherit,'login',r.rolcanlogin)
    FROM relevant_owners o JOIN pg_catalog.pg_roles r ON r.oid=o.oid
  UNION ALL
  SELECT '10_role_ancestry',pg_catalog.jsonb_build_object('start_oid',p.start_oid,'role_oid',p.role_oid)
    FROM role_paths p
  UNION ALL
  SELECT '11_role_membership_edges',pg_catalog.to_jsonb(m)
    FROM pg_catalog.pg_auth_members m
    WHERE EXISTS(SELECT 1 FROM role_paths p WHERE p.role_oid=m.member)
  UNION ALL
  SELECT '12_owner_membership',pg_catalog.jsonb_build_object(
    'subject',s.subject,'owner_oid',o.oid,'member',pg_catalog.pg_has_role(s.oid,o.oid,'MEMBER'),
    'effective_usage',pg_catalog.pg_has_role(s.oid,o.oid,'USAGE'))
    FROM subjects s CROSS JOIN relevant_owners o WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT '13_schema_privileges',pg_catalog.jsonb_build_object(
    'subject',s.subject,'schema',n.nspname,'owner_oid',n.nspowner,'acl',n.nspacl,
    'usage',pg_catalog.has_schema_privilege(s.oid,n.oid,'USAGE'),
    'create',pg_catalog.has_schema_privilege(s.oid,n.oid,'CREATE'))
    FROM subjects s CROSS JOIN pg_catalog.pg_namespace n
    WHERE s.oid IS NOT NULL AND n.nspname IN ('public','auth','private')
  UNION ALL
  SELECT '14_table_privileges',pg_catalog.jsonb_build_object(
    'subject',u.subject,'table_oid',s.oid,'schema',s.schema_name,'table',s.relation_name,'acl',s.relacl,
    'select',pg_catalog.has_table_privilege(u.oid,s.oid,'SELECT'),
    'insert',pg_catalog.has_table_privilege(u.oid,s.oid,'INSERT'),
    'update',pg_catalog.has_table_privilege(u.oid,s.oid,'UPDATE'),
    'delete',pg_catalog.has_table_privilege(u.oid,s.oid,'DELETE'),
    'references',pg_catalog.has_table_privilege(u.oid,s.oid,'REFERENCES'))
    FROM subjects u CROSS JOIN sources s WHERE u.oid IS NOT NULL AND s.oid IS NOT NULL
  UNION ALL
  SELECT '15_column_privileges',pg_catalog.jsonb_build_object(
    'subject',s.subject,'table_oid',c.attrelid,'column',c.attname,
    'select',pg_catalog.has_column_privilege(s.oid,c.attrelid,c.attnum,'SELECT'),
    'insert',pg_catalog.has_column_privilege(s.oid,c.attrelid,c.attnum,'INSERT'),
    'update',pg_catalog.has_column_privilege(s.oid,c.attrelid,c.attnum,'UPDATE'))
    FROM subjects s CROSS JOIN source_columns c WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT '16_function_privileges',pg_catalog.jsonb_build_object(
    'subject',s.subject,'function_oid',p.oid,'execute',pg_catalog.has_function_privilege(s.oid,p.oid,'EXECUTE'))
    FROM subjects s CROSS JOIN functions p WHERE s.oid IS NOT NULL
  UNION ALL
  SELECT '17_future_owner_default_acl',pg_catalog.jsonb_build_object(
    'owner_oid',d.defaclrole,'namespace_oid',d.defaclnamespace,'object_type',d.defaclobjtype,'acl',d.defaclacl)
    FROM pg_catalog.pg_default_acl d JOIN subjects s ON s.subject='executor' AND s.oid=d.defaclrole
    WHERE d.defaclnamespace=0 OR d.defaclnamespace IN (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname='public')
  UNION ALL
  SELECT '18_name_collisions',pg_catalog.jsonb_build_object(
    'kind','relation','name',p.name,'present',c.oid IS NOT NULL,'oid',c.oid,'relkind',c.relkind)
    FROM planned_relations p LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
    LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=p.name
  UNION ALL
  SELECT '18_name_collisions',pg_catalog.jsonb_build_object(
    'kind','function','name',f.name,'present',p.oid IS NOT NULL,'oid',p.oid,'argument_types',p.proargtypes::text)
    FROM planned_functions f LEFT JOIN pg_catalog.pg_namespace n ON n.nspname='public'
    LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace=n.oid AND p.proname=f.name
  UNION ALL
  SELECT '19_event_triggers',pg_catalog.jsonb_build_object(
    'oid',e.oid,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,'function_oid',e.evtfoid) FROM ddl_triggers e
  UNION ALL
  SELECT '20_rewrite_rules',pg_catalog.jsonb_build_object(
    'table_oid',r.ev_class,'name',r.rulename,'event',r.ev_type,'enabled',r.ev_enabled,'instead',r.is_instead)
    FROM pg_catalog.pg_rewrite r JOIN sources s ON s.oid=r.ev_class WHERE s.schema_name='public'
  UNION ALL
  SELECT '21_required_functions',pg_catalog.jsonb_build_object(
    'schema',e.schema_name,'name',e.function_name,'present',p.oid IS NOT NULL,'oid',p.oid,
    'kind',p.prokind,'returns_set',p.proretset,'return_type',pg_catalog.format_type(p.prorettype,NULL))
    FROM required_functions e LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.schema_name
    LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace=n.oid AND p.proname=e.function_name AND p.pronargs=0
)
SELECT section,details FROM report ORDER BY section,details::text;
ROLLBACK;
