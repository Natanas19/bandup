-- PREPARED ONLY. Never executed during preparation. Migration 10.
-- Field-change validation preserves legacy values on unrelated updates.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
DO $preflight$
DECLARE expected record; relation_oid oid;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 150000
     OR pg_catalog.current_setting('server_encoding') <> 'UTF8'
     OR pg_catalog.to_regnamespace('private') IS NULL
     OR pg_catalog.to_regprocedure('private.is_safe_external_url_v1(text)') IS NULL
     OR pg_catalog.to_regprocedure('private.guard_external_link_url_v1()') IS NULL THEN
    RAISE EXCEPTION 'Requires UTF8 PostgreSQL 15+ and the nine preceding migrations';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname='guard_functional_integrity_v1')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname LIKE '%_zz_guard_functional_integrity')
     OR pg_catalog.to_regclass('pg_temp.bandup_functional_before') IS NOT NULL THEN
    RAISE EXCEPTION 'Functional integrity object collision; do not reapply automatically';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('bands','name','text',true),
    ('bands','slug','text',true),
    ('bands','created_at','timestamp with time zone',true),
    ('bands','updated_at','timestamp with time zone',true),
    ('band_members','created_at','timestamp with time zone',true),
    ('social_links','platform','text',true),
    ('social_links','created_at','timestamp with time zone',true),
    ('tasks','title','text',true),
    ('tasks','created_at','timestamp with time zone',true),
    ('tasks','updated_at','timestamp with time zone',true),
    ('tasks','due_date','timestamp with time zone',false),
    ('events','title','text',true),
    ('events','event_type','text',true),
    ('events','created_at','timestamp with time zone',true),
    ('events','updated_at','timestamp with time zone',true),
    ('events','start_at','timestamp with time zone',true),
    ('events','end_at','timestamp with time zone',false)
  ) AS required(table_name,column_name,type_name,not_null) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid=pg_catalog.to_regclass('public.'||expected.table_name)
        AND a.attname=expected.column_name AND NOT a.attisdropped
        AND a.atttypid=pg_catalog.to_regtype(expected.type_name)
        AND a.attnotnull=expected.not_null) THEN
      RAISE EXCEPTION 'Unexpected column contract: %.%',expected.table_name,expected.column_name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('bands','bands_add_creator_as_admin','add_band_creator_as_admin',5),
    ('bands','bands_guard_publication','guard_band_publication',23),
    ('bands','bands_set_updated_at','set_updated_at',19),
    ('band_members','band_members_guard_band_id','guard_band_member_band',19),
    ('band_members','band_members_prevent_last_admin_removal','prevent_last_band_admin_removal',27),
    ('social_links','social_links_guard_publication','guard_social_link_publication',23),
    ('social_links','social_links_zz_guard_external_url','guard_external_link_url_v1',23),
    ('tasks','tasks_prevent_author_or_band_change','prevent_task_author_or_band_change',19),
    ('tasks','tasks_set_updated_at','set_updated_at',19),
    ('events','events_guard_ownership','guard_event_ownership',19),
    ('events','events_set_updated_at','set_updated_at',19)
  ) AS required(table_name,trigger_name,function_name,trigger_type) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid=pg_catalog.to_regclass('public.'||expected.table_name)
        AND t.tgname=expected.trigger_name AND t.tgenabled='O' AND NOT t.tgisinternal
        AND t.tgtype=expected.trigger_type
        AND t.tgfoid=pg_catalog.to_regprocedure('private.'||expected.function_name||'()')) THEN
      RAISE EXCEPTION 'Missing or disabled historical trigger: %',expected.trigger_name;
    END IF;
  END LOOP;
  FOREACH relation_oid IN ARRAY ARRAY['public.bands'::regclass::oid,'public.band_members'::regclass::oid,
    'public.social_links'::regclass::oid,'public.tasks'::regclass::oid,'public.events'::regclass::oid] LOOP
    IF NOT (SELECT relrowsecurity AND relkind='r' FROM pg_catalog.pg_class WHERE oid=relation_oid)
       OR NOT (SELECT rolsuper OR pg_catalog.pg_has_role(oid,
         (SELECT relowner FROM pg_catalog.pg_class WHERE oid=relation_oid),'USAGE')
         FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER)
       OR pg_catalog.has_table_privilege('anon',relation_oid,'SELECT')
       OR pg_catalog.has_any_column_privilege('anon',relation_oid,'SELECT') THEN
      RAISE EXCEPTION 'Unexpected RLS, anonymous grants, relation kind or executor ownership';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND tgrelid IN
    ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass))<>11 THEN
    RAISE EXCEPTION 'Unexpected additional source triggers; inspect ordering before applying';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(CURRENT_USER,'private','CREATE')
     OR NOT pg_catalog.has_database_privilege(CURRENT_USER,pg_catalog.current_database(),'TEMP') THEN
    RAISE EXCEPTION 'Executor lacks private schema CREATE or database TEMP';
  END IF;
