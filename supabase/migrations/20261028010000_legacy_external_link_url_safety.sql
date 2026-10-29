-- PREPARED ONLY. NOT EXECUTED. Apply only after explicit authorization.
-- Legacy compatibility branch: requires 20261028000000, NOT original migration 9.
-- Original migration 10 is considered only AFTER this branch passes its own tests.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';

-- BEGIN REVIEWED CONTRACT (url); generated from local historical sources.
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
    ('guard_band_member_band','e3e495f9614733bf147c795921f9172a','plpgsql',false,'v','trigger',ARRAY['search_path=""']::text[]),
    ('guard_band_publication','0f4763336ade11b601a50007a9047018','plpgsql',false,'v','trigger',ARRAY['search_path=""']::text[]),
    ('guard_social_link_publication','587d7cfea2b07769c7dae1bd9e8ec7ae','plpgsql',false,'v','trigger',ARRAY['search_path=""']::text[])
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
    ('events','events_set_updated_at','set_updated_at',19),
    ('bands','bands_guard_publication','guard_band_publication',23),
    ('social_links','social_links_guard_publication','guard_social_link_publication',23)
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
       'public.tasks'::regclass,'public.social_links'::regclass))<>10 THEN
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
               '[[:space:]()]','','g')='is_publicistrueand'||'existsselect1frompublic.bandsbandwhereband.id=social_links.band_idandband.is_publicistrue')) IS NOT TRUE THEN
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

