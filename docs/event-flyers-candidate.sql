-- Candidate only. Apply after reviewing the destination's event RLS and Storage grants.
BEGIN;
SET LOCAL search_path = pg_catalog;

ALTER TABLE public.events ADD COLUMN flyer_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-flyers', 'event-flyers', false, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']);

-- Client uploads are immutable. Readers can access only the current attachment.
-- Unlinked objects (failed uploads, replacements, removals and cascaded deletes)
-- remain private. Purge via the Storage API in a separate maintenance window
-- with uploads and linking paused, after rechecking each object is unreferenced.
CREATE FUNCTION private.can_access_event_flyer(p_path text, p_upload boolean)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = off AS $$
  SELECT auth.role() = 'authenticated'
    AND p_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = CASE WHEN split_part(p_path, '/', 2) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        THEN split_part(p_path, '/', 2)::uuid END
        AND e.band_id::text = split_part(p_path, '/', 1)
        AND private.is_band_member(e.band_id)
        AND CASE WHEN p_upload THEN (e.created_by = auth.uid() OR private.is_band_admin(e.band_id))
          ELSE e.flyer_path = p_path END
    );
$$;

-- An AFTER trigger validates the final row even for direct API writes. Existing
-- event policies remain in force. Use a conditional UPDATE on the old flyer_path
-- for replace/remove to detect concurrent edits. Object rows are locked during
-- validation; a missing or invalid upload cannot replace the existing flyer.
CREATE FUNCTION private.validate_event_flyer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp SET row_security = off AS $$
DECLARE
  membership_role text;
  object_metadata jsonb;
  filename text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.flyer_path IS NULL THEN RETURN NEW; END IF;
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Save the event before attaching a flyer';
  END IF;
  IF (NEW.flyer_path IS NOT NULL OR OLD.flyer_path IS NOT NULL)
    AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.band_id IS DISTINCT FROM OLD.band_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Event identity cannot change with a flyer';
  END IF;
  IF NEW.flyer_path IS NOT DISTINCT FROM OLD.flyer_path THEN RETURN NEW; END IF;
  SELECT bm.role INTO membership_role FROM public.band_members bm
    WHERE bm.band_id = OLD.band_id AND bm.user_id = auth.uid() FOR SHARE NOWAIT;
  IF auth.role() IS DISTINCT FROM 'authenticated' OR NOT FOUND
    OR (membership_role IS DISTINCT FROM 'admin' AND OLD.created_by IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Event flyer unavailable';
  END IF;
  IF NEW.flyer_path IS NULL THEN RETURN NEW; END IF;

  filename := split_part(NEW.flyer_path, '/', 3);
  IF NEW.flyer_path <> NEW.band_id::text || '/' || NEW.id::text || '/' || filename
    OR filename !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid event flyer path';
  END IF;
  SELECT metadata INTO object_metadata FROM storage.objects
    WHERE bucket_id = 'event-flyers' AND name = NEW.flyer_path FOR SHARE NOWAIT;
  IF NOT FOUND OR COALESCE(object_metadata->>'size', '') !~ '^[0-9]{1,7}$'
    OR (object_metadata->>'mimetype') IS DISTINCT FROM (CASE split_part(filename, '.', 2)
      WHEN 'jpg' THEN 'image/jpeg' WHEN 'png' THEN 'image/png' WHEN 'webp' THEN 'image/webp' END) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid event flyer object';
  END IF;
  IF (object_metadata->>'size')::integer NOT BETWEEN 1 AND 2097152 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid event flyer size';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.can_access_event_flyer(text, boolean) OWNER TO postgres;
ALTER FUNCTION private.validate_event_flyer() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.can_access_event_flyer(text, boolean), private.validate_event_flyer()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_access_event_flyer(text, boolean) TO authenticated;

CREATE TRIGGER events_validate_flyer AFTER INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION private.validate_event_flyer();

CREATE POLICY event_flyers_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'event-flyers');
CREATE POLICY event_flyers_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'event-flyers');
CREATE POLICY event_flyers_insert_role ON storage.objects AS RESTRICTIVE FOR INSERT TO PUBLIC
WITH CHECK (bucket_id IS DISTINCT FROM 'event-flyers' OR CURRENT_USER = 'authenticated');
CREATE POLICY event_flyers_select_role ON storage.objects AS RESTRICTIVE FOR SELECT TO PUBLIC
USING (bucket_id IS DISTINCT FROM 'event-flyers' OR CURRENT_USER = 'authenticated');
CREATE POLICY event_flyers_insert_scope ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (CASE WHEN bucket_id = 'event-flyers' THEN private.can_access_event_flyer(name, true) ELSE true END);
CREATE POLICY event_flyers_select_scope ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (CASE WHEN bucket_id = 'event-flyers' THEN private.can_access_event_flyer(name, false) ELSE true END);
CREATE POLICY event_flyers_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
USING (bucket_id IS DISTINCT FROM 'event-flyers') WITH CHECK (bucket_id IS DISTINCT FROM 'event-flyers');
CREATE POLICY event_flyers_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO PUBLIC
USING (bucket_id IS DISTINCT FROM 'event-flyers');

COMMIT;
