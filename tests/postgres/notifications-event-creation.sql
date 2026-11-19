-- node tests/postgres/notifications-isolated.cjs --event-creation
SELECT current_database() = 'postgres'
  AND current_user = 'postgres'
  AND inet_server_addr() = '127.0.0.1'::inet
  AND inet_server_port() = :'test_port'::int
  AND lower(replace(current_setting('data_directory'), chr(92), '/')) = lower(:'test_data')
  AS isolated \gset
\if :isolated
\else
DO $$ BEGIN RAISE EXCEPTION 'Unexpected test cluster'; END $$;
\endif

\ir band-delete-bootstrap.sql
\ir ../../supabase/migrations/20261001000000_initial_bandup_schema.sql
\ir ../../supabase/migrations/20261002170000_events_delete_admins_only.sql
\ir ../../supabase/migrations/20261002190800_events_custom_event_type.sql
\ir ../../docs/notifications-backend-candidate.sql
\ir ../../docs/notifications-event-creation-candidate.sql

CREATE FUNCTION pg_temp.check_that(condition boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Failed: %', description;
  END IF;
END $$;
CREATE FUNCTION pg_temp.expect_error(command text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE command;
  RAISE EXCEPTION 'Expected error: %', expected_state;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> expected_state THEN RAISE; END IF;
END $$;

\set creator aaaaaaaa-aaaa-4aaa-8aaa-000000000001
\set first_member aaaaaaaa-aaaa-4aaa-8aaa-000000000002
\set second_member aaaaaaaa-aaaa-4aaa-8aaa-000000000003
\set outsider aaaaaaaa-aaaa-4aaa-8aaa-000000000004
\set band bbbbbbbb-bbbb-4bbb-8bbb-000000000001
\set other_band bbbbbbbb-bbbb-4bbb-8bbb-000000000002
\set plain_event cccccccc-cccc-4ccc-8ccc-000000000001
\set flyer_event cccccccc-cccc-4ccc-8ccc-000000000002
\set rolled_back cccccccc-cccc-4ccc-8ccc-000000000003
\set bad_flyer_event cccccccc-cccc-4ccc-8ccc-000000000004

INSERT INTO auth.users VALUES (:'creator'), (:'first_member'), (:'second_member'), (:'outsider');
SET request.jwt.claim.sub TO :'outsider';
INSERT INTO public.bands(id, name, slug) VALUES (:'other_band', 'Other band', 'other-band');
SET request.jwt.claim.sub TO :'creator';
INSERT INTO public.bands(id, name, slug) VALUES (:'band', 'Event band', 'event-band');
INSERT INTO public.band_members(band_id, user_id, role) VALUES
  (:'band', :'first_member', 'member'), (:'band', :'second_member', 'admin');

SET ROLE authenticated;
SET request.jwt.claim.role TO 'authenticated';
SET TIME ZONE 'America/Sao_Paulo';
INSERT INTO public.events(id, band_id, created_by, title, event_type, start_at)
VALUES (:'plain_event', :'band', :'creator', 'Rehearsal', 'rehearsal', '2027-03-04 22:15-03');
SELECT pg_temp.expect_error(format(
  'INSERT INTO public.events(band_id, created_by, title, event_type, start_at) VALUES (%L,%L,%L,%L,now())',
  :'band', :'first_member', 'Forged creator', 'show'), '42501');
SET request.jwt.claim.sub TO :'outsider';
SELECT pg_temp.expect_error(format(
  'INSERT INTO public.events(band_id, created_by, title, event_type, start_at) VALUES (%L,%L,%L,%L,now())',
  :'band', :'outsider', 'Outside band', 'show'), '42501');
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM public.notifications), 'outsider sees no notifications');
SET request.jwt.claim.sub TO :'creator';
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM public.notifications), 'creator excluded');
RESET ROLE;

-- Minimal Storage catalog fixture. The existing flyer candidate supplies the
-- real SQL column, trigger and policies for the attach-after-create flow.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text, public boolean, file_size_limit integer, allowed_mime_types text[]
);
CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
\ir ../../docs/event-flyers-candidate.sql
SELECT :'band' || '/' || :'flyer_event' || '/dddddddd-dddd-4ddd-8ddd-000000000001.png' AS flyer_path \gset
INSERT INTO storage.objects VALUES ('event-flyers', :'flyer_path', '{"size":100,"mimetype":"image/png"}');

SET ROLE authenticated;
INSERT INTO public.events(id, band_id, created_by, title, event_type, start_at)
VALUES (:'flyer_event', :'band', :'creator', repeat('x', 250), 'show', '2027-03-05 23:00Z');
UPDATE public.events
  SET flyer_path = :'flyer_path', title = 'Updated', description = 'New description',
      start_at = '2027-03-06 23:00Z', location = 'New venue'
  WHERE id = :'flyer_event';
SELECT pg_temp.check_that(
  (SELECT flyer_path = :'flyer_path' FROM public.events WHERE id = :'flyer_event'), 'flyer attached');
SELECT pg_temp.expect_error(format(
  'INSERT INTO public.events(id, band_id, created_by, title, event_type, start_at, flyer_path)
   VALUES (%L,%L,%L,%L,%L,now(),%L)',
  :'bad_flyer_event', :'band', :'creator', 'Invalid flyer insert', 'show', :'flyer_path'), '22023');
BEGIN;
INSERT INTO public.events(id, band_id, created_by, title, event_type, start_at)
VALUES (:'rolled_back', :'band', :'creator', 'Temporary', 'show', '2027-03-06 23:00Z');
ROLLBACK;

SET request.jwt.claim.sub TO :'first_member';
SELECT pg_temp.check_that(
  (SELECT count(*) = 2 AND bool_and(recipient_id = :'first_member') FROM public.notifications),
  'member sees only their own notifications');
SET request.jwt.claim.sub TO :'creator';
DELETE FROM public.events WHERE id = :'plain_event';
-- Reusing the old ID exercises deduplication even when the INSERT trigger fires.
INSERT INTO public.events(id, band_id, created_by, title, event_type, start_at)
VALUES (:'plain_event', :'band', :'creator', 'Replayed event', 'rehearsal', '2027-03-07 22:15Z');
DELETE FROM public.events WHERE id = :'plain_event';
RESET ROLE;

SELECT pg_temp.check_that(
  NOT EXISTS (SELECT FROM public.events WHERE id IN (:'plain_event', :'rolled_back', :'bad_flyer_event'))
  AND (SELECT count(*) = 4 AND count(DISTINCT (recipient_id, content_id)) = 4
    AND bool_and(recipient_id IN (:'first_member', :'second_member') AND band_id = :'band'
      AND kind = 'event_created' AND occurrence_id = content_id)
    AND count(*) FILTER (WHERE content_id = :'plain_event'
      AND message = 'Novo evento em Event band: Rehearsal (05/03/2027 01:15 UTC).') = 2
    AND count(*) FILTER (WHERE content_id = :'flyer_event'
      AND message LIKE '%(05/03/2027 23:00 UTC).') = 2
    FROM public.notifications),
  'one original snapshot per member and event, preserved after edits and deletion');
SELECT pg_temp.check_that(
  NOT has_function_privilege('authenticated', 'private.notify_event_creation()', 'EXECUTE'),
  'trigger function is private');
\echo PASS event notifications, optional flyer, permissions, deduplication and rollback
