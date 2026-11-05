-- REVIEW CANDIDATE ONLY: do not apply or run db push without separate approval.
-- Additive RPC for src/lib/display-name.ts. No existing table, RLS policy,
-- helper, source-table grant, default privilege or user record is changed.
-- Independent of tasks.event_id and of the unverified private membership helper.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE
  expected RECORD;
BEGIN
  -- The function keeps the trusted migration executor as owner. Never create
  -- it as an application role or compensate for missing privileges with GRANT.
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = current_user AND (r.rolsuper OR r.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Requires reviewed postgres executor with existing RLS bypass';
  END IF;
  IF pg_catalog.current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'Requires UTF8 database';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND p.proname = 'bandup_member_display_names'
  ) THEN
    RAISE EXCEPTION 'Name collision: review existing member display name routines';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
    OR pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'Required Supabase Auth identity helpers are missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege(current_user, 'auth.uid()', 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(current_user, 'auth.role()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Executor cannot use existing Auth identity helpers';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
    OR NOT pg_catalog.has_schema_privilege(current_user, 'auth', 'USAGE')
    OR NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'Required existing schema privileges are missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = 'authenticated' AND (r.rolsuper OR r.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Unexpected elevated authenticated role';
  END IF;
  FOR expected IN
    SELECT * FROM (VALUES
      ('public', 'band_members', 'band_id', 'uuid'),
      ('public', 'band_members', 'user_id', 'uuid'),
      ('auth', 'users', 'id', 'uuid'),
      ('auth', 'users', 'raw_user_meta_data', 'jsonb')
    ) AS columns_to_check(schema_name, table_name, column_name, type_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = expected.schema_name AND c.relname = expected.table_name
        AND c.relkind = 'r' AND a.attname = expected.column_name
        AND a.attnum > 0 AND NOT a.attisdropped
        AND a.atttypid = pg_catalog.to_regtype(expected.type_name)
    ) THEN
      RAISE EXCEPTION 'Required source column/type is missing or incompatible';
    END IF;
    IF NOT pg_catalog.has_column_privilege(current_user,
      pg_catalog.format('%I.%I', expected.schema_name, expected.table_name),
      expected.column_name, 'SELECT') THEN
      RAISE EXCEPTION 'Required source read privilege is missing; no grants changed';
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'band_members' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Expected existing membership RLS is not enabled';
  END IF;
END;
$preflight$;

-- SECURITY DEFINER is needed only to read the two private Auth columns below.
-- Empty search_path and qualified objects prevent caller-created object capture.
-- row_security=off is local to this function, not an ALTER TABLE/RLS change.
CREATE FUNCTION public.bandup_member_display_names(p_band_id UUID)
RETURNS TABLE (user_id UUID, display_name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
SET standard_conforming_strings = on
AS $function$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  -- Same refusal for absent, inaccessible or NULL band: no existence oracle.
  -- Role check also rejects a service-role JWT even if EXECUTE is inherited.
  IF auth.role() IS DISTINCT FROM 'authenticated' OR caller_id IS NULL
    OR p_band_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.band_members AS caller
      WHERE caller.band_id = p_band_id AND caller.user_id = caller_id
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band member names are unavailable';
  END IF;

  RETURN QUERY
  SELECT DISTINCT member.user_id,
    CASE
      -- Metadata is user-editable presentation, never an authorization source.
      -- Preserve Unicode scripts, combining marks and emoji (including ZWJ).
      -- Reject controls, directional overrides and markup/email delimiters;
      -- this is presentation validation, not identity or content moderation.
      WHEN pg_catalog.jsonb_typeof(account.raw_user_meta_data -> 'display_name') = 'string'
        AND pg_catalog.char_length(raw.name) BETWEEN 1 AND 80
        AND raw.name !~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]'
        AND raw.name !~ '[<>@]'
        AND pg_catalog.char_length(clean.name) BETWEEN 1 AND 80
        AND clean.name !~ U&'^[\0020\00A0\1680\2000-\200D\2028\2029\202F\205F\2060\3000\FEFF\FE00-\FE0F\+0E0100-\+0E01EF]*$'
      THEN clean.name
      ELSE 'Integrante'::TEXT
    END AS display_name
  FROM public.band_members AS member
  LEFT JOIN auth.users AS account ON account.id = member.user_id
  CROSS JOIN LATERAL (SELECT account.raw_user_meta_data ->> 'display_name' AS name) AS raw
  CROSS JOIN LATERAL (
    -- Trim only surrounding Unicode White_Space, without rewriting the name.
    -- Raw length is checked above; the bounded expression limits processing.
    SELECT pg_catalog.btrim(pg_catalog.left(raw.name, 81),
      U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') AS name
  ) AS clean
  WHERE member.band_id = p_band_id
    -- Keep the caller predicate in the result query as well as the error gate.
    AND EXISTS (
      SELECT 1 FROM public.band_members AS caller
      WHERE caller.band_id = p_band_id AND caller.user_id = caller_id
    )
  ORDER BY member.user_id;
END;
$function$;

-- Only this NEW function's ACL is changed. Default PUBLIC execution must never
-- be exposed between creation and revocation: all DDL is in one transaction.
REVOKE ALL ON FUNCTION public.bandup_member_display_names(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_member_display_names(UUID) TO authenticated;
COMMENT ON FUNCTION public.bandup_member_display_names(UUID) IS
  'Authenticated band members only; returns user_id and presentation-only display_name, never other Auth fields.';

DO $postflight$
DECLARE
  function_oid OID := 'public.bandup_member_display_names(uuid)'::pg_catalog.regprocedure;
BEGIN
  -- Abort on unexpected default/inherited grants, rather than editing global
  -- defaults, memberships or privileges on any existing object.
  -- PostgreSQL 17 supports 'EXECUTE WITH GRANT OPTION' here (acl.c,
  -- convert_function_priv_string). Keep this effective-privilege check as well
  -- as the direct ACL/is_grantable audit below; they are not interchangeable.
  IF pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', function_oid, 'EXECUTE WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'Unexpected effective RPC execution privileges';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
    WHERE p.oid = function_oid AND (acl.grantee NOT IN (
      p.proowner, (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'authenticated')
    ) OR (acl.grantee <> p.proowner AND acl.is_grantable))
  ) THEN
    RAISE EXCEPTION 'Unexpected direct RPC ACL; review default privileges';
  END IF;
END;
$postflight$;
COMMIT;
