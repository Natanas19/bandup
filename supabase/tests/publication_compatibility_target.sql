-- PREPARED ONLY. Include after BEGIN, before any test/fixture write.
-- Dedicated 5434 cluster only. Restored 5433 is forbidden.
\set ON_ERROR_STOP on
\ir compatibility_lab_identity_check.sql
DO $capabilities$
DECLARE source_name text;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER) THEN
    RAISE EXCEPTION 'Synthetic compatibility harness requires local superuser';
  END IF;
  FOREACH source_name IN ARRAY ARRAY['bands','band_members','events','tasks','social_links'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
      WHERE rolname IN ('anon','authenticated') AND
        (rolsuper OR rolbypassrls OR pg_catalog.pg_has_role(r.oid,
          (SELECT relowner FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public.'||source_name)),'USAGE'))) THEN
      RAISE EXCEPTION 'Application fixture roles bypass source RLS';
    END IF;
  END LOOP;
END;
$capabilities$;
