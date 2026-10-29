-- PREPARED ONLY; NOT EXECUTED. Legacy branch, NOT an automatic db-push chain.
-- Requires reviewed legacy layer plus exact M6 and M8 ownership implementations.
-- Replaces neither the missing historical artifact nor its migration ledger entry.
-- See docs/publication-compatibility.md BEFORE selecting any migration files.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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

DO $preflight$
DECLARE expected record; relation_oid oid; reader_oid oid;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 150000
     OR pg_catalog.to_regnamespace('private') IS NULL
     OR pg_catalog.to_regprocedure('private.is_band_admin(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Required PostgreSQL version or authorization helpers missing';
  END IF;
  SELECT oid INTO reader_oid FROM pg_catalog.pg_roles
    WHERE rolname='bandup_public_reader' AND NOT rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb
      AND NOT rolcreaterole AND NOT rolreplication;
  IF reader_oid IS NULL
     OR pg_catalog.has_schema_privilege(reader_oid,'public','CREATE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=reader_oid)
     OR pg_catalog.pg_has_role('anon',reader_oid,'MEMBER')
     OR pg_catalog.pg_has_role('authenticated',reader_oid,'MEMBER')
     OR pg_catalog.pg_has_role('service_role',reader_oid,'MEMBER') THEN
    RAISE EXCEPTION 'Legacy reader privileges differ; do not repair grants implicitly';
  END IF;
  -- A global rule cannot be claimed while an unreviewed public endpoint remains.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('v','m')
        AND c.relname NOT IN ('public_bands','public_events','public_social_links'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND (pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
         OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'Unreviewed public view or callable routine; inventory all public paths first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='bandup_profile_reader')
     OR pg_catalog.to_regclass('public.public_band_profiles') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='private' AND p.proname IN
         ('guard_band_publication','guard_social_link_publication',
          'is_safe_external_url_v1','guard_external_link_url_v1','guard_functional_integrity_v1'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid=pg_catalog.to_regclass('public.social_links')
         AND attname='is_public' AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid IN (pg_catalog.to_regclass('public.bands'),pg_catalog.to_regclass('public.social_links'))
         AND tgname IN ('bands_guard_publication','social_links_guard_publication'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy
       WHERE polrelid IN (pg_catalog.to_regclass('public.bands'),pg_catalog.to_regclass('public.social_links'))
         AND polname IN ('bands_select_for_profile_reader','social_links_select_for_profile_reader')) THEN
    RAISE EXCEPTION 'Compatibility object collision or later migration installed; stop';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=pg_catalog.to_regclass('public.bands') AND a.attname='is_public'
        AND a.atttypid='boolean'::regtype AND a.attnotnull AND NOT a.attisdropped
        AND a.attgenerated='' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid)='false') THEN
    RAISE EXCEPTION 'Existing bands.is_public contract differs; never reset publication';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('events','events_guard_ownership','private.guard_event_ownership()'),
    ('band_members','band_members_guard_band_id','private.guard_band_member_band()')
  ) AS guards(table_name,trigger_name,function_signature) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid=pg_catalog.to_regclass('public.'||expected.table_name)
        AND tgname=expected.trigger_name AND tgtype=19 AND tgenabled='O'
        AND NOT tgisinternal AND tgfoid=pg_catalog.to_regprocedure(expected.function_signature)) THEN
      RAISE EXCEPTION 'Ownership guards missing, disabled or rebound';
    END IF;
  END LOOP;
  FOREACH relation_oid IN ARRAY ARRAY['public.bands'::regclass::oid,
      'public.band_members'::regclass::oid,'public.events'::regclass::oid,
      'public.tasks'::regclass::oid,'public.social_links'::regclass::oid] LOOP
    IF NOT (SELECT relkind='r' AND relrowsecurity FROM pg_catalog.pg_class WHERE oid=relation_oid)
       OR (SELECT relowner=reader_oid FROM pg_catalog.pg_class WHERE oid=relation_oid)
       OR pg_catalog.has_table_privilege('anon',relation_oid,'SELECT')
       OR pg_catalog.has_any_column_privilege('anon',relation_oid,'SELECT') THEN
      RAISE EXCEPTION 'Unexpected private source relation, ownership or anonymous privileges';
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('bands',ARRAY['id','name','slug','description','logo_url','is_public']::text[]),
    ('events',ARRAY['band_id','title','event_type','start_at','end_at','location']::text[]),
    ('social_links',ARRAY['band_id','platform','url']::text[])
  ) AS source_columns(table_name,columns) LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.unnest(expected.columns) AS col(name)
      WHERE NOT pg_catalog.has_column_privilege(reader_oid,
        pg_catalog.to_regclass('public.'||expected.table_name),col.name,'SELECT')) THEN
      RAISE EXCEPTION 'Legacy view source grants missing; reconstruct reviewed ownership/ACLs first';
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('bands','bands_select_for_public_reader'),
    ('events','events_select_for_public_reader'),
    ('social_links','social_links_select_for_public_reader')
  ) AS policies(table_name,policy_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
      WHERE polrelid=pg_catalog.to_regclass('public.'||expected.table_name)
        AND polname=expected.policy_name AND polcmd='r' AND polpermissive
        AND polroles=ARRAY[reader_oid]) THEN
      RAISE EXCEPTION 'Legacy policy identity/role/command differs';
    END IF;
  END LOOP;
  -- No extra permissive OR path or restrictive PUBLIC path may alter this contract.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
      WHERE p.polrelid IN ('public.bands'::regclass,'public.social_links'::regclass)
        AND p.polcmd IN ('r','*')
        AND (0=ANY(p.polroles) OR reader_oid=ANY(p.polroles))
        AND p.polname NOT IN ('bands_select_for_public_reader','social_links_select_for_public_reader')) THEN
    RAISE EXCEPTION 'Additional reader policy requires separate review';
  END IF;
  -- Qualified expressions, ignoring only deparser whitespace/parentheses.
  IF (SELECT pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(polqual,polrelid)),
          '[[:space:]()]','','g') FROM pg_catalog.pg_policy
      WHERE polrelid='public.bands'::regclass AND polname='bands_select_for_public_reader')
       IS DISTINCT FROM 'is_publicistrue' THEN
    RAISE EXCEPTION 'Legacy band policy differs from the reviewed publication rule';
  END IF;
  IF COALESCE((SELECT pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(polqual,polrelid)),
          '[[:space:]()]','','g') FROM pg_catalog.pg_policy
      WHERE polrelid='public.social_links'::regclass AND polname='social_links_select_for_public_reader'),'')
       NOT IN (
        'existsselect1frompublic.bandsbandwhereband.id=social_links.band_idandband.is_publicistrue',
        'existsselect1frompublic.bandsbwhereb.id=social_links.band_idandb.is_publicistrue') THEN
    RAISE EXCEPTION 'Legacy link predicate differs; do not discard additional restrictions';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('public_bands',ARRAY['id','name','slug','description','logo_url']::text[]),
    ('public_events',ARRAY['band_id','title','event_type','start_at','end_at','location']::text[]),
    ('public_social_links',ARRAY['band_id','platform','url']::text[])
  ) AS views(view_name,columns) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid=pg_catalog.to_regclass('public.'||expected.view_name)
        AND relkind='v' AND relowner=reader_oid
        AND reloptions @> ARRAY['security_barrier=true','security_invoker=false']::text[]
        AND pg_catalog.cardinality(reloptions)=2)
       OR (SELECT pg_catalog.array_agg(attname::text ORDER BY attnum)
         FROM pg_catalog.pg_attribute
         WHERE attrelid=pg_catalog.to_regclass('public.'||expected.view_name)
           AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM expected.columns THEN
      RAISE EXCEPTION 'Legacy view contract differs; restored --no-owner is insufficient';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_rewrite
          WHERE ev_class=pg_catalog.to_regclass('public.'||expected.view_name))<>1
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
          WHERE tgrelid=pg_catalog.to_regclass('public.'||expected.view_name) AND NOT tgisinternal)
       OR NOT pg_catalog.has_table_privilege('anon',pg_catalog.to_regclass('public.'||expected.view_name),'SELECT')
       OR NOT pg_catalog.has_table_privilege('authenticated',pg_catalog.to_regclass('public.'||expected.view_name),'SELECT')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
          LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
          WHERE c.oid=pg_catalog.to_regclass('public.'||expected.view_name) AND a.grantee<>c.relowner
            AND (a.grantee NOT IN ('anon'::regrole,'authenticated'::regrole)
              OR a.privilege_type<>'SELECT' OR a.is_grantable)) THEN
      RAISE EXCEPTION 'Legacy view rules/triggers/ACLs require independent review';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid='public.social_links'::regclass AND NOT tgisinternal)
     OR (SELECT count(*) FROM pg_catalog.pg_trigger WHERE NOT tgisinternal
       AND tgrelid IN ('public.bands'::regclass,'public.band_members'::regclass,
         'public.events'::regclass,'public.tasks'::regclass,'public.social_links'::regclass))<>8 THEN
    RAISE EXCEPTION 'Unexpected source triggers; inspect ordering';
  END IF;
