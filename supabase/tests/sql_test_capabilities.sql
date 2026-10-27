-- Shared test harness include: caller must BEGIN a transaction first.
-- Supply BOTH expected values explicitly with psql -v. No defaults/autodetection.
-- Prepared identity-gate revision: NOT EXECUTED during preparation.
\set ON_ERROR_STOP on
\if :{?bandup_expected_database}
\else
\echo ERROR: required -v bandup_expected_database is missing; stopping before test writes.
SELECT 1 / 0 AS missing_expected_database;
\endif
\if :{?bandup_expected_system_identifier}
\else
\echo ERROR: required -v bandup_expected_system_identifier is missing; stopping before test writes.
SELECT 1 / 0 AS missing_expected_system_identifier;
\endif
-- Quoted psql literals are expanded OUTSIDE dollar-quoted DO bodies.
-- A deliberately failing SELECT in the error branches makes psql exit nonzero.
SELECT pg_catalog.current_database() = :'bandup_expected_database'
  AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) = :'bandup_expected_system_identifier'
  AND EXISTS (SELECT 1 FROM (VALUES
    ('bandup_url_safety_20261027a','7701212271739703337'),
    ('bandup_functional_integrity_20261027b','7701232072543551523')
  ) AS approved(database_name,system_identifier)
    WHERE approved.database_name = :'bandup_expected_database'
      AND approved.system_identifier = :'bandup_expected_system_identifier') AS verified
\gset bandup_identity_
\if :bandup_identity_verified
\else
\echo ERROR: database or PostgreSQL cluster identity differs from the explicitly approved target.
SELECT 1 / 0 AS test_target_identity_mismatch;
\endif
\unset bandup_identity_verified

-- Existing effective-capability/RLS checks remain unchanged below.
DO $test_capabilities$
DECLARE relation_name text; executor_oid oid; elevated boolean;
BEGIN
  IF SESSION_USER <> CURRENT_USER THEN
    RAISE EXCEPTION 'Use a fresh administrative test session';
  END IF;
  SELECT oid, rolsuper OR rolbypassrls INTO executor_oid, elevated
    FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER;
  IF NOT elevated
     OR NOT pg_catalog.has_database_privilege(executor_oid, pg_catalog.current_database(), 'TEMP')
     OR NOT pg_catalog.has_schema_privilege(executor_oid, 'auth', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege(executor_oid, 'public', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege(executor_oid, 'private', 'USAGE')
     OR NOT pg_catalog.has_table_privilege(executor_oid, 'auth.users', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(executor_oid, 'auth.users', 'INSERT')
     OR NOT pg_catalog.pg_has_role(executor_oid, 'anon', 'SET')
     OR NOT pg_catalog.pg_has_role(executor_oid, 'authenticated', 'SET') THEN
    RAISE EXCEPTION 'Harness requires RLS bypass, fixture privileges, TEMP and SET to application roles';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY['public.bands','public.band_members',
    'public.social_links','public.tasks','public.events'] LOOP
    IF NOT pg_catalog.has_table_privilege(executor_oid, relation_name, 'SELECT')
       OR NOT pg_catalog.has_table_privilege(executor_oid, relation_name, 'INSERT')
       OR NOT pg_catalog.has_table_privilege(executor_oid, relation_name, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege(executor_oid, relation_name, 'DELETE')
       OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class
         WHERE oid = relation_name::regclass) THEN
      RAISE EXCEPTION 'Harness privileges or source RLS contract missing: %', relation_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
      WHERE r.rolname IN ('anon','authenticated') AND
        (r.rolsuper OR r.rolbypassrls OR pg_catalog.pg_has_role(r.oid,
          (SELECT relowner FROM pg_catalog.pg_class WHERE oid = relation_name::regclass), 'USAGE'))) THEN
      RAISE EXCEPTION 'Application test roles could bypass RLS or own source tables';
    END IF;
  END LOOP;
END;
$test_capabilities$;
