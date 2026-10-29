-- ARCHIVED STATEMENTS, not original file/provenance or production evidence.
-- Wrapper and preconditions below are new laboratory infrastructure.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
\ir historical_lab_identity_check.sql
DO $empty$
BEGIN
  -- INHERIT for a new PG17 membership defaults to the receiving executor.
  IF SESSION_USER<>CURRENT_USER OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
      WHERE oid=CURRENT_USER::regrole::oid AND rolsuper AND rolinherit) THEN
    RAISE EXCEPTION 'Historical fixture requires fresh superuser INHERIT executor';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('bandup_public_reader','bandup_profile_reader'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('v','m'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid IN ('public.bands'::regclass,'public.social_links'::regclass)
      AND attname='is_public' AND NOT attisdropped)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclrole=CURRENT_USER::regrole::oid)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger) THEN
    RAISE EXCEPTION 'Historical fixture collision or unreviewed defaults; never repair';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN
      ('public.bands'::regclass,'public.events'::regclass,'public.social_links'::regclass,
       'public.tasks'::regclass,'public.band_members'::regclass)
      AND relkind='r' AND relrowsecurity AND relowner=CURRENT_USER::regrole::oid)<>5 THEN
    RAISE EXCEPTION 'Historical fixture requires reviewed M1-M5 source baseline';
  END IF;
END;
$empty$;
-- BEGIN ARCHIVED STATEMENTS: exact decoded elements; added semicolon separators.
-- ARCHIVED STATEMENT 1
-- Expose an explicit public projection without granting anon access to the
-- private source tables. The non-login view owner is subject to these RLS
-- policies and can read only the columns required by the views.

CREATE ROLE bandup_public_reader NOLOGIN NOINHERIT NOBYPASSRLS;

-- ARCHIVED STATEMENT 2
GRANT bandup_public_reader TO CURRENT_USER;

-- ARCHIVED STATEMENT 3
-- Existing rows receive false from the NOT NULL DEFAULT; publication is
-- opt-in for every band, including bands created after this migration.
ALTER TABLE public.bands
  ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT false;

-- ARCHIVED STATEMENT 4
GRANT USAGE, CREATE ON SCHEMA public TO bandup_public_reader;

-- ARCHIVED STATEMENT 5
GRANT SELECT (id, name, slug, description, logo_url, is_public)
  ON TABLE public.bands TO bandup_public_reader;

-- ARCHIVED STATEMENT 6
GRANT SELECT (band_id, platform, url)
  ON TABLE public.social_links TO bandup_public_reader;

-- ARCHIVED STATEMENT 7
GRANT SELECT (band_id, title, event_type, start_at, end_at, location)
  ON TABLE public.events TO bandup_public_reader;

-- ARCHIVED STATEMENT 8
REVOKE ALL PRIVILEGES ON TABLE
  public.bands,
  public.social_links,
  public.events
FROM anon, PUBLIC;

-- ARCHIVED STATEMENT 9
CREATE POLICY bands_select_for_public_reader
ON public.bands FOR SELECT TO bandup_public_reader
USING (is_public IS TRUE);

-- ARCHIVED STATEMENT 10
CREATE POLICY social_links_select_for_public_reader
ON public.social_links FOR SELECT TO bandup_public_reader
USING (
  EXISTS (
    SELECT 1
    FROM public.bands AS band
    WHERE band.id = social_links.band_id
      AND band.is_public IS TRUE
  )
);

-- ARCHIVED STATEMENT 11
CREATE POLICY events_select_for_public_reader
ON public.events FOR SELECT TO bandup_public_reader
USING (
  start_at >= now()
  AND EXISTS (
    SELECT 1
    FROM public.bands AS band
    WHERE band.id = events.band_id
      AND band.is_public IS TRUE
  )
);

-- ARCHIVED STATEMENT 12
CREATE VIEW public.public_bands
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, name, slug, description, logo_url
FROM public.bands
WHERE is_public IS TRUE;

-- ARCHIVED STATEMENT 13
CREATE VIEW public.public_social_links
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

-- ARCHIVED STATEMENT 14
CREATE VIEW public.public_events
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

-- ARCHIVED STATEMENT 15
ALTER VIEW public.public_bands OWNER TO bandup_public_reader;

-- ARCHIVED STATEMENT 16
ALTER VIEW public.public_social_links OWNER TO bandup_public_reader;

-- ARCHIVED STATEMENT 17
ALTER VIEW public.public_events OWNER TO bandup_public_reader;

-- ARCHIVED STATEMENT 18
REVOKE ALL PRIVILEGES ON TABLE
  public.public_bands,
  public.public_social_links,
  public.public_events
FROM anon, authenticated, service_role, PUBLIC;

-- ARCHIVED STATEMENT 19
GRANT SELECT ON TABLE
  public.public_bands,
  public.public_social_links,
  public.public_events
TO anon;
-- END ARCHIVED STATEMENTS
COMMIT;