END;
$preflight$;

-- Same-server canonical definitions: a modified legacy view must be reviewed,
-- never silently replaced merely because its name/columns match.
CREATE TEMP VIEW bandup_compat_expected_bands AS
SELECT id,name,slug,description,logo_url FROM public.bands WHERE is_public IS TRUE;
CREATE TEMP VIEW bandup_compat_expected_events AS
SELECT band_id,title,event_type,start_at,end_at,location FROM public.events
WHERE start_at>=pg_catalog.now() AND EXISTS (SELECT 1 FROM public.bands band
  WHERE band.id=events.band_id AND band.is_public IS TRUE);
CREATE TEMP VIEW bandup_compat_expected_links AS
SELECT band_id,platform,url FROM public.social_links
WHERE EXISTS (SELECT 1 FROM public.bands band
  WHERE band.id=social_links.band_id AND band.is_public IS TRUE);
DO $definitions$
BEGIN
  IF pg_catalog.pg_get_viewdef('public.public_bands'::regclass,false)
       IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_compat_expected_bands'::regclass,false)
     OR pg_catalog.pg_get_viewdef('public.public_events'::regclass,false)
       IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_compat_expected_events'::regclass,false)
     OR pg_catalog.pg_get_viewdef('public.public_social_links'::regclass,false)
       IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_compat_expected_links'::regclass,false) THEN
    RAISE EXCEPTION 'Legacy definitions differ from the reviewed contract';
  END IF;
