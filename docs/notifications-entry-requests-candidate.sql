-- Local candidate. Deploy after notifications-backend-candidate.sql.
-- The request RPC is recorded in bandup_rpc_definicoes_instaladas.sql and
-- 20261105190000_all_bands_search_review.sql. The complete decision RPC body
-- is unavailable locally, as is the full cancellation RPC. Review the exact
-- bodies, owners, EXECUTE grants and nested writers before promotion.
-- Cancellation and the invitation candidate's superseded transition do not emit.
-- A privileged backfill inserting pending rows or deciding existing requests
-- will emit. Review maintenance writers, inherited request/membership grants
-- and exposed SECURITY DEFINER routes before installing.
BEGIN;
SET LOCAL search_path = pg_catalog;

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

COMMIT;
