-- Local candidate. Requires the public identity migration and a reviewed target schema.
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_roles
    WHERE rolname = 'bandup_public_identity_reader'
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls
        OR rolcreatedb OR rolcreaterole OR rolreplication)
  ) OR NOT EXISTS (
    SELECT FROM pg_class
    WHERE oid = 'public.bands'::regclass AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT FROM pg_class AS profile
    JOIN pg_roles AS owner ON owner.oid = profile.relowner
    WHERE profile.oid = to_regclass('public.public_band_profiles')
      AND profile.relkind = 'v' AND owner.rolname = 'bandup_public_identity_reader'
  ) OR to_regprocedure('private.is_band_admin(uuid)') IS NULL
    OR has_any_column_privilege('anon', 'public.bands', 'SELECT')
    OR has_schema_privilege('bandup_public_identity_reader', 'public', 'CREATE')
    OR EXISTS (
      SELECT FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS api(role_name)
      WHERE pg_has_role(api.role_name::name, 'bandup_public_identity_reader', 'MEMBER')
    ) THEN
    RAISE EXCEPTION 'Unexpected public band identity contract';
  END IF;
END;
$preflight$;

CREATE TABLE public.band_public_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL REFERENCES public.bands (id) ON DELETE CASCADE,
  platform text NOT NULL,
  label text,
  url text NOT NULL,
  position smallint NOT NULL,
  CONSTRAINT band_public_links_label_check CHECK (
    label IS NULL OR (char_length(label) BETWEEN 1 AND 80
      AND label COLLATE "C" !~ '[[:cntrl:]]' AND btrim(label) <> '')
  ),
  -- Canonical lowercase HTTPS authority with DNS labels, without ports or credentials.
  -- Encode non-ASCII path/query characters and use ASCII (Punycode) for IDN hosts.
  CONSTRAINT band_public_links_https_url_check CHECK (
    char_length(url) BETWEEN 1 AND 2048
    AND char_length(substring(url FROM '^https://([^/?#]+)')) <= 253
    AND url COLLATE "C" ~ $url$^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?([/?#]([a-zA-Z0-9._~!$&'()*+,;=:@/?#-]|%[0-9a-fA-F]{2})*)?$$url$
  ),
  CONSTRAINT band_public_links_platform_check CHECK (
    CASE platform COLLATE "C"
      WHEN 'spotify' THEN substring(url FROM '^https://([^/?#]+)') IN ('open.spotify.com')
      WHEN 'instagram' THEN substring(url FROM '^https://([^/?#]+)') IN ('instagram.com', 'www.instagram.com')
      WHEN 'youtube' THEN substring(url FROM '^https://([^/?#]+)') IN ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be')
      WHEN 'tiktok' THEN substring(url FROM '^https://([^/?#]+)') IN ('tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com')
      WHEN 'custom' THEN true
      ELSE false
    END
  ),
  -- Eight unique slots enforce the quota even when inserts race.
  -- A single UPDATE can swap positions. Multi-statement moves can defer the check.
  CONSTRAINT band_public_links_position_check CHECK (position BETWEEN 1 AND 8),
  CONSTRAINT band_public_links_band_position_key UNIQUE (band_id, position)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE FUNCTION private.guard_band_public_link_band() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $guard$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A public link cannot move to another band';
END;
$guard$;

REVOKE ALL ON FUNCTION private.guard_band_public_link_band() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER band_public_links_keep_band
AFTER UPDATE ON public.band_public_links
FOR EACH ROW WHEN (OLD.band_id IS DISTINCT FROM NEW.band_id)
EXECUTE FUNCTION private.guard_band_public_link_band();

ALTER TABLE public.band_public_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.band_public_links FROM PUBLIC, anon, authenticated, service_role, bandup_public_identity_reader;
GRANT SELECT, DELETE ON public.band_public_links TO authenticated;
GRANT INSERT (band_id, platform, label, url, position),
  UPDATE (platform, label, url, position) ON public.band_public_links TO authenticated;

CREATE POLICY band_public_links_manage_as_admin
ON public.band_public_links FOR ALL TO authenticated
USING (private.is_band_admin(band_id))
WITH CHECK (private.is_band_admin(band_id));

GRANT SELECT (id) ON public.bands TO bandup_public_identity_reader;
GRANT SELECT (band_id, platform, label, url, position)
ON public.band_public_links TO bandup_public_identity_reader;

CREATE POLICY band_public_links_select_for_identity_reader
ON public.band_public_links FOR SELECT TO bandup_public_identity_reader
USING (EXISTS (
  SELECT FROM public.bands AS band
  WHERE band.id = band_public_links.band_id AND band.is_public IS TRUE
));

GRANT CREATE ON SCHEMA public TO bandup_public_identity_reader;

CREATE VIEW public.public_band_links
WITH (security_barrier = true, security_invoker = false)
AS
SELECT band.slug, link.platform, link.label, link.url, link.position
FROM public.band_public_links AS link
JOIN public.bands AS band ON band.id = link.band_id
WHERE band.is_public IS TRUE;

REVOKE ALL ON public.public_band_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_band_links TO anon;

DO $view_owner$
DECLARE
  reader_oid oid := 'bandup_public_identity_reader'::regrole;
  executor_oid oid := CURRENT_USER::regrole;
  needs_set_grant boolean := NOT pg_has_role(executor_oid, reader_oid, 'SET');
  memberships_before jsonb;
  memberships_after jsonb;
BEGIN
  IF needs_set_grant THEN
    -- PostgreSQL 17 locks the target role before looking up a REVOKE grant.
    -- Self-membership is forbidden, so this only takes that transaction lock.
    REVOKE bandup_public_identity_reader FROM bandup_public_identity_reader
      GRANTED BY CURRENT_USER RESTRICT;
    needs_set_grant := NOT pg_has_role(executor_oid, reader_oid, 'SET');
  END IF;

  SELECT jsonb_agg(to_jsonb(membership) ORDER BY membership.oid)
  INTO memberships_before
  FROM pg_auth_members AS membership
  WHERE membership.roleid = reader_oid AND membership.member = executor_oid;

  IF needs_set_grant THEN
    IF EXISTS (
      SELECT FROM pg_auth_members
      WHERE roleid = reader_oid AND member = executor_oid AND grantor = executor_oid
    ) THEN
      RAISE EXCEPTION 'Executor already granted this role membership; refusing to change it';
    END IF;

    GRANT bandup_public_identity_reader TO CURRENT_USER
      WITH SET TRUE, INHERIT FALSE, ADMIN FALSE GRANTED BY CURRENT_USER;
  END IF;

  ALTER VIEW public.public_band_links OWNER TO bandup_public_identity_reader;

  IF needs_set_grant THEN
    REVOKE bandup_public_identity_reader FROM CURRENT_USER GRANTED BY CURRENT_USER RESTRICT;
  END IF;

  SELECT jsonb_agg(to_jsonb(membership) ORDER BY membership.oid)
  INTO memberships_after
  FROM pg_auth_members AS membership
  WHERE membership.roleid = reader_oid AND membership.member = executor_oid;

  IF memberships_after IS DISTINCT FROM memberships_before THEN
    RAISE EXCEPTION 'Public identity reader memberships changed during view ownership transfer';
  END IF;
END;
$view_owner$;

REVOKE CREATE ON SCHEMA public FROM bandup_public_identity_reader;

DO $postconditions$
BEGIN
  IF has_any_column_privilege('anon', 'public.band_public_links', 'SELECT')
    OR has_any_column_privilege('anon', 'public.bands', 'SELECT')
    OR has_column_privilege('authenticated', 'public.band_public_links', 'band_id', 'UPDATE')
    OR has_table_privilege('bandup_public_identity_reader', 'public.band_public_links', 'SELECT')
    OR has_table_privilege('bandup_public_identity_reader', 'public.bands', 'SELECT')
    OR has_schema_privilege('bandup_public_identity_reader', 'public', 'CREATE')
    OR NOT has_table_privilege('anon', 'public.public_band_links', 'SELECT') THEN
    RAISE EXCEPTION 'Unexpected public band links privileges';
  END IF;
END;
$postconditions$;

COMMIT;
