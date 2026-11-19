-- node tests/postgres/notifications-isolated.cjs --task-assignments
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
\ir ../../supabase/migrations/20261111100000_restrict_member_removal_to_members.sql
\ir band-delete-dependencies.sql
\ir ../../docs/notifications-backend-candidate.sql
\ir ../../docs/notifications-task-assignments-candidate.sql

CREATE FUNCTION pg_temp.check_that(condition boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Failed: %', description;
  END IF;
END $$;
CREATE FUNCTION pg_temp.expect_denied(command text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE command;
  RAISE EXCEPTION 'Expected insufficient privilege';
EXCEPTION WHEN insufficient_privilege THEN
  RETURN;
END $$;

\set admin aaaaaaaa-aaaa-4aaa-8aaa-000000000001
\set first_member aaaaaaaa-aaaa-4aaa-8aaa-000000000002
\set second_member aaaaaaaa-aaaa-4aaa-8aaa-000000000003
\set outsider aaaaaaaa-aaaa-4aaa-8aaa-000000000004
\set band bbbbbbbb-bbbb-4bbb-8bbb-000000000001
INSERT INTO auth.users VALUES (:'admin'), (:'first_member'), (:'second_member'), (:'outsider');
SET request.jwt.claim.sub TO :'admin';
INSERT INTO public.bands(id, name, slug) VALUES (:'band', 'Task band', 'task-band');
INSERT INTO public.band_members(band_id, user_id, role) VALUES
  (:'band', :'first_member', 'member'), (:'band', :'second_member', 'member');

SET ROLE authenticated;
INSERT INTO public.tasks(band_id, created_by, title, status, priority, assigned_to)
VALUES (:'band', :'admin', 'Assigned', 'todo', 'low', :'first_member')
RETURNING id AS task \gset
INSERT INTO public.tasks(band_id, created_by, title, status, priority, assigned_to) VALUES
  (:'band', :'admin', 'No assignee', 'todo', 'low', NULL),
  (:'band', :'admin', 'Self assigned', 'todo', 'low', :'admin');
SELECT pg_temp.expect_denied(format(
  'UPDATE public.tasks SET assigned_to = %L WHERE id = %L', :'outsider', :'task'));
UPDATE public.tasks SET title = 'Renamed', description = 'Changed', priority = 'high',
  status = 'in_progress', assigned_to = :'first_member' WHERE id = :'task';
SET request.jwt.claim.sub TO :'first_member';
SELECT pg_temp.check_that(
  (SELECT count(*) = 1 AND bool_and(content_id = :'task' AND band_id = :'band')
   FROM public.notifications), 'initial assignment has the right recipient and link');

SET request.jwt.claim.sub TO :'admin';
UPDATE public.tasks SET assigned_to = :'second_member' WHERE id = :'task';
UPDATE public.tasks SET assigned_to = :'second_member' WHERE id = :'task';
SET request.jwt.claim.sub TO :'second_member';
SELECT pg_temp.check_that(
  (SELECT count(*) = 1 AND bool_and(recipient_id = :'second_member' AND content_id = :'task')
   FROM public.notifications), 'new assignee sees only their own notification');

SET request.jwt.claim.sub TO :'admin';
BEGIN;
UPDATE public.tasks SET assigned_to = :'first_member' WHERE id = :'task';
ROLLBACK;
SELECT pg_temp.check_that(
  (SELECT assigned_to = :'second_member' FROM public.tasks WHERE id = :'task'),
  'rollback restored assignee');

UPDATE public.tasks SET assigned_to = :'admin' WHERE id = :'task';
UPDATE public.tasks SET assigned_to = :'second_member' WHERE id = :'task';
DELETE FROM public.band_members WHERE band_id = :'band' AND user_id = :'second_member';
SELECT pg_temp.check_that(
  (SELECT assigned_to IS NULL FROM public.tasks WHERE id = :'task'),
  'membership removal clears the scalar assignment');
UPDATE public.tasks SET assigned_to = :'first_member' WHERE id = :'task';

SET request.jwt.claim.sub TO :'outsider';
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM public.notifications), 'outsider sees no notifications');
RESET ROLE;
RESET request.jwt.claim.sub;
INSERT INTO public.tasks(band_id, created_by, title, status, priority, assigned_to)
VALUES (:'band', :'admin', 'Maintenance write', 'todo', 'low', :'first_member');

SELECT pg_temp.check_that(
  (SELECT count(*) = 4
    AND count(*) FILTER (WHERE recipient_id = :'first_member') = 2
    AND count(*) FILTER (WHERE recipient_id = :'second_member') = 2
    AND count(DISTINCT occurrence_id) = 4
    AND bool_and(band_id = :'band' AND content_id = :'task' AND kind = 'task_assigned')
    FROM public.notifications),
  'only committed non-self assignments emitted, including reassignment to a prior recipient');
SELECT pg_temp.check_that(
  NOT has_function_privilege('authenticated', 'private.notify_task_assignment()', 'EXECUTE'),
  'trigger function is private');
\echo PASS task assignment notifications, isolation, removal and rollback
