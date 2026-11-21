-- node tests/postgres/notifications-isolated.cjs --multi-assignees
SELECT current_database() = 'postgres' AND current_user = 'postgres'
  AND inet_server_addr() = '127.0.0.1'::inet AND inet_server_port() = :'test_port'::int
  AND lower(replace(current_setting('data_directory'), chr(92), '/')) = lower(:'test_data') AS isolated \gset
\if :isolated
\else
DO $$ BEGIN RAISE EXCEPTION 'Unexpected test cluster'; END $$;
\endif

\ir band-delete-bootstrap.sql
\ir ../../supabase/migrations/20261001000000_initial_bandup_schema.sql
\ir ../../supabase/migrations/20261002160000_tasks_delete_admins_only.sql
\ir ../../supabase/migrations/20261002200000_tasks_optional_event_link.sql
\ir ../../supabase/migrations/20261111100000_restrict_member_removal_to_members.sql
\ir ../../supabase/migrations/20261111140000_bandup_leave_band.sql
\ir band-delete-dependencies.sql
ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;
\ir ../../docs/notifications-backend-candidate.sql
\ir ../../docs/notifications-task-assignments-candidate.sql

CREATE FUNCTION pg_temp.check_that(condition boolean, description text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %', description; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_error(command text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE command;
  RAISE EXCEPTION 'Expected SQLSTATE %', expected_state;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> expected_state THEN RAISE; END IF;
END $$;
\set admin 10000000-0000-0000-0000-000000000001
\set first_member 10000000-0000-0000-0000-000000000002
\set second_member 10000000-0000-0000-0000-000000000003
\set outsider 10000000-0000-0000-0000-000000000004
\set band 20000000-0000-0000-0000-000000000001
\set event 30000000-0000-0000-0000-000000000001
\set existing_task 40000000-0000-0000-0000-000000000001
\set new_task 40000000-0000-0000-0000-000000000002

INSERT INTO auth.users VALUES (:'admin'), (:'first_member'), (:'second_member'), (:'outsider');
SET request.jwt.claim.sub TO :'admin';
INSERT INTO public.bands(id, name, slug) VALUES (:'band', 'Test band', 'test-band');
INSERT INTO public.band_members(band_id, user_id, role) VALUES
  (:'band', :'first_member', 'member'), (:'band', :'second_member', 'member');
INSERT INTO public.events(id, band_id, created_by, title, event_type, start_at)
VALUES (:'event', :'band', :'admin', 'Event', 'show', now());
INSERT INTO public.tasks(id, band_id, created_by, title, status, priority, assigned_to, event_id)
VALUES (:'existing_task', :'band', :'admin', 'Existing', 'todo', 'low', :'first_member', :'event');

\if :{?multi_reversal}
-- Simulate the known scalar installation with a band-scoped read policy.
GRANT SELECT ON public.task_assignees TO authenticated;
CREATE POLICY fixture_assignment_read ON public.task_assignees FOR SELECT TO authenticated
  USING (private.is_band_member(band_id));
CREATE TEMP VIEW assignment_api_grants AS
SELECT c.relname, a.attname, acl.grantee, acl.privilege_type, acl.is_grantable
FROM pg_class c
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
CROSS JOIN LATERAL aclexplode(a.attacl) acl
WHERE c.oid IN ('public.tasks'::regclass, 'public.task_assignees'::regclass)
UNION
SELECT c.relname, NULL, acl.grantee, acl.privilege_type, acl.is_grantable
FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
WHERE c.oid IN ('public.tasks'::regclass, 'public.task_assignees'::regclass);
CREATE TEMP TABLE legacy_grants AS SELECT * FROM assignment_api_grants;
CREATE TEMP TABLE legacy_policies AS SELECT * FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('tasks', 'task_assignees');
SELECT pg_get_triggerdef(oid) AS bridge_ddl FROM pg_trigger
  WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'tasks_sync_assignees_legacy' \gset
SELECT pg_get_triggerdef(oid) AS notify_ddl FROM pg_trigger
  WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'tasks_notify_assignment' \gset
SELECT with_check AS insert_check FROM legacy_policies WHERE policyname = 'tasks_insert_for_band_members' \gset
SELECT qual AS update_using, with_check AS update_check FROM legacy_policies
  WHERE policyname = 'tasks_update_for_admins_or_involved_members' \gset
\else
-- Exercise the Demo table grant plus direct grants on columns and on PUBLIC.
GRANT TRUNCATE, TRIGGER, REFERENCES ON public.tasks TO authenticated;
GRANT TRUNCATE, TRIGGER, REFERENCES ON public.tasks, public.task_assignees TO PUBLIC;
GRANT REFERENCES (id) ON public.tasks TO authenticated, PUBLIC;
GRANT REFERENCES (task_id) ON public.task_assignees TO anon, service_role, PUBLIC;

CREATE ROLE fixture_inherited_ddl NOLOGIN;
GRANT fixture_inherited_ddl TO authenticated;
GRANT REFERENCES (task_id) ON public.task_assignees TO fixture_inherited_ddl;
\set ON_ERROR_STOP off
\ir ../../docs/task-assignees-activate-candidate.sql
\set ON_ERROR_STOP on
SELECT pg_temp.check_that(:'LAST_ERROR_MESSAGE' = 'Unexpected effective task write or DDL privileges',
  'inherited column grant stops cutover');
SELECT pg_temp.check_that(
  to_regprocedure('public.bandup_save_task_v2(uuid,uuid,bigint,text,text,text,text,timestamptz,uuid,uuid[])') IS NULL
  AND NOT EXISTS (
    SELECT FROM pg_attribute WHERE attrelid = 'public.tasks'::regclass
      AND attname = 'task_revision' AND NOT attisdropped
  )
  AND (SELECT count(*) = 2 FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass AND tgenabled = 'O'
    AND tgname IN ('tasks_sync_assignees_legacy', 'tasks_notify_assignment'))
  AND has_table_privilege('authenticated', 'public.tasks', 'INSERT')
  AND has_column_privilege('authenticated', 'public.task_assignees', 'task_id', 'REFERENCES'),
  'aborted cutover preserves the scalar schema, triggers and grants');
REVOKE fixture_inherited_ddl FROM authenticated;
\echo PASS inherited REFERENCES blocks V2 and rolls back the cutover
\endif

\ir ../../docs/task-assignees-activate-candidate.sql

SELECT pg_temp.check_that(NOT EXISTS (
  SELECT FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS api(role_name)
  CROSS JOIN unnest(ARRAY['public.tasks', 'public.task_assignees']) AS targets(table_name)
  WHERE has_table_privilege(role_name, table_name, 'TRUNCATE,TRIGGER')
    OR has_any_column_privilege(role_name, table_name, 'REFERENCES,INSERT,UPDATE')
), 'all API roles lose effective DDL and direct write privileges on both tables');
SELECT pg_temp.check_that(
  has_table_privilege('authenticated', 'public.tasks', 'SELECT')
  AND has_table_privilege('authenticated', 'public.tasks', 'DELETE')
  AND has_column_privilege('authenticated', 'public.task_assignees', 'user_id', 'SELECT')
  AND has_function_privilege('authenticated',
    'public.bandup_save_task_v2(uuid,uuid,bigint,text,text,text,text,timestamptz,uuid,uuid[])', 'EXECUTE'),
  'legitimate client grants are retained');

\if :{?multi_reversal}
\ir task-assignees-reversal.sql
\else
CREATE FUNCTION pg_temp.save(band uuid, task uuid, revision bigint, assignees uuid[], event uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.bandup_save_task_v2(band, task, revision, 'Saved', NULL, 'todo', 'low', NULL, event, assignees);
$$;

SELECT pg_temp.check_that((SELECT task_revision = 0 AND event_id = :'event' AND title = 'Existing'
  FROM public.tasks WHERE id = :'existing_task'), 'activation preserves existing task and event');
SELECT pg_temp.check_that((SELECT count(*) = 1 AND bool_and(user_id = :'first_member')
  FROM public.task_assignees), 'existing assignment preserved');
SELECT pg_temp.expect_error(format('UPDATE public.tasks SET assigned_to = %L WHERE id = %L',
  :'second_member', :'existing_task'), '55000');

SET ROLE authenticated;
SET request.jwt.claim.role TO 'authenticated';
SELECT pg_temp.expect_error('UPDATE public.tasks SET title = ''legacy''', '42501');
SELECT pg_temp.expect_error('INSERT INTO public.tasks DEFAULT VALUES', '42501');
SELECT pg_temp.expect_error('DELETE FROM public.task_assignees', '42501');
SELECT pg_temp.expect_error(format('SELECT pg_temp.save(%L,%L,0,ARRAY[%L]::uuid[])',
  :'band', :'existing_task', :'outsider'), '23503');

-- Explicit snapshot of all current members, with duplicate input collapsed.
SELECT pg_temp.save(:'band', :'existing_task', 0,
  ARRAY[:'admin', :'first_member', :'second_member', :'second_member']::uuid[], :'event');
SELECT pg_temp.check_that((SELECT count(*) = 3 FROM public.task_assignees WHERE task_id = :'existing_task'),
  'all current members assigned exactly once');
SELECT pg_temp.expect_error(format('SELECT pg_temp.save(%L,%L,0,NULL)', :'band', :'existing_task'), '40001');

SET request.jwt.claim.sub TO :'first_member';
SELECT pg_temp.check_that((SELECT count(*) = 1 FROM public.tasks t JOIN public.task_assignees a
  ON (a.band_id, a.task_id) = (t.band_id, t.id) WHERE a.user_id = :'first_member'), 'personal task read via assignment');
SELECT pg_temp.expect_error(format('SELECT pg_temp.save(%L,%L,1,ARRAY[]::uuid[])',
  :'band', :'existing_task'), '42501');
SELECT pg_temp.save(:'band', :'existing_task', 1, NULL, :'event');
WITH removed AS (DELETE FROM public.tasks WHERE id = :'existing_task' RETURNING id)
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM removed), 'assignee cannot delete task');

