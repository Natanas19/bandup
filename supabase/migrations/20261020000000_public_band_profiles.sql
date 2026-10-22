-- PREPARED ONLY: review and test in a disposable local database before applying.
-- Additive public profiles. No existing function, policy or trigger is replaced.
BEGIN;

DO $preflight$
DECLARE
  relation_oid oid;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'bandup_public_reader')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_class AS c
       JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'public_band_profiles'
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'private'
         AND p.proname IN ('guard_band_publication', 'guard_social_link_publication')
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid IN ('public.bands'::regclass, 'public.social_links'::regclass)
         AND attname = 'is_public' AND NOT attisdropped
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE (tgrelid = 'public.bands'::regclass AND tgname = 'bands_guard_publication')
          OR (tgrelid = 'public.social_links'::regclass AND tgname = 'social_links_guard_publication')
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy
       WHERE (polrelid = 'public.bands'::regclass AND polname = 'bands_select_for_profile_reader')
          OR (polrelid = 'public.social_links'::regclass AND polname = 'social_links_select_for_profile_reader')
     ) THEN
    RAISE EXCEPTION 'Public profile object collision; review existing objects';
  END IF;

  IF pg_catalog.to_regprocedure('private.is_band_admin(uuid)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.events'::regclass
         AND tgname = 'events_guard_ownership' AND NOT tgisinternal AND tgenabled = 'O'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public.band_members'::regclass
         AND tgname = 'band_members_guard_band_id' AND NOT tgisinternal AND tgenabled = 'O'
     ) THEN
    RAISE EXCEPTION 'Required admin helper or ownership guards are missing or disabled';
  END IF;

  -- Fail rather than silently changing unexpected permissions on private tables.
  FOREACH relation_oid IN ARRAY ARRAY[
    'public.bands'::regclass::oid, 'public.social_links'::regclass::oid,
    'public.band_members'::regclass::oid, 'public.tasks'::regclass::oid,
    'public.events'::regclass::oid
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = relation_oid)
       OR pg_catalog.has_table_privilege('anon', relation_oid, 'SELECT')
       OR pg_catalog.has_any_column_privilege('anon', relation_oid, 'SELECT') THEN
      RAISE EXCEPTION 'Expected private-table RLS/grants differ; inspect before applying';
    END IF;
  END LOOP;
END;
$preflight$;

-- Existing and newly omitted values are false. No record is auto-published.
ALTER TABLE public.bands
  ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.social_links
  ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;

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

-- This role is not an application role and owns neither source table.
CREATE ROLE bandup_public_reader
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

-- Temporary setup privileges for ownership transfer, removed below.
GRANT bandup_public_reader TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO bandup_public_reader;

GRANT SELECT (id, name, slug, description, logo_url, is_public)
ON public.bands TO bandup_public_reader;
GRANT SELECT (id, band_id, platform, url, created_at, is_public)
ON public.social_links TO bandup_public_reader;

CREATE POLICY bands_select_for_profile_reader
ON public.bands FOR SELECT TO bandup_public_reader
USING (is_public IS TRUE);

CREATE POLICY social_links_select_for_profile_reader
ON public.social_links FOR SELECT TO bandup_public_reader
USING (
  is_public IS TRUE
  AND EXISTS (
    SELECT 1 FROM public.bands AS band
    WHERE band.id = social_links.band_id AND band.is_public IS TRUE
  )
);

-- Deliberately owner-context, with an unprivileged owner subject to RLS.
-- A security-invoker view would require visitors to access the source tables.
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

-- Remove possible default grants on this NEW object only.
REVOKE ALL ON public.public_band_profiles
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_band_profiles TO anon, authenticated;

ALTER VIEW public.public_band_profiles OWNER TO bandup_public_reader;
REVOKE CREATE ON SCHEMA public FROM bandup_public_reader;
REVOKE bandup_public_reader FROM CURRENT_USER;

DO $postconditions$
BEGIN
  IF pg_catalog.has_schema_privilege('bandup_public_reader', 'public', 'CREATE')
     OR pg_catalog.pg_has_role('anon', 'bandup_public_reader', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', 'bandup_public_reader', 'MEMBER')
     OR pg_catalog.pg_has_role('service_role', 'bandup_public_reader', 'MEMBER') THEN
    RAISE EXCEPTION 'Reader role inherits unsafe privileges; transaction must not be committed';
  END IF;
END;
$postconditions$;

COMMIT;