END;
$preflight$;
CREATE TEMP TABLE bandup_functional_before ON COMMIT DROP AS
SELECT pg_catalog.jsonb_build_object(
  'relations', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relacl,c.reloptions,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.polname,p.polcmd,p.polroles,p.polpermissive,p.polqual::text,p.polwithcheck::text) ORDER BY p.polname)
      FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid,false) ORDER BY k.oid)
      FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid,false) ORDER BY t.tgname)
      FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND t.tgname NOT LIKE '%_zz_guard_functional_integrity')) ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid IN ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass,'public.public_band_profiles'::regclass)),
  'view', pg_catalog.pg_get_viewdef('public.public_band_profiles'::regclass,false),
  'functions', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.oid,p.proowner,p.proacl,pg_catalog.pg_get_functiondef(p.oid)) ORDER BY p.oid)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname <> 'guard_functional_integrity_v1')
) AS contract;
CREATE FUNCTION private.guard_functional_integrity_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $functional_guard$
DECLARE
  new_row jsonb := pg_catalog.to_jsonb(NEW);
  old_row jsonb;
  spec text; kind text; column_name text; value text;
  timestamp_value timestamptz; slug_units integer; character_index integer;
  -- Exact ECMAScript trim whitespace; no locale-dependent character class.
  whitespace text := pg_catalog.chr(9)||pg_catalog.chr(10)||pg_catalog.chr(11)||pg_catalog.chr(12)||pg_catalog.chr(13)||
    pg_catalog.chr(32)||pg_catalog.chr(160)||pg_catalog.chr(5760)||
    pg_catalog.chr(8192)||pg_catalog.chr(8193)||pg_catalog.chr(8194)||pg_catalog.chr(8195)||
    pg_catalog.chr(8196)||pg_catalog.chr(8197)||pg_catalog.chr(8198)||pg_catalog.chr(8199)||
    pg_catalog.chr(8200)||pg_catalog.chr(8201)||pg_catalog.chr(8202)||pg_catalog.chr(8232)||
    pg_catalog.chr(8233)||pg_catalog.chr(8239)||pg_catalog.chr(8287)||pg_catalog.chr(12288)||pg_catalog.chr(65279);