DO $preflight$
DECLARE
  view_oid oid := pg_catalog.to_regclass('public.public_band_profiles');
  reader_oid oid;
  relation_oid oid;
  expected record;
  actual record;
  normalized_qual text;
  normalized_check text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 150000
     OR pg_catalog.to_regnamespace('private') IS NULL OR view_oid IS NULL THEN
    RAISE EXCEPTION 'URL safety requires PostgreSQL 15+ and the existing public profile schema';
  END IF;
  SELECT oid INTO reader_oid FROM pg_catalog.pg_roles WHERE rolname = 'bandup_profile_reader'
    AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication;
  IF reader_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class WHERE oid = view_oid AND relkind = 'v' AND relowner = reader_oid
      AND reloptions @> ARRAY['security_barrier=true', 'security_invoker=false']::text[]
      AND pg_catalog.cardinality(reloptions) = 2
  ) THEN RAISE EXCEPTION 'Unexpected public view owner, kind or security options'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname IN ('is_safe_external_url_v1', 'guard_external_link_url_v1'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.social_links'::regclass
       AND tgname = 'social_links_zz_guard_external_url')
     OR pg_catalog.to_regclass('pg_temp.bandup_url_contract_before') IS NOT NULL
     OR pg_catalog.to_regclass('pg_temp.bandup_url_expected_view') IS NOT NULL THEN
    RAISE EXCEPTION 'URL safety object collision; do not replace or reapply automatically';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.social_links'::regclass AND tgname = 'social_links_guard_publication'
      AND tgfoid = pg_catalog.to_regprocedure('private.guard_social_link_publication()')
      AND tgtype = 23 AND tgenabled = 'O' AND NOT tgisinternal)
     OR (SELECT count(*) FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.social_links'::regclass AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'Unexpected social link triggers; inspect ordering and behavior first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.social_links'::regclass AND attname = 'url'
        AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_attrdef d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.social_links'::regclass AND a.attname = 'is_public'
        AND a.atttypid = 'boolean'::regtype AND a.attnotnull AND NOT a.attisdropped
        AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'false') THEN
    RAISE EXCEPTION 'Unexpected link URL/publication column contract';
  END IF;
  FOREACH relation_oid IN ARRAY ARRAY['public.bands'::regclass::oid, 'public.social_links'::regclass::oid,
    'public.band_members'::regclass::oid, 'public.tasks'::regclass::oid, 'public.events'::regclass::oid] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = relation_oid)
       OR pg_catalog.has_table_privilege('anon', relation_oid, 'SELECT')
       OR pg_catalog.has_any_column_privilege('anon', relation_oid, 'SELECT') THEN
      RAISE EXCEPTION 'Source-table RLS or anonymous grants differ from the expected private contract';
    END IF;
  END LOOP;
  IF pg_catalog.has_schema_privilege(reader_oid, 'public', 'CREATE')
     OR pg_catalog.pg_has_role('anon', reader_oid, 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', reader_oid, 'MEMBER')
     OR pg_catalog.pg_has_role('service_role', reader_oid, 'MEMBER')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class
       WHERE oid IN ('public.bands'::regclass, 'public.social_links'::regclass) AND relowner = reader_oid) THEN
    RAISE EXCEPTION 'Unexpected privileges of the public view reader';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
      LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE c.oid = view_oid AND a.grantee <> c.relowner
      AND (a.grantee NOT IN ('anon'::regrole::oid, 'authenticated'::regrole::oid)
        OR a.privilege_type <> 'SELECT' OR a.is_grantable))
     OR NOT pg_catalog.has_table_privilege('anon', view_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated', view_oid, 'SELECT')
     OR (SELECT count(*) FROM pg_catalog.pg_rewrite WHERE ev_class = view_oid) <> 1
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = view_oid AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Unexpected public view ACLs, rules or triggers';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid = 'public.social_links'::regclass) <> 6 THEN
    RAISE EXCEPTION 'Unexpected social link policies';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('social_links_select_for_band_members', 'r', 'authenticated', 'private.is_band_member(band_id)', NULL),
    ('social_links_insert_for_admins', 'a', 'authenticated', NULL, 'private.is_band_admin(band_id)'),
    ('social_links_update_for_admins', 'w', 'authenticated', 'private.is_band_member(band_id) AND private.is_band_admin(band_id)', 'private.is_band_member(band_id) AND private.is_band_admin(band_id)'),
    ('social_links_delete_for_admins', 'd', 'authenticated', 'private.is_band_member(band_id) AND private.is_band_admin(band_id)', NULL),
    ('social_links_select_for_public_reader', 'r', 'bandup_public_reader', 'is_public IS TRUE AND EXISTS (SELECT 1 FROM public.bands band WHERE band.id = social_links.band_id AND band.is_public IS TRUE)', NULL),
    ('social_links_select_for_profile_reader', 'r', 'bandup_profile_reader', 'is_public IS TRUE AND EXISTS (SELECT 1 FROM public.bands band WHERE band.id = social_links.band_id AND band.is_public IS TRUE)', NULL)
  ) AS policies(name, command, role_name, using_expression, check_expression) LOOP
    SELECT p.polcmd::text AS command, p.polroles, p.polpermissive,
      pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
      pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
      INTO actual FROM pg_catalog.pg_policy p
      WHERE p.polrelid = 'public.social_links'::regclass AND p.polname = expected.name;
    IF NOT FOUND THEN RAISE EXCEPTION 'Required link policy missing'; END IF;
    normalized_qual := pg_catalog.regexp_replace(pg_catalog.lower(actual.using_expression), '[[:space:]()]', '', 'g');
    normalized_check := pg_catalog.regexp_replace(pg_catalog.lower(actual.check_expression), '[[:space:]()]', '', 'g');
    IF actual.command <> expected.command OR NOT actual.polpermissive
       OR actual.polroles <> ARRAY[expected.role_name::regrole::oid]
       OR normalized_qual IS DISTINCT FROM pg_catalog.regexp_replace(pg_catalog.lower(expected.using_expression), '[[:space:]()]', '', 'g')
       OR normalized_check IS DISTINCT FROM pg_catalog.regexp_replace(pg_catalog.lower(expected.check_expression), '[[:space:]()]', '', 'g') THEN
      RAISE EXCEPTION 'Link policy structure differs from the reviewed contract';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'public.bands'::regclass AND p.polname = 'bands_select_for_profile_reader'
      AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = ARRAY[reader_oid]
      AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(p.polqual, p.polrelid)), '[[:space:]()]', '', 'g') = 'is_publicistrue') THEN
    RAISE EXCEPTION 'Unexpected band policy for the public reader';
  END IF;
