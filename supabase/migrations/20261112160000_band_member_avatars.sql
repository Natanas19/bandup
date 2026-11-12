-- LOCAL REVIEW CANDIDATE ONLY. Never apply automatically or run db push.
-- Demo-specific origin, matching the existing immutable avatars upload contract.
-- Inspect the actual destination catalog before any separately authorized application.
-- Only this NEW RPC and its ACL are created. No source grants/policies change.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE expected record; api_role text;
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'Requires reviewed postgres executor with existing RLS bypass'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.proname = 'bandup_member_avatars') THEN
    RAISE EXCEPTION 'RPC name collision; inspect existing definitions';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
    OR pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'Missing Auth identity helpers';
  END IF;
  IF NOT pg_catalog.has_function_privilege(current_user, 'auth.uid()', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(current_user, 'auth.role()', 'EXECUTE')
    OR NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
    OR NOT pg_catalog.has_schema_privilege(current_user, 'auth', 'USAGE')
    OR NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'Required existing schema/helper privileges unavailable';
  END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('public', 'bands', 'id', 'uuid'),
    ('public', 'band_members', 'band_id', 'uuid'),
    ('public', 'band_members', 'user_id', 'uuid'),
    ('public', 'band_members', 'role', 'text'),
    ('auth', 'users', 'id', 'uuid'),
    ('auth', 'users', 'raw_user_meta_data', 'jsonb')
  ) AS required_columns(schema_name, table_name, column_name, type_name) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = expected.schema_name AND c.relname = expected.table_name
        AND c.relkind = 'r' AND a.attname = expected.column_name AND a.attnum > 0 AND NOT a.attisdropped
        AND a.atttypid = pg_catalog.to_regtype(expected.type_name)) THEN
      RAISE EXCEPTION 'Missing/incompatible source column';
    END IF;
    IF NOT pg_catalog.has_column_privilege(current_user,
      pg_catalog.format('%I.%I', expected.schema_name, expected.table_name), expected.column_name, 'SELECT') THEN
      RAISE EXCEPTION 'Executor lacks source read access; no grants repaired';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_attribute b ON b.attrelid = i.indrelid AND b.attname = 'band_id'
    JOIN pg_catalog.pg_attribute u ON u.attrelid = i.indrelid AND u.attname = 'user_id'
    WHERE i.indrelid = 'public.band_members'::regclass AND i.indisunique AND i.indisvalid
      AND i.indnkeyatts = 2 AND i.indpred IS NULL
      AND ((i.indkey[0] = b.attnum AND i.indkey[1] = u.attnum)
        OR (i.indkey[1] = b.attnum AND i.indkey[0] = u.attnum))) THEN
    RAISE EXCEPTION 'Expected unique band/user membership index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attname = 'id'
    WHERE i.indrelid = 'auth.users'::regclass AND i.indisunique AND i.indisvalid
      AND i.indnkeyatts = 1 AND i.indkey[0] = a.attnum AND i.indpred IS NULL) THEN
    RAISE EXCEPTION 'Expected unique Auth user IDs';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN (
    'public.bands'::regclass, 'public.band_members'::regclass
  ) AND relrowsecurity) <> 2 THEN RAISE EXCEPTION 'Expected existing source RLS enabled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars' AND public IS TRUE) THEN
    RAISE EXCEPTION 'Expected existing public avatars bucket';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_schema_privilege(api_role, 'public', 'CREATE')
      OR pg_catalog.pg_has_role(api_role, 'postgres', 'MEMBER') THEN
      RAISE EXCEPTION 'Unexpected effective API privileges';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated')
    AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unexpected application bypass'; END IF;
END $preflight$;

CREATE FUNCTION public.bandup_member_avatars(p_band_id uuid, p_user_ids uuid[])
RETURNS TABLE(user_id uuid, avatar_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = off AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  -- Same denial for absent/inaccessible bands and non-member callers. Check this
  -- before input validation; untrusted callers cannot probe band existence.
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR p_band_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.band_members m JOIN public.bands b ON b.id = m.band_id
      WHERE m.band_id = p_band_id AND m.user_id = actor AND m.role IN ('admin', 'member')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Member avatars unavailable';
  END IF;
  IF p_user_ids IS NULL OR pg_catalog.cardinality(p_user_ids) > 20
    OR (pg_catalog.cardinality(p_user_ids) > 0 AND pg_catalog.array_ndims(p_user_ids) <> 1)
    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_user_ids) id WHERE id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Expected up to 20 user IDs';
  END IF;
  -- Map by user ID onto the existing member list; no user directory or offset
  -- pagination. Foreign, removed and unknown users are omitted, never looked up alone.
  RETURN QUERY
  SELECT q.user_id,
    CASE WHEN pg_catalog.jsonb_typeof(u.raw_user_meta_data -> 'avatar_url') = 'string'
      AND pg_catalog.starts_with(u.raw_user_meta_data ->> 'avatar_url',
        'https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/avatars/' || q.user_id::text || '/')
      AND pg_catalog.substr(u.raw_user_meta_data ->> 'avatar_url', pg_catalog.length(
        'https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/avatars/' || q.user_id::text || '/') + 1)
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      THEN u.raw_user_meta_data ->> 'avatar_url' ELSE NULL::text END
  FROM public.band_members q
  LEFT JOIN auth.users u ON u.id = q.user_id
  WHERE q.band_id = p_band_id AND q.role IN ('admin', 'member') AND q.user_id = ANY(p_user_ids)
    AND EXISTS (SELECT 1 FROM public.band_members m
      WHERE m.band_id = p_band_id AND m.user_id = actor AND m.role IN ('admin', 'member'))
  ORDER BY q.user_id;
END $function$;

ALTER FUNCTION public.bandup_member_avatars(uuid,uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_member_avatars(uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_member_avatars(uuid,uuid[]) TO authenticated;

DO $verify_acls$
DECLARE target oid := 'public.bandup_member_avatars(uuid,uuid[])'::regprocedure;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = target) <> 2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
      WHERE p.oid = target AND (a.grantee NOT IN ('postgres'::regrole, 'authenticated'::regrole)
        OR a.grantor <> 'postgres'::regrole OR a.privilege_type <> 'EXECUTE' OR a.is_grantable))
    OR NOT pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE WITH GRANT OPTION')
    OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected effective RPC privileges; no existing grants repaired';
  END IF;
END $verify_acls$;
COMMIT;
