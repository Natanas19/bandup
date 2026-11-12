-- Simulation only, in a newly initialized private PostgreSQL cluster.
-- No Supabase Auth/Storage services or real users/files are involved.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE logo_acl_fixture NOLOGIN;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '');
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL UNIQUE, public boolean NOT NULL DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id), name text NOT NULL,
  metadata jsonb, UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;

CREATE SCHEMA logo_test_support;
REVOKE ALL ON SCHEMA logo_test_support FROM PUBLIC;
CREATE TABLE logo_test_support.manifest (run_id text NOT NULL PRIMARY KEY);
CREATE FUNCTION logo_test_support.assert_true(value boolean, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Local assertion failed: %', label; END IF;
END $$;
GRANT USAGE ON SCHEMA logo_test_support TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION logo_test_support.assert_true(boolean,text) TO anon, authenticated, service_role;