END;
$preflight$;

DO $legacy_reader$
DECLARE r oid;
BEGIN
  SELECT oid INTO r FROM pg_catalog.pg_roles WHERE rolname='bandup_public_reader'
    AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication;
  IF r IS NULL OR pg_catalog.has_schema_privilege(r,'public','CREATE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r)
     OR pg_catalog.pg_has_role('anon',r,'MEMBER')
     OR pg_catalog.pg_has_role('authenticated',r,'MEMBER')
     OR pg_catalog.pg_has_role('service_role',r,'MEMBER')
     OR (SELECT count(*) FROM pg_catalog.pg_class
       WHERE oid IN ('public.public_bands'::regclass,'public.public_events'::regclass,
         'public.public_social_links'::regclass) AND relkind='v' AND relowner=r
         AND reloptions @> ARRAY['security_barrier=true','security_invoker=false']::text[]
         AND pg_catalog.cardinality(reloptions)=2)<>3 THEN
    RAISE EXCEPTION 'Legacy reader/view ownership contract changed';
  END IF;
END;
$legacy_reader$;

CREATE TEMP VIEW bandup_url_expected_legacy_bands AS
SELECT id,name,slug,description,logo_url FROM public.bands WHERE is_public IS TRUE;
CREATE TEMP VIEW bandup_url_expected_legacy_events AS
SELECT band_id,title,event_type,start_at,end_at,location FROM public.events
WHERE start_at>=pg_catalog.now() AND EXISTS (SELECT 1 FROM public.bands band
  WHERE band.id=events.band_id AND band.is_public IS TRUE);
DO $unchanged_public_contract$
BEGIN
  IF pg_catalog.pg_get_viewdef('public.public_bands'::regclass,false)
       IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_url_expected_legacy_bands'::regclass,false)
     OR pg_catalog.pg_get_viewdef('public.public_events'::regclass,false)
       IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_url_expected_legacy_events'::regclass,false)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('v','m') AND c.relname NOT IN
         ('public_bands','public_events','public_social_links','public_band_profiles'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND (pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
         OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'Unreviewed or changed legacy public endpoint';
  END IF;
END;
$unchanged_public_contract$;
DROP VIEW pg_temp.bandup_url_expected_legacy_bands;
DROP VIEW pg_temp.bandup_url_expected_legacy_events;

-- Generate a canonical expected definition on this server, not a guessed catalog string.
CREATE TEMP VIEW bandup_url_expected_view AS
SELECT band.name, band.slug, band.description, band.logo_url,
  COALESCE((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('platform', link.platform, 'url', link.url)
      ORDER BY link.created_at, link.id
    )
    FROM public.social_links AS link
    WHERE link.band_id = band.id AND link.is_public IS TRUE
  ), '[]'::jsonb) AS links
FROM public.bands AS band
WHERE band.is_public IS TRUE;
DO $view_contract$
BEGIN
  IF pg_catalog.pg_get_viewdef('public.public_band_profiles'::regclass, false)
     IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_url_expected_view'::regclass, false) THEN
    RAISE EXCEPTION 'Existing public view definition differs from the historical contract';
  END IF;
END;
$view_contract$;
DROP VIEW pg_temp.bandup_url_expected_view;

CREATE TEMP VIEW bandup_url_expected_legacy_links AS
SELECT band_id,platform,url FROM public.social_links
WHERE is_public IS TRUE AND EXISTS (SELECT 1 FROM public.bands band
  WHERE band.id=social_links.band_id AND band.is_public IS TRUE);
DO $legacy_view_contract$
BEGIN
  IF pg_catalog.pg_get_viewdef('public.public_social_links'::regclass,false)
     IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_url_expected_legacy_links'::regclass,false) THEN
    RAISE EXCEPTION 'Legacy link projection contract differs';
  END IF;
END;
$legacy_view_contract$;
DROP VIEW pg_temp.bandup_url_expected_legacy_links;
CREATE TEMP TABLE bandup_url_legacy_before ON COMMIT DROP AS
SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relacl,c.reloptions,
  (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attacl) ORDER BY a.attnum)
   FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  CASE WHEN c.relname<>'public_social_links' THEN pg_catalog.pg_get_viewdef(c.oid,false) END) ORDER BY c.oid) AS contract
