-- LOCAL REVIEW ONLY: do not apply automatically. Demo-specific public origin.
-- Reconcile remote migration history and audit effective policies before applying.
BEGIN;
-- Bound installation waits on the shared application's tables. An error must
-- abort the whole transaction; never continue/reapply fragments manually.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE api_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'public.bands'::regclass AND relrowsecurity)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'public.band_members'::regclass AND relrowsecurity)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'storage.objects'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'Expected application and Storage RLS to be enabled';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_schema_privilege(api_role, 'private', 'CREATE')
      OR pg_catalog.pg_has_role(api_role, 'postgres', 'MEMBER')
      OR pg_catalog.has_parameter_privilege(api_role, 'session_replication_role', 'SET')
      OR pg_catalog.has_table_privilege(api_role, 'public.bands', 'TRIGGER,TRUNCATE') THEN
      RAISE EXCEPTION 'Unexpected effective API privileges; review grants separately';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated')
    AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unexpected application role bypass of RLS';
  END IF;
END $preflight$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('band-logos', 'band-logos', true, 2097152,
        ARRAY['image/jpeg','image/png','image/webp']::text[])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'band-logos'
    AND name = 'band-logos' AND public IS TRUE AND file_size_limit = 2097152
    AND cardinality(allowed_mime_types) = 3
    AND allowed_mime_types @> ARRAY['image/jpeg','image/png','image/webp']::text[]) THEN
    RAISE EXCEPTION 'Unexpected band-logos bucket configuration';
  END IF;
END $$;

CREATE FUNCTION private.band_logo_band_id(p_path text) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    THEN pg_catalog.split_part(p_path, '/', 1)::uuid ELSE NULL END;
$$;

