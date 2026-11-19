-- Local candidate. Install after 20261112180000_band_delete.sql where both apply:
-- its installation preflight rejects the additional FK to bands. The installed
-- deletion RPC deletes the band row, which cascades to notifications.
-- Run as the trusted migration owner, with access to auth.users and auth.uid().
BEGIN;
SET LOCAL search_path = pg_catalog;

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

COMMIT;
