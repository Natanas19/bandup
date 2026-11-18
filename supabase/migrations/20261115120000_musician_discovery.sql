-- LOCAL REVIEW CANDIDATE ONLY. Not applied to Demo. Never db push/repair.
-- Separate from musician_availability: no existing grants/policies/data changed.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'Requires reviewed postgres executor with existing RLS bypass'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.proname = 'bandup_discover_musicians') THEN
    RAISE EXCEPTION 'Discovery name collision; inspect destination';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL
    OR pg_catalog.to_regprocedure('auth.role()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = pg_catalog.to_regclass('public.musician_availability') AND relrowsecurity)
  THEN RAISE EXCEPTION 'Missing identity helpers or availability RLS'; END IF;
  IF NOT pg_catalog.has_column_privilege(current_user, 'auth.users', 'id', 'SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user, 'auth.users', 'raw_user_meta_data', 'SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user, 'public.musician_availability', 'user_id', 'SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user, 'public.musician_availability', 'available', 'SELECT')
  THEN RAISE EXCEPTION 'Missing source privileges; no grants repaired'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated')
    AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unexpected application bypass'; END IF;
END $preflight$;

CREATE FUNCTION public.bandup_discover_musicians(
  p_query text DEFAULT '', p_offset integer DEFAULT 0, p_limit integer DEFAULT 20
)
RETURNS TABLE(display_name text, photo_ref text, available boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR actor IS NULL
    OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Musician discovery unavailable';
  END IF;
  IF p_query IS NULL OR pg_catalog.char_length(p_query) > 100
    OR p_offset IS NULL OR p_offset < 0
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid musician search parameters';
  END IF;
  RETURN QUERY
  SELECT names.name, NULL::text, COALESCE(a.available, false)
  FROM auth.users u
  CROSS JOIN LATERAL (SELECT u.raw_user_meta_data ->> 'display_name' AS name) raw
  CROSS JOIN LATERAL (SELECT pg_catalog.btrim(pg_catalog.left(raw.name, 81)) AS name) clean
  CROSS JOIN LATERAL (SELECT CASE
    WHEN pg_catalog.jsonb_typeof(u.raw_user_meta_data -> 'display_name') = 'string'
      AND pg_catalog.char_length(raw.name) BETWEEN 1 AND 80
      AND pg_catalog.char_length(clean.name) BETWEEN 1 AND 80
      AND raw.name !~ U&'[\0001-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]'
      AND raw.name !~ '[<>@]'
      AND clean.name !~ U&'^[\0020\00A0\1680\2000-\200D\2028\2029\202F\205F\2060\3000\FEFF\FE00-\FE0F\+0E0100-\+0E01EF]*$'
    THEN clean.name ELSE 'Músico'::text END AS name) names
  LEFT JOIN public.musician_availability a ON a.user_id = u.id
  -- Literal substring, not LIKE: %, _ and backslash have no wildcard meaning.
  WHERE pg_catalog.strpos(pg_catalog.lower(names.name), pg_catalog.lower(pg_catalog.btrim(p_query))) > 0
  ORDER BY u.id
  LIMIT p_limit OFFSET p_offset;
END $function$;

ALTER FUNCTION public.bandup_discover_musicians(text,integer,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_discover_musicians(text,integer,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_discover_musicians(text,integer,integer) TO authenticated;

DO $postflight$
DECLARE target oid := 'public.bandup_discover_musicians(text,integer,integer)'::regprocedure;
BEGIN
  IF pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', target, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE WITH GRANT OPTION')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = target
      AND (a.grantee NOT IN ('postgres'::regrole, 'authenticated'::regrole)
        OR a.grantor <> 'postgres'::regrole OR a.privilege_type <> 'EXECUTE' OR a.is_grantable))
  THEN RAISE EXCEPTION 'Unexpected discovery execution privileges'; END IF;
END $postflight$;
COMMIT;
