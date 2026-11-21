-- node tests/postgres/notifications-isolated.cjs --task-event-link
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

CREATE FUNCTION pg_temp.check_that(condition boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %', description; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_fk_error(command text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE command;
  RAISE EXCEPTION 'Expected foreign_key_violation';
EXCEPTION WHEN foreign_key_violation THEN
  RETURN;
END $$;

\set admin 10000000-0000-0000-0000-000000000001
\set member 10000000-0000-0000-0000-000000000002
\set outsider 10000000-0000-0000-0000-000000000003
\set band 20000000-0000-0000-0000-000000000001
\set other_band 20000000-0000-0000-0000-000000000002
\set event 30000000-0000-0000-0000-000000000001
\set foreign_event 30000000-0000-0000-0000-000000000002
\set existing_task 40000000-0000-0000-0000-000000000001
\set new_task 40000000-0000-0000-0000-000000000002

INSERT INTO auth.users VALUES (:'admin'), (:'member'), (:'outsider');
SET request.jwt.claim.sub TO :'outsider';
INSERT INTO public.bands(id, name, slug) VALUES (:'other_band', 'Other band', 'other-band');
SET request.jwt.claim.sub TO :'admin';
INSERT INTO public.bands(id, name, slug) VALUES (:'band', 'Test band', 'test-band');
INSERT INTO public.band_members(band_id, user_id, role) VALUES (:'band', :'member', 'member');
INSERT INTO public.events(id, band_id, created_by, title, event_type, start_at) VALUES
  (:'event', :'band', :'admin', 'Existing event', 'show', now()),
  (:'foreign_event', :'other_band', :'outsider', 'Other event', 'show', now());
INSERT INTO public.tasks(id, band_id, created_by, assigned_to, title, priority, status)
VALUES (:'existing_task', :'band', :'admin', :'member', 'Existing task', 'low', 'todo');

\ir ../../docs/task-event-link-candidate.sql

SELECT pg_temp.check_that(to_regclass('public.events_band_id_id_key') IS NOT NULL
  AND to_regclass('public.tasks_band_id_event_id_idx') IS NOT NULL, 'both indexes exist');
SELECT pg_temp.check_that((SELECT event_id IS NULL FROM public.tasks WHERE id = :'existing_task'),
  'existing task stays unlinked');
SELECT pg_temp.check_that((SELECT count(*) = 2 FROM public.events), 'existing events preserved');

SET ROLE authenticated;
SET request.jwt.claim.role TO 'authenticated';
SET request.jwt.claim.sub TO :'member';
SELECT pg_temp.expect_fk_error(format('UPDATE public.tasks SET event_id = %L WHERE id = %L',
  :'foreign_event', :'existing_task'));
UPDATE public.tasks SET event_id = :'event' WHERE id = :'existing_task';
UPDATE public.tasks SET event_id = NULL WHERE id = :'existing_task';
SELECT pg_temp.check_that((SELECT event_id IS NULL FROM public.tasks WHERE id = :'existing_task'),
  'assignee can unlink');
UPDATE public.tasks SET event_id = :'event' WHERE id = :'existing_task';
INSERT INTO public.tasks(id, band_id, created_by, title, priority, status, event_id)
VALUES (:'new_task', :'band', :'member', 'New task', 'medium', 'todo', :'event');
SELECT pg_temp.check_that((SELECT count(*) = 2 FROM public.tasks WHERE event_id = :'event'),
  'new and existing tasks can share one event');
WITH removed AS (DELETE FROM public.events WHERE id = :'event' RETURNING id)
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM removed), 'non-admin cannot delete event');

SET request.jwt.claim.sub TO :'outsider';
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM public.tasks), 'outsider cannot read related tasks');
WITH changed AS (UPDATE public.tasks SET event_id = NULL WHERE id = :'existing_task' RETURNING id)
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM changed), 'outsider cannot unlink');

SET request.jwt.claim.sub TO :'admin';
UPDATE public.events SET title = 'Edited event' WHERE id = :'event';
SELECT pg_temp.check_that((SELECT count(*) = 2 FROM public.tasks WHERE event_id = :'event'),
  'editing event keeps tasks linked');
DELETE FROM public.events WHERE id = :'event';
SELECT pg_temp.check_that((SELECT count(*) = 2 AND bool_and(event_id IS NULL AND band_id = :'band')
  FROM public.tasks), 'event deletion only clears the relation');
SELECT pg_temp.check_that((SELECT assigned_to = :'member' AND title = 'Existing task'
  FROM public.tasks WHERE id = :'existing_task'), 'task content and assignee retained');
RESET ROLE;

-- Exercise a target that already provides the required uniqueness.
ALTER TABLE public.tasks DROP COLUMN event_id;
ALTER TABLE public.events DROP CONSTRAINT events_band_id_id_key;
CREATE UNIQUE INDEX existing_event_key ON public.events (id, band_id);
\ir ../../docs/task-event-link-candidate.sql
SELECT pg_temp.check_that(to_regclass('public.events_band_id_id_key') IS NULL
  AND (SELECT conindid = 'public.existing_event_key'::regclass FROM pg_constraint
      WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_event_same_band_fkey'),
  'existing composite unique index reused');
\echo PASS task/event link, RLS, unlink, event deletion and existing key reuse
