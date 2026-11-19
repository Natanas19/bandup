-- Used only after the disposable cluster identity gate and deletion fixture.
-- Synthetic writers let the smoke test exercise the actual installed triggers.
ALTER TABLE public.band_join_requests ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.bandup_request_entry(p_band_id uuid, p_applicant_name text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.band_join_requests(band_id, requester_id, applicant_name)
  VALUES (p_band_id, auth.uid(), p_applicant_name) RETURNING id;
$$;
CREATE FUNCTION public.bandup_decide_entry(p_request_id uuid, p_decision text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.band_join_requests SET status = p_decision,
    decided_at = clock_timestamp(), decided_by = auth.uid()
  WHERE id = p_request_id AND status = 'pending';
$$;

CREATE FUNCTION private.test_event_collision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NULL; END $$;
CREATE TRIGGER events_notify_creation AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION private.test_event_collision();

-- Intentionally ignore only this expected failure to inspect after the
-- consolidated script's COMMIT rolls the aborted transaction back.
\set ON_ERROR_STOP off
\ir ../../docs/notifications-install-demo-candidate.sql
\set ON_ERROR_STOP on

DO $assert_rollback$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL
    OR to_regprocedure('public.bandup_mark_notification_read(uuid)') IS NOT NULL
    OR to_regprocedure('public.bandup_mark_all_notifications_read()') IS NOT NULL
    OR to_regprocedure('private.emit_notification(uuid,uuid,text,uuid,uuid,text)') IS NOT NULL
    OR to_regprocedure('private.notify_band_entry_request()') IS NOT NULL
    OR to_regprocedure('private.notify_task_assignment()') IS NOT NULL
    OR to_regprocedure('private.notify_event_creation()') IS NOT NULL
    OR EXISTS (SELECT FROM pg_trigger WHERE tgname IN ('band_join_requests_notify', 'tasks_notify_assignment'))
    OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid = 'public.events'::regclass AND tgname = 'events_notify_creation')
  THEN RAISE EXCEPTION 'Consolidated install did not fully roll back'; END IF;
END
$assert_rollback$;
\echo PASS late trigger collision rolled back the entire consolidated installation

DROP TRIGGER events_notify_creation ON public.events;
DROP FUNCTION private.test_event_collision();
\ir ../../docs/notifications-install-demo-candidate.sql
