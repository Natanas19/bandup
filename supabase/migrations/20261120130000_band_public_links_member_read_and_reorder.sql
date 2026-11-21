BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

CREATE POLICY band_public_links_select_for_members
ON public.band_public_links FOR SELECT TO authenticated
USING (private.is_band_member(band_id));

CREATE FUNCTION public.bandup_swap_public_link_positions(
  p_band_id uuid,
  p_first_id uuid,
  p_first_position integer,
  p_second_id uuid,
  p_second_position integer
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $swap$
DECLARE
  matched_count integer;
BEGIN
  IF p_band_id IS NULL OR p_first_id IS NULL OR p_second_id IS NULL
    OR p_first_id = p_second_id
    OR p_first_position IS NULL OR p_second_position IS NULL
    OR p_first_position NOT BETWEEN 1 AND 8 OR p_second_position NOT BETWEEN 1 AND 8
    OR p_first_position = p_second_position THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid band, link IDs or expected positions';
  END IF;

  IF private.is_band_admin(p_band_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only a band admin may reorder public links';
  END IF;

  -- Lock by immutable ID so overlapping swaps take row locks in the same order.
  PERFORM link.id
  FROM public.band_public_links AS link
  WHERE link.band_id = p_band_id
    AND ((link.id = p_first_id AND link.position = p_first_position)
      OR (link.id = p_second_id AND link.position = p_second_position))
  ORDER BY link.id
  FOR UPDATE;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  IF matched_count <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Public link positions no longer match';
  END IF;

  -- The deferrable unique constraint checks both new positions at statement end.
  UPDATE public.band_public_links AS link
  SET position = CASE
    WHEN link.id = p_first_id THEN p_second_position
    ELSE p_first_position
  END
  WHERE link.band_id = p_band_id AND link.id IN (p_first_id, p_second_id);

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  IF matched_count <> 2 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Public link positions no longer match';
  END IF;
END;
$swap$;

REVOKE ALL ON FUNCTION public.bandup_swap_public_link_positions(uuid, uuid, integer, uuid, integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_swap_public_link_positions(uuid, uuid, integer, uuid, integer)
TO authenticated;

COMMIT;
