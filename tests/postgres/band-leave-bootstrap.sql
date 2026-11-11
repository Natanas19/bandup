-- Local disposable PostgreSQL 17 only. Use the guarded runner, not a SQL editor.
-- No Supabase connection, data, passwords, Storage, Auth service or migrations history.
BEGIN;
DO $check$
BEGIN
  IF current_database() IS DISTINCT FROM 'bandup_leave_test'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_port() IS DISTINCT FROM 5433
    OR session_user IS DISTINCT FROM 'postgres'
    OR current_user IS DISTINCT FROM 'postgres'
    OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
  THEN RAISE EXCEPTION 'Wrong disposable test destination'; END IF;
  IF to_regnamespace('auth') IS NOT NULL OR to_regnamespace('private') IS NOT NULL
    OR to_regnamespace('bandup_leave_test_support') IS NOT NULL
    OR to_regclass('public.bands') IS NOT NULL
    OR to_regclass('public.band_members') IS NOT NULL
    OR to_regclass('public.tasks') IS NOT NULL
    OR to_regprocedure('public.bandup_leave_band(uuid)') IS NOT NULL
  THEN RAISE EXCEPTION 'Bootstrap requires unused test object names; nothing is overwritten'; END IF;
END $check$;

CREATE SCHEMA bandup_leave_test_support;
REVOKE ALL ON SCHEMA bandup_leave_test_support FROM PUBLIC;
CREATE TABLE bandup_leave_test_support.manifest(name text PRIMARY KEY, value text NOT NULL);
INSERT INTO bandup_leave_test_support.manifest VALUES ('environment', 'bandup-leave-local-v1');
DO $roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['authenticated', 'anon', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
      INSERT INTO bandup_leave_test_support.manifest VALUES ('created-role:' || role_name, role_name);
    ELSE
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name AND
        (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = role_name))
      THEN RAISE EXCEPTION 'Existing test role has incompatible privileges'; END IF;
    END IF;
  END LOOP;
  IF NOT has_schema_privilege('authenticated', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'Public schema USAGE required; bootstrap will not change existing schema grants';
  END IF;
END $roles$;

CREATE SCHEMA auth;
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA auth, private FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
-- Test-only Auth shims. Claims are set by the harness, never current_user.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '');
$$;
REVOKE ALL ON FUNCTION auth.uid(), auth.role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated;

CREATE TABLE public.bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  slug text NOT NULL UNIQUE
);
CREATE TABLE public.band_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(band_id, user_id)
);
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL, status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  FOREIGN KEY(band_id, assigned_to) REFERENCES public.band_members(band_id, user_id)
);
REVOKE ALL ON public.bands, public.band_members, public.tasks FROM PUBLIC, authenticated, anon, service_role;
-- All membership mutations under test run through the privileged RPC, or as
-- postgres for fixtures/lock holders. No application RLS policies are installed.
ALTER TABLE public.bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Exact trigger function copies from 20261001000000_initial_bandup_schema.sql
-- are appended below and checked by the static preparation tests.
CREATE OR REPLACE FUNCTION private.add_band_creator_as_admin()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'A band must be created by an authenticated user';
  END IF;

  INSERT INTO public.band_members (band_id, user_id, role)
  VALUES (NEW.id, (SELECT auth.uid()), 'admin');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.add_band_creator_as_admin()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER bands_add_creator_as_admin
AFTER INSERT ON public.bands
FOR EACH ROW
EXECUTE FUNCTION private.add_band_creator_as_admin();

-- Prevent removing or demoting the last admin; lock the band row to serialize
-- concurrent membership changes. Band deletion cascades are allowed to proceed.
CREATE OR REPLACE FUNCTION private.prevent_last_band_admin_removal()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  remaining_admins BIGINT;
  must_check_last_admin BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Change membership by removing and adding the member';
  END IF;

  IF TG_OP = 'DELETE' OR NEW.band_id IS DISTINCT FROM OLD.band_id THEN
    UPDATE public.tasks
    SET assigned_to = NULL
    WHERE band_id = OLD.band_id
      AND assigned_to = OLD.user_id;
  END IF;

  IF OLD.role = 'admin' THEN
    IF TG_OP = 'DELETE' THEN
      must_check_last_admin := TRUE;
    ELSE
      must_check_last_admin :=
        NEW.role <> 'admin'
        OR NEW.band_id IS DISTINCT FROM OLD.band_id;
    END IF;
  END IF;

  IF must_check_last_admin THEN
    PERFORM 1
    FROM public.bands AS b
    WHERE b.id = OLD.band_id
    FOR UPDATE;

    -- The parent row is absent during ON DELETE CASCADE from bands.
    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;

    SELECT count(*)
    INTO remaining_admins
    FROM public.band_members AS bm
    WHERE bm.band_id = OLD.band_id
      AND bm.role = 'admin'
      AND bm.id <> OLD.id;

    IF remaining_admins = 0 THEN
      RAISE EXCEPTION 'A band must retain at least one admin';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_last_band_admin_removal()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER band_members_prevent_last_admin_removal
BEFORE UPDATE OR DELETE ON public.band_members
FOR EACH ROW
EXECUTE FUNCTION private.prevent_last_band_admin_removal();

COMMIT;
