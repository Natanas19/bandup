-- PREPARED, NOT EXECUTED. After M8, BEFORE any legacy fixture or bridge.
-- Catalog-only assertions; no DDL, DML, temporary objects or application calls.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
\ir compatibility_lab_identity_check.sql
-- BEGIN POST-M8 STRUCTURE; generated from reviewed local contracts.
DO $post_m8_structure$
DECLARE expected record; actual record; relation_oid oid; owner_oid oid; role_name text;
  local_keys smallint[]; remote_keys smallint[]; delete_keys smallint[];
  qual text; checked text;
BEGIN
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('bandup_public_reader','bandup_profile_reader'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
     OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private')<>9
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
         AND c.relname NOT IN ('bands','band_members','social_links','tasks','events')) THEN
    RAISE EXCEPTION 'Wrong phase: legacy/publication objects or extra public relations exist';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('auth'),('private'),('public')
  ) AS s(name) LOOP
    IF pg_catalog.to_regnamespace(expected.name) IS NULL THEN RAISE EXCEPTION 'Required schema missing: %',expected.name; END IF;
    IF expected.name<>'public' AND (SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname=expected.name)<>owner_oid THEN
      RAISE EXCEPTION 'Schema owner differs: %',expected.name;
    END IF;
    IF expected.name='public' AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,pg_catalog.pg_database d
        WHERE n.nspname='public' AND d.datname=pg_catalog.current_database() AND d.datdba=owner_oid
          AND n.nspowner IN (owner_oid,'pg_database_owner'::regrole::oid)) THEN
      RAISE EXCEPTION 'Database/public schema owner differs';
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES ('bands'),('band_members'),('social_links'),('tasks'),('events')) AS t(name) LOOP
    relation_oid:=pg_catalog.to_regclass('public.'||expected.name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=relation_oid
        AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity AND relowner=owner_oid
        AND NOT relispartition AND relpersistence='p')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhrelid=relation_oid OR inhparent=relation_oid) THEN
      RAISE EXCEPTION 'Source table/RLS/ownership differs: %',expected.name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid=relation_oid),pg_catalog.acldefault('r',owner_oid))) a
        WHERE a.grantee<>owner_oid AND (a.grantee<>'authenticated'::regrole::oid OR a.is_grantable
          OR a.grantor<>owner_oid OR a.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE')))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a,LATERAL pg_catalog.aclexplode(a.attacl) acl
         WHERE a.attrelid=relation_oid AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>owner_oid)
       OR NOT pg_catalog.has_table_privilege('authenticated',relation_oid,'SELECT')
       OR NOT pg_catalog.has_table_privilege('authenticated',relation_oid,'INSERT')
       OR NOT pg_catalog.has_table_privilege('authenticated',relation_oid,'UPDATE')
       OR NOT pg_catalog.has_table_privilege('authenticated',relation_oid,'DELETE') THEN
      RAISE EXCEPTION 'Source ACL differs: %',expected.name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('bands','id','uuid',true,'gen_random_uuid()'),
    ('bands','name','text',true,NULL::text),
    ('bands','slug','text',true,NULL::text),
    ('bands','description','text',false,NULL::text),
    ('bands','logo_url','text',false,NULL::text),
    ('bands','created_at','timestamp with time zone',true,'now()'),
    ('bands','updated_at','timestamp with time zone',true,'now()'),
    ('band_members','id','uuid',true,'gen_random_uuid()'),
    ('band_members','band_id','uuid',true,NULL::text),
    ('band_members','user_id','uuid',true,NULL::text),
    ('band_members','role','text',true,NULL::text),
    ('band_members','created_at','timestamp with time zone',true,'now()'),
    ('social_links','id','uuid',true,'gen_random_uuid()'),
    ('social_links','band_id','uuid',true,NULL::text),
    ('social_links','platform','text',true,NULL::text),
    ('social_links','url','text',true,NULL::text),
    ('social_links','created_at','timestamp with time zone',true,'now()'),
    ('tasks','id','uuid',true,'gen_random_uuid()'),
    ('tasks','band_id','uuid',true,NULL::text),
    ('tasks','created_by','uuid',true,NULL::text),
    ('tasks','title','text',true,NULL::text),
    ('tasks','description','text',false,NULL::text),
    ('tasks','status','text',true,NULL::text),
    ('tasks','priority','text',true,NULL::text),
    ('tasks','due_date','timestamp with time zone',false,NULL::text),
    ('tasks','assigned_to','uuid',false,NULL::text),
    ('tasks','created_at','timestamp with time zone',true,'now()'),
    ('tasks','updated_at','timestamp with time zone',true,'now()'),
    ('tasks','event_id','uuid',false,NULL::text),
    ('events','id','uuid',true,'gen_random_uuid()'),
    ('events','band_id','uuid',true,NULL::text),
    ('events','created_by','uuid',true,NULL::text),
    ('events','title','text',true,NULL::text),
    ('events','description','text',false,NULL::text),
    ('events','event_type','text',true,NULL::text),
    ('events','start_at','timestamp with time zone',true,NULL::text),
    ('events','end_at','timestamp with time zone',false,NULL::text),
    ('events','location','text',false,NULL::text),
    ('events','created_at','timestamp with time zone',true,'now()'),
    ('events','updated_at','timestamp with time zone',true,'now()')
  ) AS a(table_name,name,type_name,not_null,default_expression) LOOP
    SELECT a.*,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS expression INTO actual
      FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=pg_catalog.to_regclass('public.'||expected.table_name) AND a.attname=expected.name
        AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND THEN RAISE EXCEPTION 'Column missing: %.%',expected.table_name,expected.name; END IF;
    IF actual.atttypid<>pg_catalog.to_regtype(expected.type_name) OR actual.atttypmod<>-1
       OR actual.attnotnull<>expected.not_null OR actual.attgenerated<>'' OR actual.attidentity<>''
       OR actual.attcollation<>(SELECT typcollation FROM pg_catalog.pg_type WHERE oid=actual.atttypid)
       OR pg_catalog.replace(actual.expression,'::text','') IS DISTINCT FROM expected.default_expression THEN
      RAISE EXCEPTION 'Column type/nullability/default differs: %.%',expected.table_name,expected.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid IN
      ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass)
      AND attnum>0 AND NOT attisdropped)<>40 THEN RAISE EXCEPTION 'Unexpected source columns'; END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('bands','bands_pkey','p','id',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text),
    ('bands','bands_slug_key','u','slug',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text),
    ('band_members','band_members_pkey','p','id',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text),
    ('band_members','band_members_band_id_user_id_key','u','band_id,user_id',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text),
    ('social_links','social_links_pkey','p','id',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text),
    ('tasks','tasks_pkey','p','id',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text),
    ('events','events_pkey','p','id',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text),
    ('events','events_band_id_id_key','u','band_id,id',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text),
    ('band_members','band_members_band_id_fkey','f','band_id','public.bands','id','c',NULL::text,NULL::text),
    ('band_members','band_members_user_id_fkey','f','user_id','auth.users','id','c',NULL::text,NULL::text),
    ('social_links','social_links_band_id_fkey','f','band_id','public.bands','id','c',NULL::text,NULL::text),
    ('tasks','tasks_band_id_fkey','f','band_id','public.bands','id','c',NULL::text,NULL::text),
    ('tasks','tasks_created_by_fkey','f','created_by','auth.users','id','c',NULL::text,NULL::text),
    ('tasks','tasks_assigned_to_fkey','f','assigned_to','auth.users','id','n',NULL::text,NULL::text),
    ('tasks','tasks_assigned_to_band_member_fkey','f','band_id,assigned_to','public.band_members','band_id,user_id','a',NULL::text,NULL::text),
    ('tasks','tasks_event_same_band_fkey','f','band_id,event_id','public.events','band_id,id','n','event_id',NULL::text),
    ('events','events_band_id_fkey','f','band_id','public.bands','id','c',NULL::text,NULL::text),
    ('events','events_created_by_fkey','f','created_by','auth.users','id','c',NULL::text,NULL::text),
    ('band_members','band_members_role_check','c',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'role = ANY (ARRAY[''admin''::text, ''member''::text])'),
    ('tasks','tasks_status_check','c',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'status = ANY (ARRAY[''todo''::text, ''in_progress''::text, ''done''::text])'),
    ('tasks','tasks_priority_check','c',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'priority = ANY (ARRAY[''low''::text, ''medium''::text, ''high''::text])'),
    ('events','events_check','c',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'end_at IS NULL OR end_at >= start_at'),
    ('events','events_event_type_not_empty_check','c',NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'length(btrim(event_type)) > 0')
  ) AS k(table_name,name,kind,columns,reference_table,reference_columns,delete_action,delete_columns,expression) LOOP
    SELECT * INTO actual FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('public.'||expected.table_name) AND conname=expected.name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Constraint missing: %',expected.name; END IF;
    IF actual.contype::text<>expected.kind OR NOT actual.convalidated OR actual.condeferrable OR actual.condeferred
       OR NOT actual.conislocal OR actual.coninhcount<>0 OR actual.conparentid<>0 THEN
      RAISE EXCEPTION 'Constraint flags differ: %',expected.name;
    END IF;
    IF expected.kind IN ('p','u','f') THEN
      SELECT pg_catalog.array_agg(a.attnum ORDER BY n.ord) INTO local_keys
        FROM pg_catalog.unnest(pg_catalog.string_to_array(expected.columns,',')) WITH ORDINALITY n(name,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=actual.conrelid AND a.attname=n.name AND NOT a.attisdropped;
      IF actual.conkey IS DISTINCT FROM local_keys THEN RAISE EXCEPTION 'Constraint columns differ: %',expected.name; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=actual.conindid AND indisvalid AND indisready AND indislive
          AND indisunique AND indpred IS NULL AND indexprs IS NULL) THEN
        RAISE EXCEPTION 'Constraint supporting index differs: %',expected.name;
      END IF;
    END IF;
    IF expected.kind='f' THEN
      SELECT pg_catalog.array_agg(a.attnum ORDER BY n.ord) INTO remote_keys
        FROM pg_catalog.unnest(pg_catalog.string_to_array(expected.reference_columns,',')) WITH ORDINALITY n(name,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=pg_catalog.to_regclass(expected.reference_table) AND a.attname=n.name AND NOT a.attisdropped;
      SELECT pg_catalog.array_agg(a.attnum ORDER BY n.ord) INTO delete_keys
        FROM pg_catalog.unnest(pg_catalog.string_to_array(expected.delete_columns,',')) WITH ORDINALITY n(name,ord)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=actual.conrelid AND a.attname=n.name AND NOT a.attisdropped;
      IF actual.confrelid IS DISTINCT FROM pg_catalog.to_regclass(expected.reference_table)::oid
         OR actual.confkey IS DISTINCT FROM remote_keys OR actual.confdeltype::text<>expected.delete_action
         OR actual.confupdtype<>'a' OR actual.confmatchtype<>'s' OR actual.confdelsetcols IS DISTINCT FROM delete_keys THEN
        RAISE EXCEPTION 'Foreign key target/actions differ: %',expected.name;
      END IF;
    ELSIF expected.kind='c' THEN
      IF actual.connoinherit OR pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(actual.conbin,actual.conrelid)),
          '[[:space:]()]','','g') IS DISTINCT FROM pg_catalog.regexp_replace(pg_catalog.lower(expected.expression),'[[:space:]()]','','g') THEN
        RAISE EXCEPTION 'Check expression differs: %',expected.name;
      END IF;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE conrelid IN
      ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass))<>23 THEN
    RAISE EXCEPTION 'Unexpected source constraints';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('bands','bands_select_for_members','r','private.is_band_member(id)',NULL::text),
    ('bands','bands_insert_for_authenticated_users','a',NULL::text,'((selectauth.uid()asuid)isnotnull)'),
    ('bands','bands_update_for_admins','w','(private.is_band_member(id)andprivate.is_band_admin(id))','(private.is_band_member(id)andprivate.is_band_admin(id))'),
    ('bands','bands_delete_for_admins','d','(private.is_band_member(id)andprivate.is_band_admin(id))',NULL::text),
    ('band_members','band_members_select_for_band_members','r','private.is_band_member(band_id)',NULL::text),
    ('band_members','band_members_insert_for_admins','a',NULL::text,'(private.is_band_member(band_id)andprivate.is_band_admin(band_id))'),
    ('band_members','band_members_update_for_admins','w','(private.is_band_member(band_id)andprivate.is_band_admin(band_id))','(private.is_band_member(band_id)andprivate.is_band_admin(band_id))'),
    ('band_members','band_members_delete_for_admins','d','(private.is_band_member(band_id)andprivate.is_band_admin(band_id))',NULL::text),
    ('social_links','social_links_select_for_band_members','r','private.is_band_member(band_id)',NULL::text),
    ('social_links','social_links_insert_for_admins','a',NULL::text,'private.is_band_admin(band_id)'),
    ('social_links','social_links_update_for_admins','w','(private.is_band_member(band_id)andprivate.is_band_admin(band_id))','(private.is_band_member(band_id)andprivate.is_band_admin(band_id))'),
    ('social_links','social_links_delete_for_admins','d','(private.is_band_member(band_id)andprivate.is_band_admin(band_id))',NULL::text),
    ('tasks','tasks_select_for_band_members','r','private.is_band_member(band_id)',NULL::text),
    ('tasks','tasks_insert_for_band_members','a',NULL::text,'(private.is_band_member(band_id)and((selectauth.uid()asuid)isnotnull)and(created_by=(selectauth.uid()asuid))and((assigned_toisnull)orprivate.is_band_member_for_user(band_id,assigned_to)))'),
    ('tasks','tasks_update_for_admins_or_involved_members','w','(private.is_band_member(band_id)and(private.is_band_admin(band_id)or(created_by=(selectauth.uid()asuid))or(assigned_to=(selectauth.uid()asuid))))','(private.is_band_member(band_id)and((assigned_toisnull)orprivate.is_band_member_for_user(band_id,assigned_to))and(private.is_band_admin(band_id)or(created_by=(selectauth.uid()asuid))or(assigned_to=(selectauth.uid()asuid))))'),
    ('events','events_select_for_band_members','r','private.is_band_member(band_id)',NULL::text),
    ('events','events_insert_for_band_members','a',NULL::text,'(private.is_band_member(band_id)and((selectauth.uid()asuid)isnotnull)and(created_by=(selectauth.uid()asuid)))'),
    ('events','events_update_for_admins_or_creators','w','(private.is_band_member(band_id)and(private.is_band_admin(band_id)or(created_by=(selectauth.uid()asuid))))','(private.is_band_member(band_id)and(private.is_band_admin(band_id)or(created_by=(selectauth.uid()asuid))))'),
    ('tasks','tasks_delete_for_admins','d','(private.is_band_member(band_id)andprivate.is_band_admin(band_id))',NULL::text),
    ('events','events_delete_for_admins','d','(private.is_band_member(band_id)andprivate.is_band_admin(band_id))',NULL::text)
  ) AS p(table_name,name,command,using_expression,check_expression) LOOP
    SELECT * INTO actual FROM pg_catalog.pg_policy WHERE polrelid=pg_catalog.to_regclass('public.'||expected.table_name) AND polname=expected.name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Policy missing: %',expected.name; END IF;
    -- Preserve grouping. Expected strings include PG17 scalar SELECT alias AS uid.
    qual:=pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(actual.polqual,actual.polrelid,false)),'[[:space:]]','','g');
    checked:=pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(actual.polwithcheck,actual.polrelid,false)),'[[:space:]]','','g');
    IF actual.polcmd::text<>expected.command OR NOT actual.polpermissive
       OR actual.polroles<>ARRAY['authenticated'::regrole::oid]
       OR qual IS DISTINCT FROM expected.using_expression
       OR checked IS DISTINCT FROM expected.check_expression THEN
      RAISE EXCEPTION 'Policy role/command/expression differs: %',expected.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid IN
      ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass))<>20 THEN
    RAISE EXCEPTION 'Unexpected source policies';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name AND NOT rolcanlogin AND NOT rolinherit
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=role_name)
       OR NOT pg_catalog.has_schema_privilege(role_name,'public','USAGE')
       OR NOT pg_catalog.has_schema_privilege(role_name,'auth','USAGE')
       OR pg_catalog.has_schema_privilege(role_name,'public','CREATE')
       OR pg_catalog.has_schema_privilege(role_name,'auth','CREATE')
       OR pg_catalog.has_schema_privilege(role_name,'private','CREATE')
       OR pg_catalog.has_schema_privilege(role_name,'private','USAGE') IS DISTINCT FROM (role_name='authenticated') THEN
      RAISE EXCEPTION 'Role/schema privileges differ: %',role_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
      WHERE n.nspname IN ('public','private','auth') AND a.grantee<>n.nspowner
        AND (a.is_grantable OR a.privilege_type<>'USAGE'
          OR NOT ((n.nspname='public' AND a.grantee IN (0,'anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid))
            OR (n.nspname='auth' AND a.grantee IN ('anon'::regrole::oid,'authenticated'::regrole::oid,'service_role'::regrole::oid))
            OR (n.nspname='private' AND a.grantee='authenticated'::regrole::oid)))) THEN
    RAISE EXCEPTION 'Unexpected schema ACL';
  END IF;
END;
$post_m8_structure$;
-- END POST-M8 STRUCTURE

-- BEGIN REVIEWED CONTRACT (bridge); generated from local historical sources.
-- Hashes detect drift, not authorship. CRLF and edge ASCII whitespace only are ignored.
DO $reviewed_contract$
DECLARE expected record; actual record; reader oid; source oid; role_name text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('is_band_member','2764a1ff8e9b45f8b472b2f498d364ee','sql',true,'s','boolean',ARRAY['search_path=""','row_security=off']::text[]),
    ('is_band_admin','a65cd13542441fb64037090ab5307954','sql',true,'s','boolean',ARRAY['search_path=""','row_security=off']::text[]),
    ('is_band_member_for_user','dc9d7f43b9ce090f78a51065b11be642','sql',true,'s','boolean',ARRAY['search_path=""','row_security=off']::text[]),
    ('add_band_creator_as_admin','f0b29863f3bb8df2a63caa6da2465d25','plpgsql',true,'v','trigger',ARRAY['search_path=""','row_security=off']::text[]),
    ('prevent_last_band_admin_removal','c5f8061ed20fdf76cc41968cf9a877ba','plpgsql',true,'v','trigger',ARRAY['search_path=""','row_security=off']::text[]),
    ('prevent_task_author_or_band_change','578f598f169c2461317e12830e4232fb','plpgsql',true,'v','trigger',ARRAY['search_path=""','row_security=off']::text[]),
    ('set_updated_at','859e33cc5977aa917f7eb29bd2b42faf','plpgsql',false,'v','trigger',ARRAY['search_path=""']::text[]),
    ('guard_event_ownership','9e9a5e724ca294b2de18d6bc4abfffa3','plpgsql',false,'v','trigger',ARRAY['search_path=""']::text[]),
    ('guard_band_member_band','e3e495f9614733bf147c795921f9172a','plpgsql',false,'v','trigger',ARRAY['search_path=""']::text[])
  ) AS f(name,body_hash,language_name,definer,volatility,result_type,config) LOOP
    SELECT p.*, l.lanname INTO actual FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE n.nspname='private' AND p.proname=expected.name;
    IF NOT FOUND OR (SELECT count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='private' AND p.proname=expected.name)<>1 THEN
      RAISE EXCEPTION 'Reviewed function missing or overloaded: %',expected.name;
    END IF;
    IF pg_catalog.md5(pg_catalog.btrim(pg_catalog.replace(actual.prosrc,pg_catalog.chr(13),''),
         ' '||pg_catalog.chr(9)||pg_catalog.chr(10)))<>expected.body_hash
       OR actual.lanname<>expected.language_name OR actual.prosecdef<>expected.definer
       OR actual.provolatile::text<>expected.volatility OR actual.prokind<>'f'
       OR actual.prorettype<>pg_catalog.to_regtype(expected.result_type)
       OR actual.proargtypes::text<>(CASE WHEN expected.result_type='boolean'
         THEN CASE WHEN expected.name='is_band_member_for_user' THEN '2950 2950' ELSE '2950' END ELSE '' END)
       OR actual.pronargdefaults<>0
       OR actual.proconfig IS DISTINCT FROM expected.config
       OR actual.proisstrict OR actual.proretset OR actual.proleakproof OR actual.proparallel<>'u'
       OR actual.proowner<>(SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.bands'::regclass)
       OR (expected.result_type='boolean' AND NOT pg_catalog.has_function_privilege('authenticated',actual.oid,'EXECUTE'))
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(actual.proacl,
            pg_catalog.acldefault('f',actual.proowner))) a
         WHERE a.grantee<>actual.proowner AND (expected.result_type<>'boolean'
           OR a.grantee<>'authenticated'::regrole::oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
      RAISE EXCEPTION 'Reviewed function body/security/owner/ACL differs: %',expected.name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('bands','bands_add_creator_as_admin','add_band_creator_as_admin',5),
    ('bands','bands_set_updated_at','set_updated_at',19),
    ('band_members','band_members_guard_band_id','guard_band_member_band',19),
    ('band_members','band_members_prevent_last_admin_removal','prevent_last_band_admin_removal',27),
    ('tasks','tasks_prevent_author_or_band_change','prevent_task_author_or_band_change',19),
    ('tasks','tasks_set_updated_at','set_updated_at',19),
    ('events','events_guard_ownership','guard_event_ownership',19),
    ('events','events_set_updated_at','set_updated_at',19)
  ) AS t(table_name,trigger_name,function_name,trigger_type) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid=pg_catalog.to_regclass('public.'||expected.table_name)
        AND t.tgname=expected.trigger_name AND t.tgtype=expected.trigger_type
        AND t.tgfoid=pg_catalog.to_regprocedure('private.'||expected.function_name||'()')
        AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgqual IS NULL
        AND t.tgattr=''::pg_catalog.int2vector AND t.tgnargs=0
        AND t.tgargs=''::pg_catalog.bytea AND t.tgconstraint=0
        AND NOT t.tgdeferrable AND NOT t.tginitdeferred
        AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL) THEN
      RAISE EXCEPTION 'Reviewed trigger differs: %',expected.trigger_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND tgrelid IN
      ('public.bands'::regclass,'public.band_members'::regclass,'public.events'::regclass,
       'public.tasks'::regclass,'public.social_links'::regclass))<>8 THEN
    RAISE EXCEPTION 'Unexpected source trigger inventory';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name AND NOT rolsuper
        AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
       OR pg_catalog.has_schema_privilege(role_name,'public','CREATE')
       OR pg_catalog.has_schema_privilege(role_name,'private','CREATE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=role_name) THEN
      RAISE EXCEPTION 'Application role has elevated powers';
    END IF;
  END LOOP;
  FOR reader IN SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname IN ('bandup_public_reader','bandup_profile_reader') LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE oid=reader AND
        (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=reader)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid=reader
         AND ((SELECT rolname FROM pg_catalog.pg_roles WHERE oid=reader)='bandup_profile_reader'
           OR m.member<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER) OR m.admin_option))
       OR pg_catalog.has_schema_privilege(reader,'public','CREATE')
       OR pg_catalog.has_schema_privilege(reader,'private','CREATE') THEN
      RAISE EXCEPTION 'Reader powers/membership/schema ACL differs';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE reader=ANY(polroles)
        AND polrelid IN ('public.bands'::regclass,'public.band_members'::regclass,'public.events'::regclass,
          'public.tasks'::regclass,'public.social_links'::regclass))<>
        (CASE WHEN reader='bandup_public_reader'::regrole::oid THEN 3 ELSE 2 END) THEN
      RAISE EXCEPTION 'Reader policy inventory differs';
    END IF;
    FOR expected IN SELECT p.*, c.relname FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      WHERE c.oid IN ('public.bands'::regclass,'public.band_members'::regclass,'public.events'::regclass,
        'public.tasks'::regclass,'public.social_links'::regclass)
        AND (0=ANY(p.polroles) OR reader=ANY(p.polroles)) LOOP
      IF expected.polcmd<>'r' OR NOT expected.polpermissive OR expected.polroles<>ARRAY[reader]
         OR expected.polwithcheck IS NOT NULL
         OR ((expected.relname='bands' AND expected.polname=CASE
              WHEN reader='bandup_public_reader'::regrole::oid THEN 'bands_select_for_public_reader' ELSE 'bands_select_for_profile_reader' END
            AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(expected.polqual,expected.polrelid)),
              '[[:space:]()]','','g')='is_publicistrue')
           OR (expected.relname='events' AND reader='bandup_public_reader'::regrole::oid
             AND expected.polname='events_select_for_public_reader'
             AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(expected.polqual,expected.polrelid)),
               '[[:space:]()]','','g')='existsselect1frompublic.bandsbandwhereband.id=events.band_idandband.is_publicistrue')
           OR (expected.relname='social_links' AND expected.polname=CASE
              WHEN reader='bandup_public_reader'::regrole::oid THEN 'social_links_select_for_public_reader' ELSE 'social_links_select_for_profile_reader' END
             AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(expected.polqual,expected.polrelid)),
               '[[:space:]()]','','g')=''||'existsselect1frompublic.bandsbandwhereband.id=social_links.band_idandband.is_publicistrue')) IS NOT TRUE THEN
        RAISE EXCEPTION 'Reader policy differs or PUBLIC policy exists';
      END IF;
    END LOOP;
    FOREACH source IN ARRAY ARRAY['public.bands'::regclass::oid,'public.band_members'::regclass::oid,
        'public.events'::regclass::oid,'public.tasks'::regclass::oid,'public.social_links'::regclass::oid] LOOP
      IF (SELECT relowner=reader FROM pg_catalog.pg_class WHERE oid=source)
         OR pg_catalog.has_table_privilege(reader,source,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         OR pg_catalog.has_any_column_privilege(reader,source,'INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Reader owns a source or has source write privileges';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        WHERE a.attrelid=source AND a.attnum>0 AND NOT a.attisdropped
          AND pg_catalog.has_column_privilege(reader,source,a.attname,'SELECT') IS DISTINCT FROM
           ((c.relname='bands' AND a.attname=ANY(ARRAY['id','name','slug','description','logo_url','is_public']))
            OR (c.relname='social_links' AND a.attname=ANY(CASE WHEN reader='bandup_public_reader'::regrole::oid
              THEN ARRAY['band_id','platform','url','is_public'] ELSE ARRAY['id','band_id','platform','url','created_at','is_public'] END))
            OR (reader='bandup_public_reader'::regrole::oid AND c.relname='events'
              AND a.attname=ANY(ARRAY['band_id','title','event_type','start_at','end_at','location'])))) THEN
        RAISE EXCEPTION 'Reader projection source privileges differ';
      END IF;
    END LOOP;
  END LOOP;
  FOREACH source IN ARRAY ARRAY['public.bands'::regclass::oid,'public.band_members'::regclass::oid,
      'public.events'::regclass::oid,'public.tasks'::regclass::oid,'public.social_links'::regclass::oid] LOOP
    IF NOT (SELECT relkind='r' AND relrowsecurity FROM pg_catalog.pg_class WHERE oid=source) THEN
      RAISE EXCEPTION 'Reviewed source RLS/kind differs';
    END IF;
    IF (SELECT relowner FROM pg_catalog.pg_class WHERE oid=source)<>
       (SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.bands'::regclass) THEN
      RAISE EXCEPTION 'Reviewed source owner differs';
    END IF;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.pg_has_role(role_name,(SELECT relowner FROM pg_catalog.pg_class WHERE oid=source),'MEMBER') THEN
        RAISE EXCEPTION 'Application role can assume source owner';
      END IF;
    END LOOP;
    IF pg_catalog.has_table_privilege('anon',source,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_any_column_privilege('anon',source,'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Anonymous source privileges';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid,
      LATERAL pg_catalog.aclexplode(a.attacl) acl
      WHERE n.nspname='public' AND c.relname IN
        ('public_bands','public_events','public_social_links','public_band_profiles')
        AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner
        AND (acl.grantee NOT IN ('anon'::regrole::oid,'authenticated'::regrole::oid)
          OR acl.privilege_type<>'SELECT' OR acl.is_grantable)) THEN
    RAISE EXCEPTION 'Unexpected public view column ACL';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
      LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE n.nspname='public' AND c.relname IN
        ('public_bands','public_events','public_social_links','public_band_profiles') AND a.grantee<>c.relowner
        AND (a.grantee NOT IN ('anon'::regrole::oid,'authenticated'::regrole::oid)
          OR a.privilege_type<>'SELECT' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'Unexpected public view table ACL';
  END IF;
END;
$reviewed_contract$;
-- END REVIEWED CONTRACT

ROLLBACK;
