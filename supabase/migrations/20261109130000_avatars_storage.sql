-- REVIEW ONLY. Not applied. Reconcile migration history and inspect existing
-- Storage policies before any separately authorized application (never db push).
-- Public images, immutable UUID attempts; retries never overwrite/delete photos.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DO $verify_avatar_bucket$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'avatars'
      AND name = 'avatars'
      AND public IS TRUE
      AND file_size_limit = 2097152
      AND cardinality(allowed_mime_types) = 3
      AND allowed_mime_types @> ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION 'Existing avatars bucket configuration differs; review it before applying this migration';
  END IF;
END;
$verify_avatar_bucket$;

-- Public object delivery is intentional. Listing/info/insert remain owner-scoped.
-- No UPDATE or DELETE policy is added: completion never overwrites or cleans up
-- an object based on an ambiguous Auth/Storage response. Existing permissive
-- policies, grants, global size limits and effective RLS must be audited first.
CREATE POLICY avatars_select_own_object
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name ~ ('^' || (SELECT auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$')
  );

CREATE POLICY avatars_insert_own_object
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND name ~ ('^' || (SELECT auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$')
  );

COMMIT;
