-- Keep administrator DELETE access scoped to ordinary band members.
-- This changes the existing policy instead of adding a permissive DELETE policy.
ALTER POLICY band_members_delete_for_admins
ON public.band_members
USING (
  private.is_band_member(band_id)
  AND private.is_band_admin(band_id)
  AND role = 'member'
);
