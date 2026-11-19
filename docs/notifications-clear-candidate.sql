-- Incremental candidate for an existing notifications installation.
-- Apply once as the trusted owner of public.notifications after contract review.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = pg_catalog;

ALTER TABLE public.notifications ADD COLUMN cleared_at timestamptz;

COMMENT ON COLUMN public.notifications.cleared_at IS
  'Archive timestamp. Feed and unread queries must filter cleared_at IS NULL. Retain rows for occurrence deduplication.';

-- Reuse the same database-clock cutoff for retries. Capture it before reading
-- the feed/count that enables clearing. The RPC never marks notifications read.
CREATE FUNCTION public.bandup_clear_read_notifications(p_cutoff timestamptz)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  archive_time timestamptz := pg_catalog.statement_timestamp();
  archived bigint;
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Notification clearing requires an authenticated user';
  END IF;
  IF p_cutoff IS NULL OR NOT pg_catalog.isfinite(p_cutoff) OR p_cutoff > archive_time THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid notification cutoff';
  END IF;

  UPDATE public.notifications
     SET cleared_at = archive_time
   WHERE recipient_id = actor
     AND cleared_at IS NULL
     AND created_at <= p_cutoff
     AND read_at <= p_cutoff;
  GET DIAGNOSTICS archived = ROW_COUNT;
  RETURN archived;
END;
$function$;

REVOKE ALL ON FUNCTION public.bandup_clear_read_notifications(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_clear_read_notifications(timestamptz) TO authenticated;

COMMIT;