BEGIN
  IF TG_OP='UPDATE' THEN old_row := pg_catalog.to_jsonb(OLD); END IF;
  FOREACH spec IN ARRAY TG_ARGV LOOP
    kind := pg_catalog.split_part(spec,':',1);
    column_name := pg_catalog.split_part(spec,':',2);
    IF TG_OP='UPDATE' AND (new_row->column_name) IS NOT DISTINCT FROM (old_row->column_name) THEN
      CONTINUE;
    END IF;
    value := new_row->>column_name;
    -- Existing NOT NULL constraints retain their original SQLSTATE 23502.
    IF value IS NULL THEN CONTINUE; END IF;
    IF kind IN ('text','slug') THEN
      IF pg_catalog.btrim(value,whitespace)='' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Required text cannot contain only whitespace',
          CONSTRAINT=TG_TABLE_NAME||'_'||column_name||'_nonblank';
      END IF;
      IF kind='slug' THEN
        -- Match the existing public-profile path contract, not generated kebab-case.
        IF value IN ('.','..') OR value COLLATE "C" ~ '[[:cntrl:]]'
           OR pg_catalog.char_length(value)>2048 THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unsupported public profile slug',
            CONSTRAINT='bands_slug_public_path';
        END IF;
        -- PostgreSQL characters and browser UTF-16 maxlength are different for emoji.
        slug_units := pg_catalog.char_length(value);
        FOR character_index IN 1..pg_catalog.char_length(value) LOOP
          IF pg_catalog.ascii(pg_catalog.substr(value,character_index,1))>65535 THEN slug_units:=slug_units+1; END IF;
        END LOOP;
        IF slug_units>2048 THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Public profile slug exceeds 2048 UTF-16 units',
            CONSTRAINT='bands_slug_public_path';
        END IF;
      END IF;
    ELSIF kind IN ('time','start') THEN
      timestamp_value := value::pg_catalog.timestamptz;
      IF NOT pg_catalog.isfinite(timestamp_value) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Timestamp must be finite',
          CONSTRAINT=TG_TABLE_NAME||'_'||column_name||'_finite';
      END IF;
      IF kind='start' AND timestamp_value<pg_catalog.statement_timestamp() THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='New or changed event start cannot be in the past',
          CONSTRAINT='events_start_at_not_past';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unexpected functional integrity trigger configuration';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$functional_guard$;
-- Trigger invocation uses the installed trigger; no application EXECUTE grant needed.
REVOKE ALL ON FUNCTION private.guard_functional_integrity_v1()
FROM PUBLIC, anon, authenticated, service_role, bandup_public_reader;

CREATE TRIGGER bands_zz_guard_functional_integrity
BEFORE INSERT OR UPDATE ON public.bands
FOR EACH ROW EXECUTE FUNCTION private.guard_functional_integrity_v1('text:name','slug:slug','time:created_at','time:updated_at');

CREATE TRIGGER band_members_zz_guard_functional_integrity
BEFORE INSERT OR UPDATE ON public.band_members
FOR EACH ROW EXECUTE FUNCTION private.guard_functional_integrity_v1('time:created_at');

CREATE TRIGGER social_links_zz_guard_functional_integrity
BEFORE INSERT OR UPDATE ON public.social_links
FOR EACH ROW EXECUTE FUNCTION private.guard_functional_integrity_v1('text:platform','time:created_at');

CREATE TRIGGER tasks_zz_guard_functional_integrity
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION private.guard_functional_integrity_v1('text:title','time:created_at','time:updated_at','time:due_date');

CREATE TRIGGER events_zz_guard_functional_integrity
BEFORE INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION private.guard_functional_integrity_v1('text:title','text:event_type','time:created_at','time:updated_at','start:start_at','time:end_at');

DO $postconditions$
DECLARE after_contract jsonb;
BEGIN
  SELECT snapshot.contract INTO after_contract FROM (
SELECT pg_catalog.jsonb_build_object(
  'relations', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relacl,c.reloptions,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.polname,p.polcmd,p.polroles,p.polpermissive,p.polqual::text,p.polwithcheck::text) ORDER BY p.polname)
      FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid,false) ORDER BY k.oid)
      FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid,false) ORDER BY t.tgname)
      FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND t.tgname NOT LIKE '%_zz_guard_functional_integrity')) ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid IN ('public.bands'::regclass,'public.band_members'::regclass,'public.social_links'::regclass,'public.tasks'::regclass,'public.events'::regclass,'public.public_band_profiles'::regclass)),
  'view', pg_catalog.pg_get_viewdef('public.public_band_profiles'::regclass,false),
  'functions', (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.oid,p.proowner,p.proacl,pg_catalog.pg_get_functiondef(p.oid)) ORDER BY p.oid)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname <> 'guard_functional_integrity_v1')
) AS contract
  ) AS snapshot;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.bandup_functional_before WHERE contract=after_contract) THEN
    RAISE EXCEPTION 'Existing columns, constraints, RLS, ACLs, triggers, functions or view changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
    LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid='private.guard_functional_integrity_v1()'::regprocedure AND a.grantee<>p.proowner) THEN
    RAISE EXCEPTION 'Unexpected default grants on new functional trigger function';
  END IF;
END;
$postconditions$;
COMMIT;
