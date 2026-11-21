-- Requires the public band identity reader and its published-bands policy.
BEGIN;
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
    SELECT FROM pg_class AS profile
    JOIN pg_roles AS owner ON owner.oid = profile.relowner
    WHERE profile.oid = to_regclass('public.public_band_profiles')
      AND profile.relkind = 'v' AND owner.rolname = 'bandup_public_identity_reader'
  ) OR (
    SELECT count(*) FROM pg_class
    WHERE oid IN ('public.bands'::regclass, 'public.events'::regclass) AND relrowsecurity
  ) <> 2 OR to_regprocedure('private.is_band_admin(uuid)') IS NULL
    OR has_schema_privilege('bandup_public_identity_reader', 'public', 'CREATE')
    OR EXISTS (
      SELECT FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS api(role_name)
      WHERE pg_has_role(api.role_name::name, 'bandup_public_identity_reader', 'MEMBER')
    ) THEN
    RAISE EXCEPTION 'Unexpected public event publication prerequisites';
  END IF;
END;
$preflight$;

ALTER TABLE public.events ADD COLUMN is_public boolean NOT NULL DEFAULT false;

CREATE FUNCTION private.guard_event_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_public IS TRUE THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'New events must start unpublished';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.is_public OR NEW.is_public THEN
    -- Public rows may be addressed by event ID and band slug. Keep that identity
    -- fixed during publication, withdrawal and edits to a published row.
    IF (NEW.id, NEW.band_id) IS DISTINCT FROM (OLD.id, OLD.band_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cannot change a published event identity';
    END IF;

    IF (NEW.is_public, NEW.title, NEW.start_at, NEW.end_at)
         IS DISTINCT FROM (OLD.is_public, OLD.title, OLD.start_at, OLD.end_at)
       AND (auth.uid() IS NULL OR private.is_band_admin(OLD.band_id) IS DISTINCT FROM true) THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'Only a band admin may change event publication or public event details';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

REVOKE ALL ON FUNCTION private.guard_event_publication() FROM PUBLIC, anon, authenticated, service_role;
-- Check the final row, including changes made by existing BEFORE triggers.
CREATE TRIGGER events_guard_publication
AFTER INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION private.guard_event_publication();

GRANT SELECT (id) ON public.bands TO bandup_public_identity_reader;
GRANT SELECT (id, band_id, title, start_at, end_at, is_public)
ON public.events TO bandup_public_identity_reader;

CREATE POLICY events_select_for_identity_reader
ON public.events FOR SELECT TO bandup_public_identity_reader
USING (is_public IS TRUE AND EXISTS (
  SELECT FROM public.bands AS band WHERE band.id = events.band_id AND band.is_public IS TRUE
));

GRANT CREATE ON SCHEMA public TO bandup_public_identity_reader;
CREATE VIEW public.public_band_events
WITH (security_barrier = true, security_invoker = false)
AS
SELECT band.slug, event.id, event.title, event.start_at, event.end_at
FROM public.events AS event
JOIN public.bands AS band ON band.id = event.band_id
WHERE event.is_public IS TRUE AND band.is_public IS TRUE;

REVOKE ALL ON public.public_band_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.public_band_events TO anon;

-- Preserve existing role memberships during ownership transfer, as in public links.
DO $view_owner$
DECLARE
  reader_oid oid := 'bandup_public_identity_reader'::regrole;
  executor_oid oid := CURRENT_USER::regrole;
  needs_set_grant boolean := NOT pg_has_role(executor_oid, reader_oid, 'SET');
  memberships_before jsonb;
  memberships_after jsonb;
BEGIN
  IF needs_set_grant THEN
    -- Acquire the target role lock before inspecting memberships.
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
  ALTER VIEW public.public_band_events OWNER TO bandup_public_identity_reader;
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
  IF has_any_column_privilege('anon', 'public.events', 'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_table_privilege('anon', 'public.events', 'DELETE,TRUNCATE,TRIGGER')
    OR has_table_privilege('bandup_public_identity_reader', 'public.events', 'SELECT')
    OR has_any_column_privilege('bandup_public_identity_reader', 'public.events', 'INSERT,UPDATE,REFERENCES')
    OR has_table_privilege('bandup_public_identity_reader', 'public.events', 'DELETE,TRUNCATE,TRIGGER')
    OR has_schema_privilege('bandup_public_identity_reader', 'public', 'CREATE')
    OR NOT has_table_privilege('anon', 'public.public_band_events', 'SELECT') THEN
    RAISE EXCEPTION 'Unexpected public event grants';
  END IF;
END;
$postconditions$;

COMMIT;
