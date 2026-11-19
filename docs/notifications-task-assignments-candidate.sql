-- Local candidate. Install after notifications-backend-candidate.sql as its
-- trusted owner. Relies on the tasks (band_id, assigned_to) membership FK and
-- the existing task RLS. Review both and any privileged task writers before
-- promotion.
--
-- Install only while tasks.assigned_to is the source of truth and
-- tasks_sync_assignees_legacy mirrors it into task_assignees. The documented
-- bridge skips unchanged assignments, replaces the mirror on a scalar change,
-- and rejects that change if the task has multiple rows in task_assignees. The mirror
-- write must not have a second notification trigger.
-- See stable-release-candidate.md and tests/postgres/band-delete-dependencies.sql.
-- Before promotion, verify there is no independent writer (RPC, trigger,
-- direct grant or job) and no task with a divergent mirror for either a null
-- or non-null assigned_to. The bridge being enabled alone proves neither.
-- If independent assignments are activated, emit from the set of newly added
-- users in that transaction and replace the scalar emitter for the same flow.
BEGIN;
SET LOCAL search_path = pg_catalog;

CREATE FUNCTION private.notify_task_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
BEGIN
  -- Skip unattributed maintenance writes, removals and self-assignment.
  IF actor IS NULL OR NEW.assigned_to IS NULL OR NEW.assigned_to = actor THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NULL;
  END IF;

  -- One identity per actual transition. Replaying the same assigned_to is
  -- a no-op, but unassigning or switching away and back is a new occurrence.
  PERFORM private.emit_notification(
    NEW.assigned_to, NEW.band_id, 'task_assigned', NEW.id, pg_catalog.gen_random_uuid(),
    'Uma tarefa foi atribuída a você.'
  );
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION private.notify_task_assignment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tasks_notify_assignment
AFTER INSERT OR UPDATE OF assigned_to ON public.tasks
FOR EACH ROW EXECUTE FUNCTION private.notify_task_assignment();

COMMIT;
