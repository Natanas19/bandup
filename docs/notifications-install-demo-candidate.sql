-- Local installation candidate. Run only after explicit authorization.
-- Review the installed band deletion RPC and catalog preflight first.
-- Execute as postgres in one SQL Editor submission. For psql, use -X -v ON_ERROR_STOP=1.
-- Do not run fragments or use migration ledger tooling.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;

DO $band_delete_dependency$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_proc
    WHERE oid = to_regprocedure('public.bandup_delete_band(uuid,text,uuid)')
      AND prosecdef AND pg_get_userbyid(proowner) = 'postgres'
      AND has_function_privilege('authenticated', oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Install requires the reviewed band deletion RPC first';
  END IF;
END
$band_delete_dependency$;

-- Source: docs/notifications-backend-candidate.sql
-- Local candidate. Install after 20261112180000_band_delete.sql where both apply:
-- its installation preflight rejects the additional FK to bands. The installed
-- deletion RPC deletes the band row, which cascades to notifications.
-- Run as the trusted migration owner, with access to auth.users and auth.uid().

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  content_id uuid NOT NULL,
  occurrence_id uuid NOT NULL,
  message text NOT NULL CHECK (
    pg_catalog.char_length(message) BETWEEN 1 AND 240 AND message ~ '[^[:space:]]'
  ),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  read_at timestamptz,
  UNIQUE (recipient_id, kind, occurrence_id)
);

COMMENT ON COLUMN public.notifications.content_id IS
  'Typed by kind. May outlive its target. Resolve using current target authorization.';
COMMENT ON COLUMN public.notifications.occurrence_id IS
  'Stable per committed source occurrence. Reuse for retries, allocate a new ID for a distinct occurrence.';

CREATE INDEX notifications_recent_idx
  ON public.notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx
  ON public.notifications (recipient_id)
  WHERE read_at IS NULL;
CREATE INDEX notifications_band_idx
  ON public.notifications (band_id)
  WHERE band_id IS NOT NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notifications TO authenticated;
CREATE POLICY notifications_recipient_select ON public.notifications
  FOR SELECT TO authenticated USING (recipient_id = (SELECT auth.uid()));

CREATE FUNCTION public.bandup_mark_notification_read(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
BEGIN
  UPDATE public.notifications
     SET read_at = pg_catalog.statement_timestamp()
   WHERE id = p_notification_id AND recipient_id = actor AND read_at IS NULL;
  RETURN FOUND;
END;
$function$;

CREATE FUNCTION public.bandup_mark_all_notifications_read()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  marked bigint;
BEGIN
  UPDATE public.notifications
     SET read_at = pg_catalog.statement_timestamp()
   WHERE recipient_id = actor AND read_at IS NULL;
  GET DIAGNOSTICS marked = ROW_COUNT;
  RETURN marked;
END;
$function$;

-- Called only by trusted backend code after it derives the recipients and
-- occurrence from the authorized source action. The owner already has INSERT.
CREATE FUNCTION private.emit_notification(
  p_recipient_id uuid,
  p_band_id uuid,
  p_kind text,
  p_content_id uuid,
  p_occurrence_id uuid,
  p_message text
)
RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  INSERT INTO public.notifications (recipient_id, band_id, kind, content_id, occurrence_id, message)
  VALUES (p_recipient_id, p_band_id, p_kind, p_content_id, p_occurrence_id, p_message)
  ON CONFLICT (recipient_id, kind, occurrence_id) DO NOTHING;
$function$;

REVOKE ALL ON FUNCTION public.bandup_mark_notification_read(uuid),
  public.bandup_mark_all_notifications_read(),
  private.emit_notification(uuid, uuid, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_mark_notification_read(uuid),
  public.bandup_mark_all_notifications_read() TO authenticated;

-- Source: docs/notifications-entry-requests-candidate.sql
-- Local candidate. Deploy after notifications-backend-candidate.sql.
-- The request RPC is recorded in bandup_rpc_definicoes_instaladas.sql and
-- 20261105190000_all_bands_search_review.sql. The complete decision RPC body
-- is unavailable locally, as is the full cancellation RPC. Review the exact
-- bodies, owners, EXECUTE grants and nested writers before promotion.
-- Cancellation and the invitation candidate's superseded transition do not emit.
-- A privileged backfill inserting pending rows or deciding existing requests
-- will emit. Review maintenance writers, inherited request/membership grants
-- and exposed SECURITY DEFINER routes before installing.

DO $preflight$
DECLARE
  api_role text;
BEGIN
  IF to_regprocedure('public.bandup_request_entry(uuid,text)') IS NULL
    OR to_regprocedure('public.bandup_decide_entry(uuid,text)') IS NULL
    OR to_regprocedure('private.emit_notification(uuid,uuid,text,uuid,uuid,text)') IS NULL
    OR NOT EXISTS (
      SELECT FROM pg_class
      WHERE oid = 'public.band_join_requests'::regclass AND relrowsecurity
    )
  THEN
    RAISE EXCEPTION 'Entry RPCs, emitter and request RLS are required';
  END IF;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_any_column_privilege(api_role, 'public.band_join_requests', 'INSERT,UPDATE')
      OR has_table_privilege(api_role, 'public.band_join_requests', 'TRIGGER')
    THEN
      RAISE EXCEPTION 'Unexpected direct entry request write or trigger grant for %', api_role;
    END IF;
  END LOOP;
END
$preflight$;

CREATE FUNCTION private.notify_band_entry_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      PERFORM private.emit_notification(
        member.user_id, NEW.band_id, 'entry_request_created', NEW.id, NEW.id,
        'Nova solicitação de entrada na banda.'
      )
      FROM public.band_members AS member
      WHERE member.band_id = NEW.band_id AND member.role = 'admin';
    END IF;
  ELSIF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    -- Both outcomes share a deduplication key. A request can be decided once.
    PERFORM private.emit_notification(
      NEW.requester_id, NEW.band_id, 'entry_request_decided', NEW.id, NEW.id,
      CASE NEW.status
        WHEN 'approved' THEN 'Sua solicitação de entrada foi aprovada.'
        ELSE 'Sua solicitação de entrada foi recusada.'
      END
    );
  END IF;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION private.notify_band_entry_request()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER band_join_requests_notify
AFTER INSERT OR UPDATE OF status ON public.band_join_requests
FOR EACH ROW EXECUTE FUNCTION private.notify_band_entry_request();

-- Source: docs/notifications-task-assignments-candidate.sql
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

-- Source: docs/notifications-event-creation-candidate.sql
-- Local candidate. Install after notifications-backend-candidate.sql as its
-- trusted owner with full visibility of band membership. Review effective
-- event INSERT policies (especially created_by = auth.uid()), membership ACLs,
-- and privileged event writers before promotion. Imports also fire this trigger.

CREATE FUNCTION private.notify_event_creation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  event_message text;
BEGIN
  -- Keep the creation-time schedule independent of the session time zone.
  SELECT pg_catalog.format(
    'Novo evento em %s: %s (%s UTC).',
    pg_catalog.left(band.name, 70),
    pg_catalog.left(NEW.title, 100),
    pg_catalog.to_char(NEW.start_at AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI')
  ) INTO STRICT event_message
  FROM public.bands AS band
  WHERE band.id = NEW.band_id;

  PERFORM private.emit_notification(
    member.user_id, NEW.band_id, 'event_created', NEW.id, NEW.id, event_message
  )
  FROM public.band_members AS member
  WHERE member.band_id = NEW.band_id AND member.user_id <> NEW.created_by;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION private.notify_event_creation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER events_notify_creation
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION private.notify_event_creation();

COMMIT;