FROM pg_catalog.pg_class c WHERE c.oid IN ('public.public_bands'::regclass,
  'public.public_events'::regclass,'public.public_social_links'::regclass);

-- Snapshot existing source ACLs/RLS/policies/guards and the view identity/column ACLs.
CREATE TEMP TABLE bandup_url_contract_before ON COMMIT DROP AS
SELECT
  (SELECT pg_catalog.jsonb_build_object('oid', c.oid, 'owner', c.relowner, 'acl', c.relacl,
    'options', c.reloptions, 'columns', (SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod, a.attacl) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
    FROM pg_catalog.pg_class c WHERE c.oid = 'public.public_band_profiles'::regclass) AS view_contract,
  (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid, c.relowner, c.relacl,
    c.relrowsecurity, c.relforcerowsecurity,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum, a.attacl) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.polname, p.polcmd, p.polroles,
      p.polpermissive, p.polqual::text, p.polwithcheck::text) ORDER BY p.polname)
      FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid, false) ORDER BY t.tgname)
      FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
        AND t.tgname <> 'social_links_zz_guard_external_url')) ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid IN ('public.bands'::regclass, 'public.social_links'::regclass,
      'public.band_members'::regclass, 'public.tasks'::regclass, 'public.events'::regclass)) AS source_contract;

