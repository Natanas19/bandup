-- Public identity only. Keep the application flag off until the API is validated.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_class WHERE oid = 'public.bands'::regclass AND relrowsecurity
  ) OR has_any_column_privilege('anon', 'public.bands', 'SELECT')
    OR to_regprocedure('private.is_band_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Unexpected private bands contract';
  END IF;
END;
$preflight$;

ALTER TABLE public.bands ADD COLUMN is_public boolean NOT NULL DEFAULT false;

CREATE FUNCTION private.guard_band_identity_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_public IS TRUE THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'New bands must start unpublished';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR auth.uid() IS NULL
       OR private.is_band_admin(OLD.id) IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only a band admin may change publication';
    END IF;
  END IF;
  IF NEW.is_public IS TRUE AND (OLD.is_public IS NOT TRUE OR NEW.slug IS DISTINCT FROM OLD.slug)
     AND (NEW.slug IS NULL OR NEW.slug ~ '^[[:space:]]*$' OR NEW.slug ~ '[[:cntrl:]]'
          OR NEW.slug IN ('.', '..') OR pg_catalog.length(NEW.slug) > 2048) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A valid public slug is required';
  END IF;
  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION private.guard_band_identity_publication() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER bands_guard_identity_publication
AFTER INSERT OR UPDATE ON public.bands
FOR EACH ROW EXECUTE FUNCTION private.guard_band_identity_publication();

CREATE ROLE bandup_public_identity_reader
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT bandup_public_identity_reader TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO bandup_public_identity_reader;
GRANT SELECT (name, slug, description, logo_url, is_public) ON public.bands TO bandup_public_identity_reader;

CREATE POLICY bands_select_for_identity_reader
ON public.bands FOR SELECT TO bandup_public_identity_reader
USING (is_public IS TRUE);

-- Source permissions and RLS use the restricted view owner, not the visitor.
-- A security-invoker view would require anonymous grants on public.bands.
CREATE VIEW public.public_band_profiles
WITH (security_barrier = true, security_invoker = false)
AS
SELECT name, slug, description, logo_url
FROM public.bands
WHERE is_public IS TRUE;

REVOKE ALL ON public.public_band_profiles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_band_profiles TO anon;
ALTER VIEW public.public_band_profiles OWNER TO bandup_public_identity_reader;
REVOKE CREATE ON SCHEMA public FROM bandup_public_identity_reader;
REVOKE bandup_public_identity_reader FROM CURRENT_USER;

DO $postconditions$
BEGIN
  IF has_any_column_privilege('anon', 'public.bands', 'SELECT')
     OR has_table_privilege('bandup_public_identity_reader', 'public.bands', 'SELECT')
     OR has_schema_privilege('bandup_public_identity_reader', 'public', 'CREATE')
     OR EXISTS (
       SELECT FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS api(role)
       WHERE pg_has_role(api.role, 'bandup_public_identity_reader', 'MEMBER')
     ) THEN
    RAISE EXCEPTION 'Unexpected privileges on the public identity read path';
  END IF;
END;
$postconditions$;

COMMIT;
