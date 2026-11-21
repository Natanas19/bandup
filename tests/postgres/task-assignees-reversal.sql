-- Fixture-only rehearsal included by the guarded activation scenario.
\if :isolated
\else
DO $$ BEGIN RAISE EXCEPTION 'Unexpected test cluster'; END $$;
\endif

CREATE FUNCTION pg_temp.require_scalar_assignments() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  LOCK TABLE public.tasks, public.task_assignees IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT FROM public.task_assignees GROUP BY task_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Scalar rollback would lose assignees';
  END IF;
END $$;

SET request.jwt.claim.role TO 'authenticated';
SET ROLE authenticated;
-- Change the authoritative singleton, leaving the legacy scalar stale.
SELECT public.bandup_save_task_v2(:'band', :'existing_task', 0, 'V2 edit', NULL, 'todo', 'low',
  NULL, :'event', ARRAY[:'second_member']::uuid[]);
SELECT public.bandup_save_task_v2(:'band', :'new_task', NULL, 'Unassigned', NULL, 'todo', 'low',
  NULL, NULL, ARRAY[]::uuid[]);
RESET ROLE;
CREATE TEMP TABLE before_reverse_tasks AS SELECT id, title, event_id, updated_at FROM public.tasks;
SELECT count(*) AS notifications_before_reverse FROM public.notifications \gset

-- Restore the known scalar fixture contract under the same locks as the guard.
BEGIN;
SET LOCAL lock_timeout = '3s';
SELECT pg_temp.require_scalar_assignments();
DROP TRIGGER tasks_bump_revision ON public.tasks;
ALTER TABLE public.tasks DISABLE TRIGGER tasks_set_updated_at;
UPDATE public.tasks t SET assigned_to = a.user_id
  FROM (SELECT task.id, link.user_id FROM public.tasks task LEFT JOIN public.task_assignees link
        ON (link.band_id, link.task_id) = (task.band_id, task.id)) a
  WHERE t.id = a.id AND t.assigned_to IS DISTINCT FROM a.user_id;
ALTER TABLE public.tasks ENABLE TRIGGER tasks_set_updated_at;
DROP FUNCTION public.bandup_save_task_v2(uuid,uuid,bigint,text,text,text,text,timestamptz,uuid,uuid[]);
DROP FUNCTION private.bump_task_revision();
ALTER TABLE public.tasks DROP COLUMN task_revision;
COMMENT ON COLUMN public.tasks.assigned_to IS NULL;
DROP INDEX public.task_assignees_user_band_task_idx;
DROP POLICY tasks_v2_admin_delete_guard ON public.tasks;
DROP POLICY task_assignees_v2_read ON public.task_assignees;
DROP POLICY task_assignees_v2_read_guard ON public.task_assignees;
REVOKE SELECT (band_id, task_id, user_id) ON public.task_assignees FROM authenticated;
GRANT INSERT, UPDATE ON public.tasks TO authenticated;
CREATE POLICY tasks_insert_for_band_members ON public.tasks FOR INSERT TO authenticated WITH CHECK (:insert_check);
CREATE POLICY tasks_update_for_admins_or_involved_members ON public.tasks FOR UPDATE TO authenticated
  USING (:update_using) WITH CHECK (:update_check);
:bridge_ddl;
:notify_ddl;
COMMIT;

SELECT pg_temp.check_that(NOT EXISTS (
  (SELECT * FROM assignment_api_grants EXCEPT SELECT * FROM legacy_grants)
  UNION ALL (SELECT * FROM legacy_grants EXCEPT SELECT * FROM assignment_api_grants)
), 'table and column ACLs restored');
CREATE TEMP TABLE restored_policies AS SELECT * FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('tasks', 'task_assignees');
SELECT pg_temp.check_that(NOT EXISTS (
  (SELECT * FROM restored_policies EXCEPT SELECT * FROM legacy_policies)
  UNION ALL (SELECT * FROM legacy_policies EXCEPT SELECT * FROM restored_policies)
), 'legacy RLS policies restored');
SELECT pg_temp.check_that(NOT EXISTS (
  (SELECT id, title, event_id, updated_at FROM public.tasks EXCEPT SELECT * FROM before_reverse_tasks)
  UNION ALL (SELECT * FROM before_reverse_tasks EXCEPT SELECT id, title, event_id, updated_at FROM public.tasks)
), 'scalar reversal preserves task metadata and events');
SELECT pg_temp.check_that((SELECT assigned_to = :'second_member' FROM public.tasks WHERE id = :'existing_task')
  AND (SELECT assigned_to IS NULL FROM public.tasks WHERE id = :'new_task'), 'scalar values rebuilt from V2');
