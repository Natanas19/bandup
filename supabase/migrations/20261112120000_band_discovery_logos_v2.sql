-- LOCAL CANDIDATE ONLY: do not apply automatically. Demo-specific public origin.
-- Leaves bandup_discover_bands(uuid,integer) and all existing policies untouched.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE api_role text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Requires the reviewed postgres executor';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bandup_discover_bands_v2') THEN
    RAISE EXCEPTION 'Discovery v2 already exists; inspect instead of replacing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure('public.bandup_discover_bands(uuid,integer)')
      AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 's'
      AND pg_catalog.pg_get_function_result(p.oid) = 'TABLE(band_id uuid, display_name text, summary text)') THEN
    RAISE EXCEPTION 'Unexpected original discovery contract';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.bands'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Expected bands RLS enabled';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_schema_privilege(api_role, 'public', 'CREATE')
      OR pg_catalog.pg_has_role(api_role, 'postgres', 'MEMBER') THEN
      RAISE EXCEPTION 'Unexpected effective API privileges';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unexpected application role bypass';
  END IF;
END $preflight$;

CREATE FUNCTION public.bandup_discover_bands_v2(
  p_after uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20
) RETURNS TABLE(band_id uuid, display_name text, summary text, logo_url text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Limit must be between 1 and 50';
  END IF;
  -- Discovery intentionally includes every band, including non-member bands.
  -- Never expose description or other private fields. Missing/legacy URLs fail closed.
  RETURN QUERY
  SELECT b.id, b.name, ''::text,
    CASE WHEN pg_catalog.starts_with(b.logo_url,
        'https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/band-logos/' || b.id::text || '/')
      AND pg_catalog.substr(b.logo_url, pg_catalog.length(
        'https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/band-logos/' || b.id::text || '/') + 1)
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      THEN b.logo_url ELSE NULL::text END
  FROM public.bands b
  WHERE p_after IS NULL OR b.id > p_after
  ORDER BY b.id LIMIT p_limit;
END $function$;

ALTER FUNCTION public.bandup_discover_bands_v2(uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_discover_bands_v2(uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_discover_bands_v2(uuid,integer) TO authenticated;

DO $verify_acls$
DECLARE target oid := 'public.bandup_discover_bands_v2(uuid,integer)'::regprocedure;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = target) <> 2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
      WHERE p.oid = target AND (
        a.grantee NOT IN ('postgres'::regrole, 'authenticated'::regrole)
        OR a.grantor <> 'postgres'::regrole OR a.privilege_type <> 'EXECUTE' OR a.is_grantable))
    OR NOT pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE WITH GRANT OPTION')
    OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected discovery v2 ACL or inherited privileges';
  END IF;
END $verify_acls$;
COMMIT;