END;
$definitions$;

CREATE TEMP TABLE bandup_compat_before ON COMMIT DROP AS
SELECT pg_catalog.jsonb_build_object(
  'sources',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relacl,
    c.relrowsecurity,c.relforcerowsecurity,c.reloptions,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable)
         ORDER BY acl.grantor,acl.grantee,acl.privilege_type)
       FROM pg_catalog.aclexplode(a.attacl) acl
       WHERE acl.grantee<>c.relowner
         AND acl.grantee IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='bandup_profile_reader'))) ORDER BY a.attnum)
     FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
       AND NOT (c.relname='social_links' AND a.attname='is_public')),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.polname,p.polcmd,p.polroles,p.polpermissive,p.polqual::text,p.polwithcheck::text) ORDER BY p.polname)
     FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid AND p.polname NOT IN
       ('social_links_select_for_public_reader','bands_select_for_profile_reader','social_links_select_for_profile_reader')),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid,false) ORDER BY t.tgname)
     FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal
       AND t.tgname NOT IN ('bands_guard_publication','social_links_guard_publication')),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid,false) ORDER BY k.oid)
     FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid)) ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid IN ('public.bands'::regclass,'public.band_members'::regclass,
      'public.events'::regclass,'public.tasks'::regclass,'public.social_links'::regclass)),
  'legacy_views',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relacl,c.reloptions,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attacl) ORDER BY a.attnum)
     FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    CASE WHEN c.relname<>'public_social_links' THEN pg_catalog.pg_get_viewdef(c.oid,false) END) ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid IN ('public.public_bands'::regclass,
      'public.public_events'::regclass,'public.public_social_links'::regclass)),
  'functions',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.oid,p.proowner,p.proacl,pg_catalog.pg_get_functiondef(p.oid)) ORDER BY p.oid)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.prokind='f'
      AND p.proname NOT IN ('guard_band_publication','guard_social_link_publication')),
  'legacy_memberships',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.roleid,m.member)
    FROM pg_catalog.pg_auth_members m WHERE m.roleid='bandup_public_reader'::regrole OR m.member='bandup_public_reader'::regrole)
) AS contract;