SELECT pg_temp.check_that((SELECT count(*) = :'notifications_before_reverse'::bigint FROM public.notifications),
  'scalar reconstruction does not emit notifications');
SET ROLE authenticated;
SET request.jwt.claim.sub TO :'second_member';
SELECT pg_temp.check_that((SELECT count(*) = 1 FROM public.tasks WHERE assigned_to = :'second_member'),
  'legacy personal tasks read is restored');
SET request.jwt.claim.sub TO :'admin';
UPDATE public.tasks SET assigned_to = :'first_member' WHERE id = :'existing_task';
RESET ROLE;
SELECT pg_temp.check_that((SELECT count(*) = 1 AND bool_and(user_id = :'first_member')
  FROM public.task_assignees WHERE task_id = :'existing_task')
  AND (SELECT count(*) = :'notifications_before_reverse'::bigint + 1 FROM public.notifications),
  'restored legacy write mirrors and notifies once');
\echo PASS committed V2 reversed to scalar with singleton and unassigned tasks

\ir ../../docs/task-assignees-activate-candidate.sql
SET ROLE authenticated;
SELECT public.bandup_save_task_v2(:'band', :'existing_task', 0, 'Multiple', NULL, 'todo', 'low', NULL,
  :'event', ARRAY[:'first_member', :'second_member']::uuid[]);
RESET ROLE;
SELECT pg_temp.expect_error('SELECT pg_temp.require_scalar_assignments()', '55000');
CREATE TEMP TABLE before_pause_links AS SELECT * FROM public.task_assignees;
SELECT count(*) AS notifications_before_pause FROM public.notifications \gset

-- Containment after a simulated incident. Keep the V2 schema and read paths.
BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.tasks, public.task_assignees IN ACCESS EXCLUSIVE MODE;
REVOKE EXECUTE ON FUNCTION public.bandup_save_task_v2(uuid,uuid,bigint,text,text,text,text,timestamptz,uuid,uuid[])
  FROM authenticated;
REVOKE DELETE ON public.tasks FROM authenticated;
COMMIT;
SET ROLE authenticated;
SELECT pg_temp.expect_error(format('SELECT public.bandup_save_task_v2(%L,%L,1,''Failed'',NULL,''todo'',''low'',NULL,NULL,NULL)',
  :'band', :'existing_task'), '42501');
SELECT pg_temp.expect_error(format('DELETE FROM public.tasks WHERE id = %L', :'existing_task'), '42501');
SET request.jwt.claim.sub TO :'first_member';
SELECT pg_temp.check_that((SELECT count(*) = 1 FROM public.tasks t JOIN public.task_assignees a
  ON (a.band_id,a.task_id) = (t.band_id,t.id) WHERE a.user_id = :'first_member' AND t.id = :'existing_task'),
  'first personal task remains readable during pause');
SET request.jwt.claim.sub TO :'second_member';
SELECT pg_temp.check_that((SELECT count(*) = 1 FROM public.tasks t JOIN public.task_assignees a
  ON (a.band_id,a.task_id) = (t.band_id,t.id) WHERE a.user_id = :'second_member' AND t.id = :'existing_task'),
  'second personal task remains readable during pause');
RESET ROLE;

BEGIN;
GRANT EXECUTE ON FUNCTION public.bandup_save_task_v2(uuid,uuid,bigint,text,text,text,text,timestamptz,uuid,uuid[])
  TO authenticated;
GRANT DELETE ON public.tasks TO authenticated;
COMMIT;
SET ROLE authenticated;
SELECT public.bandup_save_task_v2(:'band', :'existing_task', 1, 'Recovered', NULL, 'todo', 'low', NULL,
  :'event', NULL);
RESET ROLE;
SELECT pg_temp.check_that(NOT EXISTS (
  (SELECT * FROM public.task_assignees EXCEPT SELECT * FROM before_pause_links)
  UNION ALL (SELECT * FROM before_pause_links EXCEPT SELECT * FROM public.task_assignees)
), 'pause and recovery preserve every assignment');
SELECT pg_temp.check_that((SELECT count(*) = :'notifications_before_pause'::bigint FROM public.notifications)
  AND (SELECT event_id = :'event' AND title = 'Recovered' FROM public.tasks WHERE id = :'existing_task'),
  'V2 resumes with no duplicate notifications and preserves the event');
\echo PASS scalar rollback refused after multiple links; V2 pause and resumption preserve assignments
