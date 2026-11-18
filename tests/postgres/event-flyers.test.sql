-- Run with psql -X -v ON_ERROR_STOP=1 -f on a fresh, disposable PostgreSQL database.
-- Auth and Storage catalog are simulated; the BandUp event schema and RLS are real.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT current_setting('request.jwt.claim.role', true) $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text, public boolean, file_size_limit integer, allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  bucket_id text REFERENCES storage.buckets(id), name text, metadata jsonb, PRIMARY KEY (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
-- Model unrelated permissive policies to exercise the restrictive bucket guards.
CREATE POLICY fixture_broad ON storage.objects FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

\ir ../../supabase/migrations/20261001000000_initial_bandup_schema.sql
\ir ../../supabase/migrations/20261002170000_events_delete_admins_only.sql
\ir ../../docs/event-flyers-candidate.sql

CREATE FUNCTION public.assert_flyer_test(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %', label; END IF;
END;
$$;
CREATE FUNCTION public.expect_flyer_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected SQLSTATE %', expected;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> expected THEN RAISE; END IF;
END;
$$;

BEGIN;
INSERT INTO auth.users VALUES
  ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003'), ('10000000-0000-0000-0000-000000000004');
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
INSERT INTO public.bands (id, name, slug) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Band A', 'band-a'),
  ('20000000-0000-0000-0000-000000000002', 'Band B', 'band-b');
INSERT INTO public.band_members (band_id, user_id, role) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'member'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'member'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'admin');
\set event_a '30000000-0000-0000-0000-000000000001'
\set band_a '20000000-0000-0000-0000-000000000001'
\set flyer_a '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-4000-8000-000000000001.jpg'
\set flyer_b '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-4000-8000-000000000002.png'
\set invalid '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-4000-8000-000000000003.webp'
\set oversize '20000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-4000-8000-000000000004.webp'
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT public.expect_flyer_error(format(
  'INSERT INTO public.events (id,band_id,created_by,title,event_type,start_at,flyer_path) VALUES (%L,%L,auth.uid(),''Show'',''show'',now(),%L)',
  :'event_a', :'band_a', :'flyer_a'), '22023');
INSERT INTO public.events (id,band_id,created_by,title,event_type,start_at)
VALUES (:'event_a', :'band_a', auth.uid(), 'Show', 'show', now());
SELECT public.assert_flyer_test((SELECT flyer_path IS NULL FROM public.events WHERE id = :'event_a'), 'event without flyer');
SELECT public.expect_flyer_error(format('UPDATE public.events SET flyer_path = %L WHERE id = %L', :'flyer_a', :'event_a'), '22023');
INSERT INTO storage.objects VALUES ('event-flyers', :'flyer_a', '{"size":1024,"mimetype":"image/jpeg"}');
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM storage.objects), 'unlinked upload hidden');
SELECT public.expect_flyer_error(format('UPDATE public.events SET flyer_path = %L WHERE id = %L',
  replace(:'flyer_a', :'band_a', '20000000-0000-0000-0000-000000000002'), :'event_a'), '22023');
UPDATE public.events SET flyer_path = :'flyer_a' WHERE id = :'event_a' AND flyer_path IS NULL;
SELECT public.assert_flyer_test(EXISTS (SELECT FROM storage.objects WHERE name = :'flyer_a'), 'author attaches and reads');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
SELECT public.assert_flyer_test(EXISTS (SELECT FROM storage.objects WHERE name = :'flyer_a'), 'same-band reader');
SELECT public.expect_flyer_error(format('INSERT INTO storage.objects VALUES (''event-flyers'',%L,NULL)', :'flyer_b'), '42501');
WITH changed AS (UPDATE public.events SET flyer_path = NULL WHERE id = :'event_a' RETURNING 1)
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM changed), 'non-author member cannot remove');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM storage.objects), 'other-band admin cannot read');
SELECT public.expect_flyer_error(format('INSERT INTO storage.objects VALUES (''event-flyers'',%L,NULL)', :'flyer_b'), '42501');
WITH changed AS (UPDATE public.events SET flyer_path = NULL WHERE id = :'event_a' RETURNING 1)
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM changed), 'other-band admin cannot remove');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM storage.objects), 'anonymous read denied');
SELECT public.expect_flyer_error(format('INSERT INTO storage.objects VALUES (''event-flyers'',%L,NULL)', :'flyer_b'), '42501');
RESET ROLE;
INSERT INTO storage.objects VALUES
 ('event-flyers', :'invalid', '{"size":1024,"mimetype":"image/png"}'),
 ('event-flyers', :'oversize', '{"size":2097153,"mimetype":"image/webp"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT public.expect_flyer_error(format('UPDATE public.events SET flyer_path = %L WHERE id = %L', :'invalid', :'event_a'), '22023');
SELECT public.expect_flyer_error(format('UPDATE public.events SET flyer_path = %L WHERE id = %L', :'oversize', :'event_a'), '22023');
SELECT public.assert_flyer_test((SELECT flyer_path = :'flyer_a' FROM public.events WHERE id = :'event_a'), 'failed link keeps existing flyer');
INSERT INTO storage.objects VALUES ('event-flyers', :'flyer_b', '{"size":2097152,"mimetype":"image/png"}');
UPDATE public.events SET flyer_path = :'flyer_b' WHERE id = :'event_a' AND flyer_path = :'flyer_a';
WITH changed AS (UPDATE public.events SET flyer_path = NULL WHERE id = :'event_a' AND flyer_path = :'flyer_a' RETURNING 1)
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM changed), 'stale edit cannot overwrite replacement');
SELECT public.assert_flyer_test((SELECT array_agg(name) = ARRAY[:'flyer_b'] FROM storage.objects), 'only replacement is readable');
WITH changed AS (UPDATE storage.objects SET metadata = NULL WHERE name = :'flyer_b' RETURNING 1)
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM changed), 'object is immutable');
WITH changed AS (DELETE FROM storage.objects WHERE name = :'flyer_b' RETURNING 1)
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM changed), 'direct object deletion denied');
UPDATE public.events SET flyer_path = NULL WHERE id = :'event_a' AND flyer_path = :'flyer_b';
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM storage.objects), 'detached objects stay private');
UPDATE public.events SET flyer_path = :'flyer_b' WHERE id = :'event_a' AND flyer_path IS NULL;
DELETE FROM public.events WHERE id = :'event_a';
SELECT public.assert_flyer_test(NOT EXISTS (SELECT FROM storage.objects), 'deleted event objects stay private');
RESET ROLE;
SELECT public.assert_flyer_test((SELECT count(*) = 4 FROM storage.objects), 'no object physically deleted');
ROLLBACK;
\echo PASS event flyer authorization, validation and lifecycle