SET request.jwt.claim.sub TO :'second_member';
SELECT pg_temp.save(:'band', :'existing_task', 2, NULL, :'event');
SELECT pg_temp.check_that((SELECT count(*) = 1 FROM public.notifications WHERE content_id = :'existing_task'),
  'only the newly added recipient is notified');

SET request.jwt.claim.sub TO :'outsider';
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM public.task_assignees), 'outsider cannot list links');
SELECT pg_temp.expect_error(format('SELECT pg_temp.save(%L,%L,3,NULL)', :'band', :'existing_task'), '42501');

SET request.jwt.claim.sub TO :'first_member';
SELECT pg_temp.save(:'band', :'new_task', NULL, ARRAY[]::uuid[], :'event');
SELECT pg_temp.check_that(pg_temp.save(:'band', :'new_task', NULL, NULL)->>'status' = 'already_exists',
  'create retry does not duplicate or overwrite');
SELECT pg_temp.save(:'band', :'new_task', 0, ARRAY[:'second_member']::uuid[], :'event');
RESET ROLE;
SELECT pg_temp.check_that((SELECT count(*) = 2 FROM public.notifications WHERE content_id = :'existing_task')
  AND (SELECT count(*) = 1 FROM public.notifications WHERE content_id = :'new_task')
  AND NOT EXISTS (SELECT FROM public.notifications WHERE recipient_id = :'admin'),
  'no notifications for unchanged sets or self-assignment');