-- These locks cover this SQL authorization transaction only. Storage may run
-- permission probes inside rolled-back savepoints; they cannot serialize the
-- complete network upload. The association RPC rechecks authorization separately.
CREATE FUNCTION private.authorize_band_logo_insert(p_path text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = off
SET lock_timeout = '3s' AS $$
DECLARE target uuid := private.band_logo_band_id(p_path); actor uuid := auth.uid();
BEGIN
  IF target IS NULL OR actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN RETURN false; END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '25000', MESSAGE = 'READ COMMITTED required';
  END IF;
  IF NOT private.is_band_admin(target) THEN RETURN false; END IF;
  PERFORM id FROM public.bands WHERE id = target FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM id FROM public.band_members WHERE band_id = target AND user_id = actor FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN false; END IF;
  -- A new READ COMMITTED query after the locks, including direct demotions.
  RETURN EXISTS (SELECT 1 FROM public.band_members
    WHERE band_id = target AND user_id = actor AND role = 'admin');
END $$;

-- Read-only wrapper: parser and existing association helpers remain internal.
CREATE FUNCTION private.can_read_band_logo(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = off AS $$
  SELECT auth.role() = 'authenticated' AND auth.uid() IS NOT NULL
    AND private.is_band_admin(private.band_logo_band_id(p_path));
$$;

-- A single-use transaction-local capability, never writable by API roles.
-- Avoids spoofable custom GUC flags and does not rely on column grants alone.
CREATE TABLE private.band_logo_write_permits (
  band_id uuid NOT NULL,
  transaction_id bigint NOT NULL,
  logo_url text NOT NULL,
  PRIMARY KEY (band_id, transaction_id)
);
ALTER TABLE private.band_logo_write_permits OWNER TO postgres;
ALTER TABLE private.band_logo_write_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.band_logo_write_permits FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_band_logo_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = off AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.logo_url IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Use band logo association';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id AND (NEW.logo_url IS NOT NULL OR OLD.logo_url IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band identity cannot change with a logo';
  END IF;
  -- Legacy URLs remain readable and unrelated edits remain compatible.
  IF NEW.logo_url IS NOT DISTINCT FROM OLD.logo_url THEN RETURN NEW; END IF;
  DELETE FROM private.band_logo_write_permits
  WHERE band_id = NEW.id AND transaction_id = pg_catalog.txid_current()
    AND logo_url = NEW.logo_url;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Use band logo association';
  END IF;
  RETURN NEW;
END $$;
-- AFTER sees the final tuple produced by all BEFORE triggers. Raising here
-- rolls back the write and creator-trigger side effects in the same transaction.
CREATE TRIGGER bands_guard_logo_write AFTER INSERT OR UPDATE ON public.bands
FOR EACH ROW EXECUTE FUNCTION private.guard_band_logo_write();

CREATE FUNCTION public.bandup_set_band_logo(p_band_id uuid, p_object_path text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = off
SET lock_timeout = '3s' AS $$
DECLARE
  actor uuid := auth.uid(); object_metadata jsonb; target_url text; changed bigint;
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band unavailable';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '25000', MESSAGE = 'READ COMMITTED required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.band_members
    WHERE band_id = p_band_id AND user_id = actor AND role = 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band unavailable';
  END IF;
  PERFORM id FROM public.bands WHERE id = p_band_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band unavailable'; END IF;
  PERFORM id FROM public.band_members WHERE band_id = p_band_id ORDER BY id FOR UPDATE NOWAIT;
  IF NOT EXISTS (SELECT 1 FROM public.band_members
    WHERE band_id = p_band_id AND user_id = actor AND role = 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Band unavailable';
  END IF;
  IF private.band_logo_band_id(p_object_path) IS DISTINCT FROM p_band_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid band logo';
  END IF;
  SELECT metadata INTO object_metadata FROM storage.objects
  WHERE bucket_id = 'band-logos' AND name = p_object_path FOR SHARE NOWAIT;
  IF NOT FOUND OR object_metadata->>'mimetype' NOT IN ('image/jpeg','image/png','image/webp')
    OR object_metadata->>'mimetype' IS NULL
    OR COALESCE(object_metadata->>'size', '') !~ '^[0-9]{1,7}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid band logo';
  END IF;
  IF (object_metadata->>'size')::bigint NOT BETWEEN 1 AND 2097152
    OR (object_metadata->>'mimetype' = 'image/jpeg' AND p_object_path !~ '[.]jpg$')
    OR (object_metadata->>'mimetype' = 'image/png' AND p_object_path !~ '[.]png$')
    OR (object_metadata->>'mimetype' = 'image/webp' AND p_object_path !~ '[.]webp$') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid band logo';
  END IF;
  -- Intentionally fixed to the reviewed Demo origin; never accept a caller URL.
  target_url := 'https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/band-logos/' || p_object_path;
  IF EXISTS (SELECT 1 FROM public.bands WHERE id = p_band_id AND logo_url = target_url) THEN RETURN target_url; END IF;
  INSERT INTO private.band_logo_write_permits VALUES (p_band_id, pg_catalog.txid_current(), target_url);
  UPDATE public.bands SET logo_url = target_url WHERE id = p_band_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 OR EXISTS (SELECT 1 FROM private.band_logo_write_permits
    WHERE band_id = p_band_id AND transaction_id = pg_catalog.txid_current())
    OR NOT EXISTS (SELECT 1 FROM public.bands WHERE id = p_band_id AND logo_url = target_url) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Band logo association unconfirmed';
  END IF;
  RETURN target_url;
END $$;

ALTER FUNCTION private.band_logo_band_id(text) OWNER TO postgres;
ALTER FUNCTION private.authorize_band_logo_insert(text) OWNER TO postgres;
ALTER FUNCTION private.can_read_band_logo(text) OWNER TO postgres;
ALTER FUNCTION private.guard_band_logo_write() OWNER TO postgres;
ALTER FUNCTION public.bandup_set_band_logo(uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.band_logo_band_id(text), private.authorize_band_logo_insert(text), private.can_read_band_logo(text),
  private.guard_band_logo_write(), public.bandup_set_band_logo(uuid,text)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.authorize_band_logo_insert(text), private.can_read_band_logo(text),
  public.bandup_set_band_logo(uuid,text) TO authenticated;

CREATE POLICY band_logos_insert_admin ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'band-logos');
CREATE POLICY band_logos_select_admin ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'band-logos');
-- Restrictive bucket gates also prevent unrelated permissive ALL policies from
-- enabling mutation/moving objects into this bucket. Other buckets are unchanged.
CREATE POLICY band_logos_insert_gate ON storage.objects AS RESTRICTIVE FOR INSERT TO PUBLIC
WITH CHECK (bucket_id <> 'band-logos' OR CURRENT_USER = 'authenticated');
CREATE POLICY band_logos_select_gate ON storage.objects AS RESTRICTIVE FOR SELECT TO PUBLIC
USING (bucket_id <> 'band-logos' OR CURRENT_USER = 'authenticated');
-- PUBLIC gates contain no private function references: EXECUTE is checked when
-- expressions initialize, regardless of boolean short-circuiting. Admin checks
-- apply only to the role actually granted EXECUTE. CASE keeps locking side
-- effects away from other buckets; no duplicate helper call in permissive rules.
CREATE POLICY band_logos_insert_authorization ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (CASE WHEN bucket_id = 'band-logos' THEN private.authorize_band_logo_insert(name) ELSE true END);
CREATE POLICY band_logos_select_authorization ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (CASE WHEN bucket_id = 'band-logos' THEN private.can_read_band_logo(name) ELSE true END);
CREATE POLICY band_logos_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO PUBLIC
USING (bucket_id <> 'band-logos') WITH CHECK (bucket_id <> 'band-logos');
CREATE POLICY band_logos_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO PUBLIC
USING (bucket_id <> 'band-logos');

-- REVOKE alone does not remove privileges inherited through another role.
-- Fail closed instead of silently rewriting existing role memberships/grants.
DO $verify_acls$
DECLARE api_role text; signature text; allowed boolean;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_table_privilege(api_role, 'private.band_logo_write_permits',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR pg_catalog.has_any_column_privilege(api_role, 'private.band_logo_write_permits',
        'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Unexpected effective access to band logo permits';
    END IF;
    FOREACH signature IN ARRAY ARRAY[
      'private.band_logo_band_id(text)', 'private.authorize_band_logo_insert(text)',
      'private.can_read_band_logo(text)', 'private.guard_band_logo_write()',
      'public.bandup_set_band_logo(uuid,text)'
    ] LOOP
      allowed := api_role = 'authenticated' AND signature IN (
        'private.authorize_band_logo_insert(text)', 'private.can_read_band_logo(text)',
        'public.bandup_set_band_logo(uuid,text)');
      IF pg_catalog.has_function_privilege(api_role, signature, 'EXECUTE') IS DISTINCT FROM allowed
        OR pg_catalog.has_function_privilege(api_role, signature, 'EXECUTE WITH GRANT OPTION') THEN
        RAISE EXCEPTION 'Unexpected effective band logo function privileges';
      END IF;
    END LOOP;
  END LOOP;
END $verify_acls$;
COMMIT;
