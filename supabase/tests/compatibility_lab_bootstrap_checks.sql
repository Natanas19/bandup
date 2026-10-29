-- PREPARED, NOT EXECUTED. After bootstrap, BEFORE M1. ROLLBACK only.
\set ON_ERROR_STOP on
BEGIN;
\ir compatibility_lab_identity_check.sql
CREATE FUNCTION pg_temp.bootstrap_assert(ok boolean,label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Bootstrap assertion: %',label; END IF; END;
$$;
CREATE FUNCTION pg_temp.bootstrap_denied(command text,state text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN IF SQLSTATE=state THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'Bootstrap unexpectedly accepted operation';
END;
$$;
SELECT pg_temp.bootstrap_assert(pg_catalog.to_regnamespace('private') IS NULL
 AND pg_catalog.to_regclass('public.bands') IS NULL
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('bandup_public_reader','bandup_profile_reader')),
 'bootstrap did not precreate migration/fixture objects');
SELECT pg_temp.bootstrap_assert(NOT EXISTS (SELECT 1 FROM auth.users),'synthetic auth starts empty');
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
SELECT pg_catalog.set_config('request.jwt.claims','',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.bootstrap_assert(auth.uid() IS NULL,'absent identity');
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001"}',true);
SELECT pg_temp.bootstrap_assert(auth.uid()='61000000-0000-0000-0000-000000000001'::uuid,'JSON fallback');
SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000002',true);
SELECT pg_temp.bootstrap_assert(auth.uid()='61000000-0000-0000-0000-000000000002'::uuid,'direct claim precedence');
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
SELECT pg_catalog.set_config('request.jwt.claims','{}',true);
SELECT pg_temp.bootstrap_assert(auth.uid() IS NULL,'missing JSON sub');
SELECT pg_catalog.set_config('request.jwt.claim.sub','not-a-uuid',true);
SELECT pg_temp.bootstrap_denied('SELECT auth.uid()','22P02');
SELECT pg_catalog.set_config('request.jwt.claim.sub','',true);
SELECT pg_catalog.set_config('request.jwt.claims','{',true);
SELECT pg_temp.bootstrap_denied('SELECT auth.uid()','22P02');
SELECT pg_temp.bootstrap_denied('SELECT * FROM auth.users','42501');
SELECT pg_temp.bootstrap_denied('INSERT INTO auth.users(id) VALUES (gen_random_uuid())','42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claims','',true);
SELECT pg_temp.bootstrap_assert(auth.uid() IS NULL,'anonymous empty identity');
SELECT pg_temp.bootstrap_denied('SELECT * FROM auth.users','42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.bootstrap_denied('SELECT * FROM auth.users','42501');
RESET ROLE;
ROLLBACK;
