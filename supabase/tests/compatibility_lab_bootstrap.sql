-- PREPARED FOR REVIEW ONLY. Never production or the restored 5433 cluster.
-- Auth simulation only: no JWT verification, login service or ledger.
\set ON_ERROR_STOP on
\ir compatibility_lab_identity.sql
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
DO $empty$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN
      ('anon','authenticated','service_role','bandup_public_reader','bandup_profile_reader'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname IN ('auth','private','extensions'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname<>'plpgsql')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl WHERE defaclrole=
         (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,
         LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
         WHERE n.nspname='public' AND a.grantee<>n.nspowner
           AND (a.grantee<>0 OR a.privilege_type NOT IN ('USAGE','CREATE') OR a.is_grantable)) THEN
    RAISE EXCEPTION 'Bootstrap collision, nonempty target or unreviewed defaults; never repair implicitly';
  END IF;
  IF pg_catalog.to_regnamespace('public') IS NULL
     OR NOT pg_catalog.has_schema_privilege(CURRENT_USER,'public','CREATE')
     OR NOT pg_catalog.has_database_privilege(CURRENT_USER,pg_catalog.current_database(),'TEMP')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_language WHERE lanname='plpgsql') THEN
    RAISE EXCEPTION 'Missing public schema, language or executor capabilities';
  END IF;
END;
$empty$;
CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth.users FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $uid$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.sub',true),''),
    NULLIF(NULLIF(pg_catalog.current_setting('request.jwt.claims',true),'')::pg_catalog.jsonb->>'sub','')
  )::pg_catalog.uuid;
$uid$;
REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
-- No private schema/helpers/readers: migrations and the legacy fixture own those.
-- No extensions: gen_random_uuid() is native in PostgreSQL 17.
DO $postconditions$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF pg_catalog.has_any_column_privilege(role_name,'auth.users','SELECT,INSERT,UPDATE,REFERENCES')
       OR pg_catalog.has_table_privilege(role_name,'auth.users','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_schema_privilege(role_name,'public','CREATE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=role_name) THEN
      RAISE EXCEPTION 'Unexpected bootstrap privileges or memberships';
    END IF;
  END LOOP;
END;
$postconditions$;
COMMIT;
