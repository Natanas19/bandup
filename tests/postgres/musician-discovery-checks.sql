-- MANUAL LOCAL ONLY: existing disposable database with both candidates installed.
-- Run with psql -X -v ON_ERROR_STOP=1, never against Demo/production.
BEGIN;
SET LOCAL statement_timeout = '5s';
DO $gate$
BEGIN
  IF current_database() <> 'bandup_migration_test'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_port() IS DISTINCT FROM 5433 OR session_user <> 'postgres'
  THEN RAISE EXCEPTION 'Wrong local destination'; END IF;
END $gate$;
INSERT INTO auth.users(id, raw_user_meta_data) VALUES
 ('00000000-0000-4000-8000-000000000001', '{"display_name":"ZzDiscoveryFixture Alpha","email":"private@example.invalid","avatar_url":"https://private.invalid/secret"}'),
 ('00000000-0000-4000-8000-000000000002', '{"display_name":"ZzDiscoveryFixture Beta"}'),
 ('00000000-0000-4000-8000-000000000003', '{"display_name":"private@example.invalid"}');
INSERT INTO public.musician_availability(user_id, available)
VALUES ('00000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $checks$
DECLARE first_row record; second_row record; payload text;
BEGIN
  SELECT * INTO STRICT first_row FROM public.bandup_discover_musicians('zzdiscoveryfixture',0,1);
  SELECT * INTO STRICT second_row FROM public.bandup_discover_musicians('zzdiscoveryfixture',1,1);
  IF first_row.display_name <> 'ZzDiscoveryFixture Alpha' OR first_row.available
    OR second_row.display_name <> 'ZzDiscoveryFixture Beta' OR NOT second_row.available
    OR first_row.photo_ref IS NOT NULL OR second_row.photo_ref IS NOT NULL
  THEN RAISE EXCEPTION 'Pagination/default/photo mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.bandup_discover_musicians('zzdiscoveryfixture',2,1))
    OR EXISTS (SELECT 1 FROM public.bandup_discover_musicians('zzdiscoveryfixture%',0,20))
    OR EXISTS (SELECT 1 FROM public.bandup_discover_musicians('private@example.invalid',0,20))
  THEN RAISE EXCEPTION 'Search/privacy mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bandup_discover_musicians('',0,50) WHERE display_name = 'Músico')
  THEN RAISE EXCEPTION 'Missing universal fallback'; END IF;
  SELECT json_agg(r)::text INTO payload FROM public.bandup_discover_musicians('zzdiscoveryfixture',0,20) r;
  IF payload ~ 'user_id|email|avatar_url|00000000|secret|private.invalid'
  THEN RAISE EXCEPTION 'Private field leaked'; END IF;
  IF (SELECT count(*) FROM public.musician_availability) <> 0
  THEN RAISE EXCEPTION 'Cross-user availability leaked through direct RLS'; END IF;
  BEGIN
    PERFORM * FROM public.bandup_discover_musicians('',0,51);
    RAISE EXCEPTION 'Unbounded page accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM * FROM public.bandup_discover_musicians('',-1,20);
    RAISE EXCEPTION 'Negative offset accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM * FROM public.bandup_discover_musicians(repeat('a',101),0,20);
    RAISE EXCEPTION 'Oversized query accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF has_function_privilege('anon','public.bandup_discover_musicians(text,integer,integer)','EXECUTE')
    OR has_function_privilege('service_role','public.bandup_discover_musicians(text,integer,integer)','EXECUTE')
  THEN RAISE EXCEPTION 'Unexpected execution privileges'; END IF;
END $checks$;
SELECT set_config('request.jwt.claim.role', 'service_role', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"service_role"}', true);
DO $role_denial$
BEGIN
  BEGIN
    PERFORM * FROM public.bandup_discover_musicians();
    RAISE EXCEPTION 'Wrong JWT role accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $role_denial$;
SELECT set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $denial$
BEGIN
  BEGIN
    PERFORM * FROM public.bandup_discover_musicians();
    RAISE EXCEPTION 'Missing identity accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $denial$;
ROLLBACK;
\echo PASS: musician discovery functional checks (rolled back)