-- A second connection holds a task lock and then a membership lock.
CREATE EXTENSION dblink;
SELECT format('host=127.0.0.1 port=%s dbname=postgres user=postgres connect_timeout=5', :'test_port') AS connection \gset
SELECT dblink_connect('writer', :'connection');
SELECT dblink_exec('writer', 'BEGIN');
SELECT dblink_exec('writer', format('DO $lock$ BEGIN PERFORM 1 FROM public.tasks WHERE id = %L FOR UPDATE; END $lock$', :'existing_task'));
SET ROLE authenticated;
SET request.jwt.claim.sub TO :'admin';
SELECT pg_temp.expect_error(format('SELECT pg_temp.save(%L,%L,3,NULL)', :'band', :'existing_task'), '55P03');
RESET ROLE;
SELECT dblink_exec('writer', 'ROLLBACK');
SELECT dblink_exec('writer', 'BEGIN');
SELECT dblink_exec('writer', format('DO $lock$ BEGIN PERFORM 1 FROM public.band_members WHERE user_id = %L FOR UPDATE; END $lock$', :'first_member'));
SET ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT pg_temp.save(%L,%L,3,ARRAY[%L]::uuid[])',
  :'band', :'existing_task', :'first_member'), '55P03');
RESET ROLE;
SELECT dblink_exec('writer', 'ROLLBACK');
SELECT dblink_disconnect('writer');

SET ROLE authenticated;
SET request.jwt.claim.sub TO :'first_member';
SELECT public.bandup_leave_band(:'band');
RESET ROLE;
SELECT pg_temp.check_that((SELECT count(*) = 2 AND bool_and(user_id <> :'first_member')
  FROM public.task_assignees WHERE task_id = :'existing_task'), 'leave removes only departing assignee');
SELECT pg_temp.check_that((SELECT assigned_to IS NULL AND event_id = :'event'
  FROM public.tasks WHERE id = :'existing_task'), 'legacy cleanup still succeeds and preserves event');

SET ROLE authenticated;
SET request.jwt.claim.sub TO :'admin';
SELECT task_revision AS revision FROM public.tasks WHERE id = :'existing_task' \gset
SELECT pg_temp.save(:'band', :'existing_task', :'revision', ARRAY[:'admin', :'second_member']::uuid[], :'event');
SELECT task_revision AS revision FROM public.tasks WHERE id = :'existing_task' \gset
BEGIN;
SELECT pg_temp.save(:'band', :'existing_task', :'revision', ARRAY[]::uuid[], :'event');
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM public.task_assignees WHERE task_id = :'existing_task'),
  'empty array clears all links');
SELECT pg_temp.save(:'band', :'existing_task', (:'revision'::bigint + 1), ARRAY[:'second_member']::uuid[], :'event');
ROLLBACK;
RESET ROLE;
SELECT pg_temp.check_that((SELECT count(*) = 2 FROM public.task_assignees WHERE task_id = :'existing_task')
  AND (SELECT count(*) = 2 FROM public.notifications WHERE content_id = :'existing_task'),
  'rollback restores links and notifications');
SET ROLE authenticated;
DELETE FROM public.tasks WHERE id = :'existing_task';
RESET ROLE;
SELECT pg_temp.check_that(NOT EXISTS (SELECT FROM public.task_assignees WHERE task_id = :'existing_task'),
  'admin deletion cascades assignment links');
\echo PASS multi-assignee activation, RLS, RPC, concurrency, notifications and member exit
\endif