-- Preserve all existing bands.is_public values. Old links start PRIVATE everywhere.
ALTER TABLE public.social_links ADD COLUMN is_public boolean NOT NULL DEFAULT false;

CREATE FUNCTION private.guard_band_publication()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The creator becomes an admin only in the existing AFTER INSERT trigger.
    -- Publish explicitly in a later UPDATE, never through the initial INSERT.
    IF NEW.is_public IS TRUE THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'New bands must start unpublished',
        CONSTRAINT = 'bands_start_unpublished';
    END IF;
  ELSIF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
    IF (SELECT auth.uid()) IS NULL
       OR NOT private.is_band_admin(OLD.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Only a band admin may change publication',
        CONSTRAINT = 'bands_publication_admin_only';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_band_publication()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER bands_guard_publication
BEFORE INSERT OR UPDATE ON public.bands
FOR EACH ROW EXECUTE FUNCTION private.guard_band_publication();

CREATE FUNCTION private.guard_social_link_publication()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  publication_band uuid;
  must_authorize boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    publication_band := NEW.band_id;
    must_authorize := NEW.is_public IS TRUE;
  ELSE
    -- An already-public link must never be moved to a different band.
    -- Recreate a link in the other band; omitted publication defaults to false.
    IF NEW.band_id IS DISTINCT FROM OLD.band_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Link band cannot be changed; remove and recreate the link',
        CONSTRAINT = 'social_links_band_immutable';
    END IF;
    publication_band := OLD.band_id;
    must_authorize := NEW.is_public IS DISTINCT FROM OLD.is_public;
  END IF;

  -- Fail closed between commits: no link may become public before URL safety.
  -- The companion migration creates this function AND its trigger atomically.
  IF NEW.is_public IS TRUE
     AND (pg_catalog.to_regprocedure('private.guard_external_link_url_v1()') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
         WHERE t.tgrelid=TG_RELID AND t.tgname='social_links_zz_guard_external_url'
           AND t.tgfoid=pg_catalog.to_regprocedure('private.guard_external_link_url_v1()')
           AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal
           AND t.tgqual IS NULL AND t.tgattr=''::pg_catalog.int2vector
           AND t.tgnargs=0 AND t.tgargs=''::pg_catalog.bytea)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Link publication requires the legacy URL safety stage',
      CONSTRAINT = 'social_links_url_stage_required';
  END IF;

  IF must_authorize AND (
    (SELECT auth.uid()) IS NULL
    OR NOT private.is_band_admin(publication_band)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Only a band admin may change link publication',
      CONSTRAINT = 'social_links_publication_admin_only';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_social_link_publication()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER social_links_guard_publication
BEFORE INSERT OR UPDATE ON public.social_links
FOR EACH ROW EXECUTE FUNCTION private.guard_social_link_publication();

-- Isolate the new projection from the event-capable historical reader.
CREATE ROLE bandup_profile_reader
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT bandup_profile_reader TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO bandup_profile_reader;
GRANT SELECT (id,name,slug,description,logo_url,is_public) ON public.bands TO bandup_profile_reader;
GRANT SELECT (id,band_id,platform,url,created_at,is_public) ON public.social_links TO bandup_profile_reader;
-- The ONLY legacy grant addition: reading the newly introduced flag in its view.
GRANT SELECT (is_public) ON public.social_links TO bandup_public_reader;

-- Replace the broad legacy predicate IN PLACE: an additional permissive policy
-- would be OR-combined and leave old public interfaces leaking private links.
ALTER POLICY social_links_select_for_public_reader ON public.social_links
USING (is_public IS TRUE AND EXISTS (SELECT 1 FROM public.bands band
  WHERE band.id=social_links.band_id AND band.is_public IS TRUE));
CREATE POLICY bands_select_for_profile_reader ON public.bands
FOR SELECT TO bandup_profile_reader USING (is_public IS TRUE);
CREATE POLICY social_links_select_for_profile_reader ON public.social_links
FOR SELECT TO bandup_profile_reader USING (is_public IS TRUE AND EXISTS (
  SELECT 1 FROM public.bands band WHERE band.id=social_links.band_id AND band.is_public IS TRUE));

-- Same identity, columns, options, owner and ACLs; only visibility is narrowed.
CREATE OR REPLACE VIEW public.public_social_links
WITH (security_barrier=true,security_invoker=false) AS
SELECT band_id,platform,url FROM public.social_links
WHERE is_public IS TRUE AND EXISTS (SELECT 1 FROM public.bands band
  WHERE band.id=social_links.band_id AND band.is_public IS TRUE);

CREATE VIEW public.public_band_profiles
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
  ), '[]'::jsonb) AS links
