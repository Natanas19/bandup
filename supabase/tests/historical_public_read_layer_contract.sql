-- INCLUDE ONLY after the historical identity gate, inside caller transaction.
-- Checker of the archived contract in a DECLARED synthetic environment.
-- CREATE/membership are historical facts here, not security approval for release.
-- Recheck identity even when invoked directly; no caller-supplied verified flag.
\set ON_ERROR_STOP on
\ir historical_lab_identity_check.sql
CREATE FUNCTION pg_temp.historical_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $assert$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Historical contract: '||label;
  END IF;
END;
$assert$;

CREATE FUNCTION pg_temp.historical_schema_acl(role_name text, schema_name text, privileges text[]) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $schema_acl$
BEGIN
  -- Catalog entries prove direct grants; has_schema_privilege below proves
  -- effective access separately. PUBLIC/inheritance cannot replace these rows.
  PERFORM pg_temp.historical_assert(
    (SELECT COALESCE(array_agg(a.privilege_type ORDER BY a.privilege_type),'{}'::text[])
      FROM pg_catalog.pg_namespace n, LATERAL pg_catalog.aclexplode(n.nspacl) a
      WHERE n.nspname=schema_name AND a.grantee=role_name::regrole::oid)=privileges
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,
      LATERAL pg_catalog.aclexplode(n.nspacl) a WHERE n.nspname=schema_name
        AND a.grantee=role_name::regrole::oid AND a.is_grantable),
    'direct schema ACL '||role_name||'/'||schema_name);
END;
$schema_acl$;

CREATE FUNCTION pg_temp.historical_check() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $contract$
DECLARE reader oid := 'bandup_public_reader'::regrole::oid;
  item record; source oid; view_oid oid; role_name text; actual text; wanted boolean;
