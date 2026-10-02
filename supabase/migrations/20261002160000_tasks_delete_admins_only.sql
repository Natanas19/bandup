DROP POLICY IF EXISTS tasks_delete_for_admins_or_creators ON public.tasks;

CREATE POLICY tasks_delete_for_admins
ON public.tasks FOR DELETE TO authenticated
USING (
  private.is_band_member(band_id)
  AND private.is_band_admin(band_id)
);
