-- PROPOSAL ONLY. This removes feature metadata, NOT memberships already approved.
BEGIN;
DO $execution_disabled$
BEGIN
  RAISE EXCEPTION 'Band entry rollback requires separate review, backup and approval; execution disabled';
END;
$execution_disabled$;
SET LOCAL lock_timeout='5s';
DROP FUNCTION public.bandup_set_discovery(UUID,TEXT,TEXT,BOOLEAN);
DROP FUNCTION public.bandup_get_discovery(UUID);
DROP FUNCTION public.bandup_discover_bands(UUID,INTEGER);
DROP FUNCTION public.bandup_request_entry(UUID,TEXT);
DROP FUNCTION public.bandup_cancel_entry(UUID);
DROP FUNCTION public.bandup_decide_entry(UUID,TEXT);
DROP TABLE public.band_join_requests;
DROP TABLE public.band_join_directory;
-- No CASCADE. Unexpected dependents must abort this transaction.
COMMIT;