FROM public.bands AS band
WHERE band.is_public IS TRUE;


REVOKE ALL ON public.public_band_profiles FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.public_band_profiles TO anon,authenticated;
ALTER VIEW public.public_band_profiles OWNER TO bandup_profile_reader;
REVOKE CREATE ON SCHEMA public FROM bandup_profile_reader;
REVOKE bandup_profile_reader FROM CURRENT_USER;

CREATE TEMP VIEW bandup_compat_expected_filtered_links AS
SELECT band_id,platform,url FROM public.social_links
WHERE is_public IS TRUE AND EXISTS (SELECT 1 FROM public.bands band
  WHERE band.id=social_links.band_id AND band.is_public IS TRUE);
CREATE TEMP TABLE bandup_compat_after ON COMMIT DROP AS
SELECT pg_catalog.jsonb_build_object(
  'sources',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relacl,
    c.relrowsecurity,c.relforcerowsecurity,c.reloptions,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,
      (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable)
         ORDER BY acl.grantor,acl.grantee,acl.privilege_type)
       FROM pg_catalog.aclexplode(a.attacl) acl
       WHERE acl.grantee<>c.relowner
         AND acl.grantee IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='bandup_profile_reader'))) ORDER BY a.attnum)
     FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
       AND NOT (c.relname='social_links' AND a.attname='is_public')),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.polname,p.polcmd,p.polroles,p.polpermissive,p.polqual::text,p.polwithcheck::text) ORDER BY p.polname)
     FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid AND p.polname NOT IN
       ('social_links_select_for_public_reader','bands_select_for_profile_reader','social_links_select_for_profile_reader')),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_triggerdef(t.oid,false) ORDER BY t.tgname)
     FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal
       AND t.tgname NOT IN ('bands_guard_publication','social_links_guard_publication')),
    (SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid,false) ORDER BY k.oid)
     FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid)) ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid IN ('public.bands'::regclass,'public.band_members'::regclass,
      'public.events'::regclass,'public.tasks'::regclass,'public.social_links'::regclass)),
  'legacy_views',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(c.oid,c.relowner,c.relacl,c.reloptions,
    (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attacl) ORDER BY a.attnum)
     FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    CASE WHEN c.relname<>'public_social_links' THEN pg_catalog.pg_get_viewdef(c.oid,false) END) ORDER BY c.oid)
    FROM pg_catalog.pg_class c WHERE c.oid IN ('public.public_bands'::regclass,
      'public.public_events'::regclass,'public.public_social_links'::regclass)),
  'functions',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.oid,p.proowner,p.proacl,pg_catalog.pg_get_functiondef(p.oid)) ORDER BY p.oid)
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.prokind='f'
      AND p.proname NOT IN ('guard_band_publication','guard_social_link_publication')),
  'legacy_memberships',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.roleid,m.member)
    FROM pg_catalog.pg_auth_members m WHERE m.roleid='bandup_public_reader'::regrole OR m.member='bandup_public_reader'::regrole)
) AS contract;
DO $postconditions$
DECLARE r oid := 'bandup_profile_reader'::regrole; relation_oid oid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_temp.bandup_compat_before b,pg_temp.bandup_compat_after a
      WHERE b.contract=a.contract) THEN
    RAISE EXCEPTION 'Unapproved change to existing functions/ACLs/RLS/guards/views/memberships';
  END IF;
  IF pg_catalog.pg_get_viewdef('public.public_social_links'::regclass,false)
       IS DISTINCT FROM pg_catalog.pg_get_viewdef('pg_temp.bandup_compat_expected_filtered_links'::regclass,false)
     OR EXISTS (SELECT 1 FROM public.social_links WHERE is_public IS NOT FALSE)
     OR pg_catalog.has_schema_privilege(r,'public','CREATE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r)
     OR pg_catalog.pg_has_role('anon',r,'MEMBER')
     OR pg_catalog.pg_has_role('authenticated',r,'MEMBER')
     OR pg_catalog.pg_has_role('service_role',r,'MEMBER') THEN
    RAISE EXCEPTION 'Publication or isolated-reader postcondition failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
      WHERE polrelid='public.social_links'::regclass
        AND polname='social_links_select_for_public_reader' AND polcmd='r' AND polpermissive
        AND polroles=ARRAY['bandup_public_reader'::regrole::oid]
        AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(polqual,polrelid)),
          '[[:space:]()]','','g')=
          'is_publicistrueandexistsselect1frompublic.bandsbandwhereband.id=social_links.band_idandband.is_publicistrue') THEN
    RAISE EXCEPTION 'Legacy predicate did not become globally private-by-default';
  END IF;
  FOREACH relation_oid IN ARRAY ARRAY['public.tasks'::regclass::oid,
      'public.events'::regclass::oid,'public.band_members'::regclass::oid] LOOP
    IF pg_catalog.has_any_column_privilege(r,relation_oid,'SELECT') THEN
      RAISE EXCEPTION 'Profile reader has unrelated source access';
    END IF;
  END LOOP;
  FOREACH relation_oid IN ARRAY ARRAY['public.bands'::regclass::oid,
      'public.social_links'::regclass::oid,'public.tasks'::regclass::oid,
      'public.events'::regclass::oid,'public.band_members'::regclass::oid] LOOP
    IF pg_catalog.has_table_privilege(r,relation_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_any_column_privilege(r,relation_oid,'INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Profile reader must have no source write privileges';
    END IF;
  END LOOP;
  IF pg_catalog.has_column_privilege(r,'public.bands','created_at','SELECT')
     OR pg_catalog.has_column_privilege(r,'public.bands','updated_at','SELECT') THEN
    RAISE EXCEPTION 'Profile reader received non-projection columns';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid IN ('private.guard_band_publication()'::regprocedure,
      'private.guard_social_link_publication()'::regprocedure) AND a.grantee<>p.proowner)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
      LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid='public.public_band_profiles'::regclass AND a.grantee<>c.relowner
        AND (a.grantee NOT IN ('anon'::regrole,'authenticated'::regrole)
          OR a.privilege_type<>'SELECT' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'Unexpected default grants on newly created objects';
  END IF;
END;
$postconditions$;
DROP VIEW pg_temp.bandup_compat_expected_filtered_links;
DROP VIEW pg_temp.bandup_compat_expected_links;
DROP VIEW pg_temp.bandup_compat_expected_events;
DROP VIEW pg_temp.bandup_compat_expected_bands;
COMMIT;