BEGIN
  -- Controlled PG17 profile, not a claim about the historical executor.
  PERFORM pg_temp.historical_assert(SESSION_USER=CURRENT_USER
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE oid=CURRENT_USER::regrole::oid
      AND rolsuper AND rolinherit), 'executor profile');
  PERFORM pg_temp.historical_assert(EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE oid=reader AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication), 'reader flags');
  PERFORM pg_temp.historical_assert(
    (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid=reader)=1
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=reader
      AND member=CURRENT_USER::regrole::oid AND grantor=10
      AND NOT admin_option AND inherit_option AND set_option)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=reader), 'reader membership');
  PERFORM pg_temp.historical_assert(
    pg_catalog.has_schema_privilege(reader,'public','USAGE')
    AND pg_catalog.has_schema_privilege(reader,'public','CREATE')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,
      LATERAL pg_catalog.aclexplode(n.nspacl) a WHERE n.nspname='public'
        AND a.grantee=reader AND (a.is_grantable OR a.privilege_type NOT IN ('CREATE','USAGE'))), 'persistent CREATE');
  FOR item IN SELECT * FROM (VALUES
    ('bandup_public_reader','public',ARRAY['CREATE','USAGE']::text[]),
    ('bandup_public_reader','auth','{}'::text[]),
    ('bandup_public_reader','private','{}'::text[]),
    ('anon','public',ARRAY['USAGE']::text[]),
    ('anon','auth',ARRAY['USAGE']::text[]),
    ('anon','private','{}'::text[]),
    ('authenticated','public',ARRAY['USAGE']::text[]),
    ('authenticated','auth',ARRAY['USAGE']::text[]),
    ('authenticated','private',ARRAY['USAGE']::text[]),
    ('service_role','public',ARRAY['USAGE']::text[]),
    ('service_role','auth',ARRAY['USAGE']::text[]),
    ('service_role','private','{}'::text[])
  ) AS s(role_name,schema_name,privileges) LOOP
    PERFORM pg_temp.historical_schema_acl(item.role_name,item.schema_name,item.privileges);
    PERFORM pg_temp.historical_assert(
      pg_catalog.has_schema_privilege(item.role_name,item.schema_name,'USAGE')
        IS NOT DISTINCT FROM ('USAGE'=ANY(item.privileges)),
      'effective schema USAGE '||item.role_name||'/'||item.schema_name);
  END LOOP;
  PERFORM pg_temp.historical_assert(pg_catalog.to_regclass('public.public_band_profiles') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='bandup_profile_reader')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.social_links'::regclass
      AND attname='is_public' AND NOT attisdropped), 'later objects');
  PERFORM pg_temp.historical_assert(EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.bands'::regclass AND a.attname='is_public'
      AND a.atttypid='boolean'::regtype AND a.attnotnull AND NOT a.attisdropped
      AND a.attgenerated='' AND pg_catalog.pg_get_expr(d.adbin,d.adrelid)='false'), 'band flag');
  FOR source IN SELECT unnest(ARRAY['public.bands'::regclass::oid,'public.events'::regclass::oid,
      'public.social_links'::regclass::oid,'public.tasks'::regclass::oid,'public.band_members'::regclass::oid]) LOOP
    PERFORM pg_temp.historical_assert((SELECT relkind='r' AND relrowsecurity AND relowner<>reader
      FROM pg_catalog.pg_class WHERE oid=source), 'source RLS/owner');
    PERFORM pg_temp.historical_assert(NOT pg_catalog.has_table_privilege(reader,source,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT pg_catalog.has_any_column_privilege(reader,source,'INSERT,UPDATE,REFERENCES'), 'reader table/write grants');
    FOR item IN SELECT a.attname,c.relname FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      WHERE a.attrelid=source AND a.attnum>0 AND NOT a.attisdropped LOOP
      wanted := (item.relname='bands' AND item.attname=ANY(ARRAY['id','name','slug','description','logo_url','is_public']))
        OR (item.relname='events' AND item.attname=ANY(ARRAY['band_id','title','event_type','start_at','end_at','location']))
        OR (item.relname='social_links' AND item.attname=ANY(ARRAY['band_id','platform','url']));
      PERFORM pg_temp.historical_assert(pg_catalog.has_column_privilege(reader,source,item.attname,'SELECT')
        IS NOT DISTINCT FROM wanted, 'reader column grants');
    END LOOP;
    PERFORM pg_temp.historical_assert(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a,
      LATERAL pg_catalog.aclexplode(a.attacl) acl WHERE a.attrelid=source AND acl.grantee=reader
        AND (acl.privilege_type<>'SELECT' OR acl.is_grantable)), 'reader column ACL');
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      PERFORM pg_temp.historical_assert(EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit
        AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=role_name::regrole::oid)
        AND NOT pg_catalog.has_schema_privilege(role_name,'public','CREATE')
        AND NOT pg_catalog.pg_has_role(role_name,(SELECT relowner FROM pg_catalog.pg_class WHERE oid=source),'MEMBER'),
        'application powers');
    END LOOP;
    PERFORM pg_temp.historical_assert(NOT pg_catalog.has_table_privilege('anon',source,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT pg_catalog.has_any_column_privilege('anon',source,'SELECT,INSERT,UPDATE,REFERENCES'), 'anonymous source access');
  END LOOP;
  PERFORM pg_temp.historical_assert((SELECT count(*) FROM pg_catalog.pg_policy WHERE reader=ANY(polroles))=3,
    'policy inventory');
  PERFORM pg_temp.historical_assert(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid IN ('public.bands'::regclass,'public.events'::regclass,'public.social_links'::regclass,
      'public.tasks'::regclass,'public.band_members'::regclass) AND 0=ANY(polroles)), 'PUBLIC policy');
  FOR item IN SELECT * FROM (VALUES
    ('bands','bands_select_for_public_reader','is_publicistrue'),
    ('events','events_select_for_public_reader','start_at>=nowandexistsselect1frompublic.bandsbandwhereband.id=events.band_idandband.is_publicistrue'),
    ('social_links','social_links_select_for_public_reader','existsselect1frompublic.bandsbandwhereband.id=social_links.band_idandband.is_publicistrue')
  ) AS p(table_name,policy_name,qual) LOOP
    SELECT pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(polqual,polrelid)),
      '[[:space:]()]','','g') INTO actual FROM pg_catalog.pg_policy
      WHERE polrelid=pg_catalog.to_regclass('public.'||item.table_name) AND polname=item.policy_name
        AND polcmd='r' AND polpermissive AND polroles=ARRAY[reader] AND polwithcheck IS NULL;
    PERFORM pg_temp.historical_assert(actual IS NOT DISTINCT FROM item.qual, 'policy '||item.table_name);
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('public_bands','historical_expected_bands',ARRAY['id','name','slug','description','logo_url']::text[]),
    ('public_events','historical_expected_events',ARRAY['band_id','title','event_type','start_at','end_at','location']::text[]),
    ('public_social_links','historical_expected_links',ARRAY['band_id','platform','url']::text[])
  ) AS v(view_name,expected_name,columns) LOOP
    view_oid := pg_catalog.to_regclass('public.'||item.view_name);
    PERFORM pg_temp.historical_assert(EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=view_oid
      AND relkind='v' AND relowner=reader
      AND reloptions @> ARRAY['security_barrier=true','security_invoker=false'] AND cardinality(reloptions)=2)
      AND (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_catalog.pg_attribute
        WHERE attrelid=view_oid AND attnum>0 AND NOT attisdropped)=item.columns
      AND pg_catalog.pg_get_viewdef(view_oid,false)=pg_catalog.pg_get_viewdef(
        pg_catalog.to_regclass('pg_temp.'||item.expected_name),false), 'view definition '||item.view_name);
    PERFORM pg_temp.historical_assert(pg_catalog.has_table_privilege('anon',view_oid,'SELECT')
      AND NOT pg_catalog.has_table_privilege('authenticated',view_oid,'SELECT')
      AND NOT pg_catalog.has_table_privilege('service_role',view_oid,'SELECT')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
        LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
        WHERE c.oid=view_oid AND acl.grantee<>reader
          AND (acl.grantee<>'anon'::regrole::oid OR acl.privilege_type<>'SELECT' OR acl.is_grantable))
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a,
        LATERAL pg_catalog.aclexplode(a.attacl) acl WHERE a.attrelid=view_oid), 'view ACL '||item.view_name);
  END LOOP;
END;
$contract$;
-- Expected view bodies are generated byte-for-byte from archived statements.
CREATE TEMP VIEW historical_expected_bands
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, name, slug, description, logo_url
FROM public.bands
WHERE is_public IS TRUE;

CREATE TEMP VIEW historical_expected_links
WITH (security_barrier = true, security_invoker = false)
AS
SELECT band_id, platform, url
FROM public.social_links
WHERE EXISTS (
  SELECT 1
  FROM public.bands AS band
  WHERE band.id = social_links.band_id
    AND band.is_public IS TRUE
);

CREATE TEMP VIEW historical_expected_events
WITH (security_barrier = true, security_invoker = false)
AS
SELECT band_id, title, event_type, start_at, end_at, location
FROM public.events
WHERE start_at >= now()
  AND EXISTS (
  SELECT 1
  FROM public.bands AS band
  WHERE band.id = events.band_id
    AND band.is_public IS TRUE
  );
