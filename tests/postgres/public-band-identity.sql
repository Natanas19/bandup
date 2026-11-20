SELECT current_database() = 'postgres' AND current_user = 'postgres'
  AND inet_server_addr() = '127.0.0.1'::inet AND inet_server_port() = :'test_port'::int
  AND lower(replace(current_setting('data_directory'), chr(92), '/')) = lower(:'test_data') AS isolated \gset
\if :isolated
\else
DO $$ BEGIN RAISE EXCEPTION 'Unexpected test cluster'; END $$;
\endif
\ir band-delete-bootstrap.sql
\ir ../../supabase/migrations/20261001000000_initial_bandup_schema.sql

INSERT INTO auth.users VALUES
  ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
INSERT INTO public.bands (id, name, slug, description)
VALUES ('20000000-0000-0000-0000-000000000001', 'Banda Teste', 'banda-teste', 'Bio');
INSERT INTO public.band_members (band_id, user_id, role)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'member');
\ir ../../supabase/migrations/20261119120000_public_band_identity_v1.sql

SET ROLE authenticated;
DO $test$
BEGIN
  INSERT INTO public.bands (name, slug) VALUES ('Nova', 'nova');
  IF (SELECT count(*) FROM public.bands WHERE is_public IS FALSE) <> 2 THEN
    RAISE EXCEPTION 'Existing and new bands must default to private';
  END IF;
  BEGIN
    INSERT INTO public.bands (name, slug, is_public) VALUES ('Atalho', 'atalho', true);
    RAISE EXCEPTION 'Creating a public band was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.bands SET slug = '..', is_public = true WHERE slug = 'nova';
    RAISE EXCEPTION 'Publishing an invalid slug was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$test$;
RESET ROLE;

SET ROLE anon;
DO $test$
BEGIN
  IF EXISTS (SELECT FROM public.public_band_profiles) OR EXISTS (
    SELECT FROM unnest(ARRAY['bands', 'social_links', 'band_members', 'tasks', 'events']) AS source(name)
    WHERE has_any_column_privilege(current_user, 'public.' || source.name, 'SELECT')
  ) THEN
    RAISE EXCEPTION 'Anonymous access to private data';
  END IF;
END;
$test$;
RESET ROLE;

SET ROLE authenticated;
UPDATE public.bands SET is_public = true WHERE slug = 'banda-teste';
RESET ROLE;

SET ROLE anon;
DO $test$
BEGIN
  IF (SELECT to_jsonb(p) FROM public.public_band_profiles p WHERE slug = 'banda-teste')
     IS DISTINCT FROM '{"name":"Banda Teste","slug":"banda-teste","description":"Bio","logo_url":null}'::jsonb THEN
    RAISE EXCEPTION 'Unexpected public projection';
  END IF;
END;
$test$;
RESET ROLE;

SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $test$
BEGIN
  UPDATE public.bands SET is_public = NOT is_public;
  IF FOUND THEN RAISE EXCEPTION 'Member bypassed the bands update policy'; END IF;
END;
$test$;
RESET ROLE;
DO $test$
BEGIN
  -- Exercise the trigger independently of the update policy.
  BEGIN
    UPDATE public.bands SET is_public = false WHERE slug = 'banda-teste';
    RAISE EXCEPTION 'Member bypassed the publication trigger';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;

SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
UPDATE public.bands SET is_public = false WHERE slug = 'banda-teste';
RESET ROLE;

SET ROLE anon;
DO $test$
BEGIN
  IF EXISTS (SELECT FROM public.public_band_profiles) THEN
    RAISE EXCEPTION 'Unpublished band remained visible';
  END IF;
END;
$test$;
RESET ROLE;
\echo 'PASS: public band identity grants, publication and withdrawal'