CREATE FUNCTION private.is_safe_external_url_v1(input_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL UNSAFE
SECURITY INVOKER
CALLED ON NULL INPUT
SET search_path = ''
AS $url_validator$
DECLARE
  value text;
  authority text;
  host text;
  port text;
  labels text[];
  label text;
  last_label text;
  address pg_catalog.inet;
BEGIN
  -- Deterministic ASCII-host contract v1; see the companion documentation.
  -- Reject controls BEFORE trimming. PostgreSQL text cannot contain NUL.
  IF input_value IS NULL OR pg_catalog.octet_length(input_value) > 8192
     OR input_value COLLATE "C" ~ '[[:cntrl:]]' THEN
    RETURN false;
  END IF;
  value := pg_catalog.btrim(input_value, ' ');
  IF value COLLATE "C" !~ '^[Hh][Tt][Tt][Pp][Ss]?://'
     OR pg_catalog.strpos(value, pg_catalog.chr(92)) > 0 THEN
    RETURN false;
  END IF;
  authority := pg_catalog.substring(value, '^[Hh][Tt][Tt][Pp][Ss]?://([^/?#]+)');
  -- @ is forbidden only in authority; paths/query/fragments may contain it.
  IF authority IS NULL OR pg_catalog.strpos(authority, '@') > 0 THEN
    RETURN false;
  END IF;
  IF pg_catalog.left(authority, 1) = '[' THEN
    IF authority COLLATE "C" !~ '^\[[0-9A-Fa-f:.]+\](:[0-9]+)?$' THEN RETURN false; END IF;
    host := pg_catalog.substring(authority, '^\[([0-9A-Fa-f:.]+)\]');
    port := pg_catalog.substring(authority, '\]:([0-9]+)$');
    address := host::pg_catalog.inet;
    IF pg_catalog.family(address) <> 6 THEN RETURN false; END IF;
  ELSE
    IF authority COLLATE "C" !~ '^[A-Za-z0-9.-]+(:[0-9]+)?$' THEN RETURN false; END IF;
    host := pg_catalog.split_part(authority, ':', 1);
    IF pg_catalog.strpos(authority, ':') > 0 THEN port := pg_catalog.split_part(authority, ':', 2); END IF;
    IF pg_catalog.right(host, 1) = '.' THEN host := pg_catalog.left(host, pg_catalog.length(host) - 1); END IF;
    IF host = '' OR pg_catalog.octet_length(host) > 253 THEN RETURN false; END IF;
    labels := pg_catalog.regexp_split_to_array(host, '\.');
    last_label := labels[pg_catalog.array_length(labels, 1)];
    -- WHATWG treats a numeric final label as an IPv4 candidate, not DNS.
    IF last_label COLLATE "C" ~ '^[0-9]+$' OR last_label COLLATE "C" ~ '^0[xX][0-9A-Fa-f]*$' THEN
      IF pg_catalog.array_length(labels, 1) <> 4 THEN RETURN false; END IF;
      FOREACH label IN ARRAY labels LOOP
        IF label COLLATE "C" !~ '^(0|[1-9][0-9]{0,2})$' THEN RETURN false; END IF;
        IF label::integer > 255 THEN RETURN false; END IF;
      END LOOP;
    ELSE
      FOREACH label IN ARRAY labels LOOP
        IF label COLLATE "C" !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
           OR label COLLATE "C" ~ '^[Xx][Nn]--' THEN RETURN false; END IF;
      END LOOP;
    END IF;
  END IF;
  IF port IS NOT NULL THEN
    IF pg_catalog.length(port) > 5 OR port::integer > 65535 THEN RETURN false; END IF;
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$url_validator$;

REVOKE ALL ON FUNCTION private.is_safe_external_url_v1(text)
FROM PUBLIC, anon, authenticated, service_role, bandup_public_reader, bandup_profile_reader;
-- Functions in views require EXECUTE for invoking roles even in owner-context views.
-- No new schema USAGE, table privileges, role membership or RLS policy is granted.
GRANT EXECUTE ON FUNCTION private.is_safe_external_url_v1(text)
TO anon, authenticated, service_role, bandup_public_reader, bandup_profile_reader;

CREATE FUNCTION private.guard_external_link_url_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $url_guard$
DECLARE must_validate boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    must_validate := true;
  ELSE
    must_validate := NEW.url IS DISTINCT FROM OLD.url OR NEW.is_public IS TRUE;
  END IF;
  IF must_validate AND private.is_safe_external_url_v1(NEW.url) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Link URL must be a supported HTTP/HTTPS URL without credentials or controls',
      CONSTRAINT = 'social_links_external_url_safe';
  END IF;
  RETURN NEW;
END;
$url_guard$;
REVOKE ALL ON FUNCTION private.guard_external_link_url_v1()
FROM PUBLIC, anon, authenticated, service_role, bandup_public_reader, bandup_profile_reader;

-- Run after the existing publication/ownership guard; inspect every UPDATE.
CREATE TRIGGER social_links_zz_guard_external_url
BEFORE INSERT OR UPDATE ON public.social_links
FOR EACH ROW EXECUTE FUNCTION private.guard_external_link_url_v1();

CREATE OR REPLACE VIEW public.public_band_profiles
WITH (security_barrier = true, security_invoker = false)
AS
SELECT band.name, band.slug, band.description, band.logo_url,
  COALESCE((
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('platform', link.platform, 'url', link.url)
      ORDER BY link.created_at, link.id
    )
    FROM public.social_links AS link
    WHERE link.band_id = band.id AND link.is_public IS TRUE
      AND private.is_safe_external_url_v1(link.url) IS TRUE
  ), '[]'::jsonb) AS links
FROM public.bands AS band
WHERE band.is_public IS TRUE;

CREATE OR REPLACE VIEW public.public_social_links
WITH (security_barrier=true,security_invoker=false) AS
SELECT band_id,platform,url FROM public.social_links
WHERE is_public IS TRUE AND private.is_safe_external_url_v1(url) IS TRUE
  AND EXISTS (SELECT 1 FROM public.bands band
    WHERE band.id=social_links.band_id AND band.is_public IS TRUE);
