-- LOCAL REVIEW CANDIDATE. Do not apply automatically or use db push.
-- Reconcile the Demo migration history separately before any remote application.
BEGIN;

CREATE FUNCTION public.bandup_leave_band(p_band_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
SET lock_timeout = '3s'
AS $$
DECLARE
  actor UUID := auth.uid();
  membership public.band_members%ROWTYPE;
  successor_id UUID;
  affected BIGINT;
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication required';
  END IF;
  -- Decisions below need fresh snapshots after serialization.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '25000', MESSAGE = 'READ COMMITTED required';
  END IF;

  -- Lock before reading associations. Busy, absent and inaccessible bands use
  -- the same public error so lock contention cannot disclose a hidden band.
  BEGIN
    PERFORM b.id FROM public.bands AS b WHERE b.id = p_band_id
    FOR UPDATE OF b NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band unavailable';
  END;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band unavailable';
  END IF;

  SELECT bm.* INTO membership FROM public.band_members AS bm
  WHERE bm.band_id = p_band_id AND bm.user_id = actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band unavailable';
  END IF;

  -- Direct admin UPDATE/DELETE paths may lock membership before the parent.
  -- NOWAIT avoids waiting in the reverse order (and selecting a younger member
  -- because the oldest is busy). No SKIP LOCKED, no partial retry in this RPC.
  BEGIN
    PERFORM bm.id FROM public.band_members AS bm
    WHERE bm.band_id = p_band_id ORDER BY bm.id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    -- Propagate an exception, never a success-shaped result: partial locks in
    -- this block are rolled back and the RPC aborts before promotion/removal.
    RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'Membership busy; retry later';
  END;

  SELECT bm.* INTO membership FROM public.band_members AS bm
  WHERE bm.band_id = p_band_id AND bm.user_id = actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band unavailable';
  END IF;

  IF membership.role = 'admin' AND NOT EXISTS (
    SELECT 1 FROM public.band_members AS bm
    WHERE bm.band_id = p_band_id AND bm.role = 'admin' AND bm.id <> membership.id
  ) THEN
    SELECT bm.id INTO successor_id FROM public.band_members AS bm
    WHERE bm.band_id = p_band_id AND bm.id <> membership.id
    ORDER BY bm.created_at ASC, bm.id ASC LIMIT 1;
    IF successor_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'PBL01', MESSAGE = 'Cannot leave without another member';
    END IF;
    UPDATE public.band_members SET role = 'admin'
    WHERE id = successor_id AND band_id = p_band_id AND role = 'member';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Membership changed';
    END IF;
  END IF;

  -- The trigger reuses our parent lock in this same transaction; promotion is
  -- already visible to its last-admin check. Keep the existing trigger enabled:
  -- it protects the last admin and clears
  -- assigned_to without deleting tasks. Any exception rolls back promotion too.
  DELETE FROM public.band_members
  WHERE id = membership.id AND band_id = p_band_id AND user_id = actor;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Membership changed';
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', 'left', 'administration_transferred', successor_id IS NOT NULL);
END;
$$;

ALTER FUNCTION public.bandup_leave_band(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_leave_band(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_leave_band(UUID) TO authenticated;
COMMENT ON FUNCTION public.bandup_leave_band(UUID) IS
  'Leaves only the authenticated caller membership; atomically promotes the oldest successor when required.';
COMMIT;
