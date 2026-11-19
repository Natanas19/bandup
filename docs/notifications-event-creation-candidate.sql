-- Local candidate. Install after notifications-backend-candidate.sql as its
-- trusted owner with full visibility of band membership. Review effective
-- event INSERT policies (especially created_by = auth.uid()), membership ACLs,
-- and privileged event writers before promotion. Imports also fire this trigger.
BEGIN;
SET LOCAL search_path = pg_catalog;

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
