DROP POLICY IF EXISTS events_delete_for_admins_or_creators ON public.events;

CREATE POLICY events_delete_for_admins
ON public.events FOR DELETE TO authenticated
USING (
  private.is_band_member(band_id)
  AND private.is_band_admin(band_id)
);
