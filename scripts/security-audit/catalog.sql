-- Metadata only. Invoked by audit.cjs inside a READ ONLY transaction.
-- No application RPC, user row, function body, policy expression or secret is returned.
SELECT jsonb_build_object(
  'readOnly', current_setting('transaction_read_only') = 'on',
  'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
    'anonRead',has_table_privilege('anon',c.oid,'SELECT'),
    'authenticatedRead',has_table_privilege('authenticated',c.oid,'SELECT'),
    'anonWrite',has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'),
    'authenticatedWrite',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'),
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
  ) ORDER BY n.nspname,c.relname),'[]'::jsonb)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p')),
  'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
    'name',k.conname,'type',k.contype,'validated',k.convalidated,'definitionHash',md5(pg_get_constraintdef(k.oid))) ORDER BY k.oid),'[]'::jsonb)
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
  'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',ic.relname,
    'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'definitionHash',md5(pg_get_indexdef(i.indexrelid))) ORDER BY ic.oid),'[]'::jsonb)
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
  'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,
    'command',cmd,'permissive',permissive,'roles',roles,'definitionHash',md5(coalesce(qual,'')||'|'||coalesce(with_check,''))) ORDER BY schemaname,tablename,policyname),'[]'::jsonb)
    FROM pg_policies WHERE schemaname IN ('public','private','storage')),
  'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'signature',pg_get_function_identity_arguments(p.oid),'securityDefiner',p.prosecdef,
    'return_type',format_type(p.prorettype,NULL),
    'fixedSearchPath',EXISTS(SELECT 1 FROM unnest(p.proconfig) x WHERE x LIKE 'search_path=%'),
    'publicExecute',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
    'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),
    'definitionHash',md5(pg_get_functiondef(p.oid))) ORDER BY p.oid),'[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'),
  'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
    'enabled',t.tgenabled,'definitionHash',md5(pg_get_triggerdef(t.oid))) ORDER BY t.oid),'[]'::jsonb)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','private','storage') AND NOT t.tgisinternal),
  'views',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
    'securityInvoker',coalesce(c.reloptions @> ARRAY['security_invoker=true'],false),
    'definitionHash',md5(pg_get_viewdef(c.oid))) ORDER BY c.oid),'[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind='v'),
  'apiRoles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls)) FROM pg_roles WHERE rolname IN ('anon','authenticated')),
  'privateApiCreate',has_schema_privilege('anon','private','CREATE') OR has_schema_privilege('authenticated','private','CREATE'),
  'ledgerPresent',to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'storage',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',id,'public',public,'sizeLimit',file_size_limit,
    'mimeTypes',allowed_mime_types) ORDER BY id),'[]'::jsonb) FROM storage.buckets WHERE id IN ('avatars','band-logos'))
);
