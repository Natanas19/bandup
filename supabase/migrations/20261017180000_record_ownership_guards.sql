-- Additive guards: do not replace existing functions, triggers, RLS or views.
BEGIN;

-- Reject name collisions, including overloads, rather than replacing objects.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN (
        'guard_event_ownership', 'guard_band_member_band'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS t
    WHERE (t.tgrelid = 'public.events'::regclass
           AND t.tgname = 'events_guard_ownership')
       OR (t.tgrelid = 'public.band_members'::regclass
           AND t.tgname = 'band_members_guard_band_id')
  ) THEN
    RAISE EXCEPTION 'Record ownership guard name collision; review existing objects';
  END IF;
END;
$$;

CREATE FUNCTION private.guard_event_ownership()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.band_id IS DISTINCT FROM OLD.band_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Event band and creator cannot be changed',
      CONSTRAINT = 'events_ownership_immutable';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_event_ownership()
FROM PUBLIC, anon, authenticated, service_role;

-- Alphabetically before events_set_updated_at. Inspect every UPDATE, even
-- when the protected columns are omitted from the original SET clause.
CREATE TRIGGER events_guard_ownership
BEFORE UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION private.guard_event_ownership();

CREATE FUNCTION private.guard_band_member_band()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.band_id IS DISTINCT FROM OLD.band_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Membership band cannot be changed; remove and add the member',
      CONSTRAINT = 'band_members_band_immutable';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_band_member_band()
FROM PUBLIC, anon, authenticated, service_role;

-- Alphabetically before band_members_prevent_last_admin_removal, so a
-- rejected transfer never reaches its task-assignment cleanup. The existing
-- trigger still protects user_id, the last admin and legitimate deletions.
CREATE TRIGGER band_members_guard_band_id
BEFORE UPDATE ON public.band_members
FOR EACH ROW
EXECUTE FUNCTION private.guard_band_member_band();

COMMIT;