CREATE TEMP VIEW bandup_url_expected_legacy_safe AS
SELECT band_id,platform,url FROM public.social_links
WHERE is_public IS TRUE AND private.is_safe_external_url_v1(url) IS TRUE
  AND EXISTS (SELECT 1 FROM public.bands band
    WHERE band.id=social_links.band_id AND band.is_public IS TRUE);
CREATE TEMP TABLE bandup_url_legacy_after ON COMMIT DROP AS
SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relacl,c.reloptions,
  (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attacl) ORDER BY a.attnum)
   FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  CASE WHEN c.relname<>'public_social_links' THEN pg_catalog.pg_get_viewdef(c.oid,false) END) ORDER BY c.oid) AS contract
FROM pg_catalog.pg_class c WHERE c.oid IN ('public.public_bands'::regclass,
  'public.public_events'::regclass,'public.public_social_links'::regclass);
DO $legacy_postconditions$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.bandup_url_legacy_before b,pg_temp.bandup_url_legacy_after a
      WHERE b.contract=a.contract)
     OR pg_catalog.pg_get_viewdef('public.public_social_links'::regclass,false)
       IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_url_expected_legacy_safe'::regclass,false) THEN
    RAISE EXCEPTION 'Unexpected legacy identity/ACL/column/options or public URL predicate change';
  END IF;
END;
$legacy_postconditions$;
DROP VIEW pg_temp.bandup_url_expected_legacy_safe;

DO $postconditions$
DECLARE after_view jsonb; after_source jsonb;
BEGIN
  SELECT snapshot.view_contract, snapshot.source_contract INTO after_view, after_source
  FROM (
SELECT
  (SELECT pg_catalog.jsonb_build_object('oid', c.oid, 'owner', c.relowner, 'acl', c.relacl,
    'options', c.reloptions, 'columns', (SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod, a.attacl) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
    FROM pg_catalog.pg_class c WHERE c.oid = 'public.public_band_profiles'::regclass) AS view_contract,
  (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid, c.relowner, c.relacl,
    c.relrowsecurity, c.relforcerowsecurity,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum, a.attacl) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.polname, p.polcmd, p.polroles,
      p.polpermissive, p.polqual::text, p.polwithcheck::text) ORDER BY p.polname)
      FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid, false) ORDER BY t.tgname)
      FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
        AND t.tgname <> 'social_links_zz_guard_external_url')) ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid IN ('public.bands'::regclass, 'public.social_links'::regclass,
      'public.band_members'::regclass, 'public.tasks'::regclass, 'public.events'::regclass)) AS source_contract
  ) AS snapshot;
  IF NOT EXISTS (SELECT 1 FROM pg_temp.bandup_url_contract_before
      WHERE view_contract = after_view AND source_contract = after_source) THEN
    RAISE EXCEPTION 'View identity/columns/ACLs or source policies/ACLs/guards changed unexpectedly';
  END IF;
  IF NOT pg_catalog.has_function_privilege('anon', 'private.is_safe_external_url_v1(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'private.is_safe_external_url_v1(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('bandup_profile_reader', 'private.is_safe_external_url_v1(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('bandup_public_reader', 'private.is_safe_external_url_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Public view validator execution privileges are incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid = 'private.is_safe_external_url_v1(text)'::regprocedure AND a.grantee <> p.proowner
      AND (a.grantee NOT IN ('anon'::regrole::oid, 'authenticated'::regrole::oid, 'service_role'::regrole::oid, 'bandup_public_reader'::regrole::oid, 'bandup_profile_reader'::regrole::oid)
        OR a.privilege_type <> 'EXECUTE' OR a.is_grantable)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid = 'private.guard_external_link_url_v1()'::regprocedure AND a.grantee <> p.proowner
  ) THEN RAISE EXCEPTION 'Unexpected default grants on new URL functions'; END IF;
END;
$postconditions$;
COMMIT;
