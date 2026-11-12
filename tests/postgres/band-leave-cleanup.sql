-- Run only with the guarded runner. Never drop databases, PUBLIC, or dependencies
-- with CASCADE. An unexpected dependency causes rollback instead of deleting it.
BEGIN;
DO $check$
BEGIN
  IF current_database() IS DISTINCT FROM 'bandup_leave_test'
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_port() IS DISTINCT FROM 5433
    OR session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
  THEN RAISE EXCEPTION 'Wrong disposable test destination'; END IF;
  IF NOT EXISTS (SELECT 1 FROM bandup_leave_test_support.manifest
    WHERE name='environment' AND value='bandup-leave-local-v1')
  THEN RAISE EXCEPTION 'Missing disposable bootstrap marker'; END IF;
END $check$;
DROP FUNCTION IF EXISTS public.bandup_leave_band(uuid);
DROP TABLE public.tasks;
DROP TABLE public.band_members;
DROP TABLE public.bands;
DROP FUNCTION private.add_band_creator_as_admin();
DROP FUNCTION private.prevent_last_band_admin_removal();
DROP SCHEMA private;
DROP TABLE auth.users;
DROP FUNCTION auth.uid();
DROP FUNCTION auth.role();
DROP SCHEMA auth;
DO $roles$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT value FROM bandup_leave_test_support.manifest WHERE name LIKE 'created-role:%' LOOP
    -- Only roles recorded as newly created by this bootstrap. Shared existing
    -- roles are never dropped or altered. Unexpected dependencies fail safely.
    EXECUTE format('DROP ROLE %I', role_name);
  END LOOP;
END $roles$;
DROP TABLE bandup_leave_test_support.manifest;
DROP SCHEMA bandup_leave_test_support;
COMMIT;
