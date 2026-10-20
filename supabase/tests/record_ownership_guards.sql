-- DISPOSABLE LOCAL DATABASE ONLY. Apply migrations first, then run as postgres
-- with psql -v ON_ERROR_STOP=1. No extensions required. Never use production.
BEGIN;

CREATE FUNCTION pg_temp.assert_true(ok BOOLEAN, label TEXT)
RETURNS VOID LANGUAGE PLPGSQL SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Assertion failed: %', label;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.expect_rejection(
  command TEXT, expected_state TEXT, expected_constraint TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE PLPGSQL SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  actual_state TEXT;
  actual_constraint TEXT;
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE,
      actual_constraint = CONSTRAINT_NAME;
    IF actual_state = expected_state AND (
      expected_constraint IS NULL OR actual_constraint = expected_constraint
    ) THEN
      RETURN;
    END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected rejection did not occur';
END;
$$;

CREATE FUNCTION pg_temp.set_actor(user_id TEXT)
RETURNS VOID LANGUAGE PLPGSQL SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', user_id, true);
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
END;
$$;

-- Fictitious IDs: collisions must fail, never reuse existing records.
-- Users: 1 = admin in A/B, 2 = creator in A/B, 3 = ordinary member in A.
INSERT INTO auth.users (id) VALUES
  ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003');
SELECT pg_temp.set_actor('10000000-0000-0000-0000-000000000001');
INSERT INTO public.bands (id, name, slug) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Guard test A', 'guard-test-a'),
  ('20000000-0000-0000-0000-000000000002', 'Guard test B', 'guard-test-b');
-- Existing trigger creates the admin memberships.
INSERT INTO public.band_members (id, band_id, user_id, role) VALUES
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'member'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'member'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'member');
INSERT INTO public.events (id, band_id, created_by, title, event_type, start_at) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Creator event', 'show', now() + interval '1 day'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Admin event', 'show', now() + interval '1 day');
INSERT INTO public.tasks (id, band_id, created_by, assigned_to, title, status, priority) VALUES
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Assigned task', 'todo', 'medium');

SET LOCAL ROLE authenticated;
SELECT pg_temp.set_actor('10000000-0000-0000-0000-000000000002');
UPDATE public.events SET title = 'Creator edited', band_id = band_id, created_by = created_by
WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(
  (SELECT title = 'Creator edited' FROM public.events WHERE id = '30000000-0000-0000-0000-000000000001'), 'creator edit');

-- Run the same prohibited edits as creator and then as admin.
DO $$
DECLARE actor TEXT; changes TEXT;
BEGIN
  FOREACH actor IN ARRAY ARRAY[
    '10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001'
  ] LOOP
    PERFORM pg_temp.set_actor(actor);
    FOREACH changes IN ARRAY ARRAY[
      'band_id = ''20000000-0000-0000-0000-000000000002''',
      'created_by = ''10000000-0000-0000-0000-000000000003''',
      'band_id = ''20000000-0000-0000-0000-000000000002'', created_by = ''10000000-0000-0000-0000-000000000001'''
    ] LOOP
      PERFORM pg_temp.expect_rejection(
        'UPDATE public.events SET ' || changes || ' WHERE id = ''30000000-0000-0000-0000-000000000001''',
        '23514', 'events_ownership_immutable');
    END LOOP;
  END LOOP;
END;
$$;

UPDATE public.events SET title = 'Bulk edited'
WHERE band_id = '20000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect_rejection($q$
  UPDATE public.events SET title = 'Must roll back', band_id = CASE
    WHEN id = '30000000-0000-0000-0000-000000000001'
    THEN '20000000-0000-0000-0000-000000000002'::uuid ELSE band_id END
  WHERE band_id = '20000000-0000-0000-0000-000000000001'
$q$, '23514', 'events_ownership_immutable');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 AND bool_and(title = 'Bulk edited') FROM public.events
   WHERE band_id = '20000000-0000-0000-0000-000000000001'), 'atomic event batch');

-- Upsert: legitimate update and insert, followed by forbidden update paths.
INSERT INTO public.events (id, band_id, created_by, title, event_type, start_at)
VALUES ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Upsert edited', 'show', now() + interval '1 day'),
       ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Upsert inserted', 'show', now() + interval '1 day')
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 FROM public.events WHERE title IN ('Upsert edited', 'Upsert inserted')
   AND band_id = '20000000-0000-0000-0000-000000000001'), 'event upsert paths');
SELECT pg_temp.expect_rejection($q$
  INSERT INTO public.events (id, band_id, created_by, title, event_type, start_at)
  VALUES ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Forbidden', 'show', now() + interval '1 day')
  ON CONFLICT (id) DO UPDATE SET band_id = EXCLUDED.band_id
$q$, '23514', 'events_ownership_immutable');
SELECT pg_temp.expect_rejection($q$
  INSERT INTO public.events (id, band_id, created_by, title, event_type, start_at)
  VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Forbidden', 'show', now() + interval '1 day')
  ON CONFLICT (id) DO UPDATE SET created_by = EXCLUDED.created_by
$q$, '23514', 'events_ownership_immutable');

UPDATE public.band_members SET role = 'admin', band_id = band_id
WHERE id = '40000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_true(
  (SELECT role = 'admin' FROM public.band_members WHERE id = '40000000-0000-0000-0000-000000000003'), 'promotion');
UPDATE public.band_members SET role = 'member'
WHERE id = '40000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_true(
  (SELECT role = 'member' FROM public.band_members WHERE id = '40000000-0000-0000-0000-000000000003'), 'demotion with another admin');
SELECT pg_temp.expect_rejection($q$
  UPDATE public.band_members SET band_id = '20000000-0000-0000-0000-000000000002'
  WHERE id = '40000000-0000-0000-0000-000000000003'
$q$, '23514', 'band_members_band_immutable');
SELECT pg_temp.expect_rejection($q$
  UPDATE public.band_members SET user_id = '10000000-0000-0000-0000-000000000002'
  WHERE id = '40000000-0000-0000-0000-000000000003'
$q$, 'P0001');
SELECT pg_temp.expect_rejection($q$
  UPDATE public.band_members SET role = 'member'
  WHERE band_id = '20000000-0000-0000-0000-000000000002'
    AND user_id = '10000000-0000-0000-0000-000000000001'
$q$, 'P0001');
SELECT pg_temp.expect_rejection($q$
  DELETE FROM public.band_members
  WHERE band_id = '20000000-0000-0000-0000-000000000002'
    AND user_id = '10000000-0000-0000-0000-000000000001'
$q$, 'P0001');
SELECT pg_temp.expect_rejection($q$
  UPDATE public.band_members SET role = 'admin', band_id = CASE
    WHEN id = '40000000-0000-0000-0000-000000000003'
    THEN '20000000-0000-0000-0000-000000000002'::uuid ELSE band_id END
  WHERE id IN ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003')
$q$, '23514', 'band_members_band_immutable');
SELECT pg_temp.assert_true(
  (SELECT count(*) = 2 AND bool_and(role = 'member') FROM public.band_members
   WHERE id IN ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003')), 'atomic membership batch');
INSERT INTO public.band_members (id, band_id, user_id, role)
VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SELECT pg_temp.assert_true(
  (SELECT role = 'admin' FROM public.band_members WHERE id = '40000000-0000-0000-0000-000000000003'), 'membership upsert edit');
SELECT pg_temp.expect_rejection($q$
  INSERT INTO public.band_members (id, band_id, user_id, role)
  VALUES ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'member')
  ON CONFLICT (id) DO UPDATE SET band_id = EXCLUDED.band_id
$q$, '23514', 'band_members_band_immutable');

-- Failed transfer retains assignments; a legitimate deletion still clears them.
SELECT pg_temp.expect_rejection($q$
  UPDATE public.band_members SET band_id = '20000000-0000-0000-0000-000000000002'
  WHERE id = '40000000-0000-0000-0000-000000000001'
$q$, '23514', 'band_members_band_immutable');
SELECT pg_temp.assert_true(
  (SELECT assigned_to = '10000000-0000-0000-0000-000000000002'::uuid FROM public.tasks
   WHERE id = '50000000-0000-0000-0000-000000000001'), 'assignment retained');
DELETE FROM public.band_members WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.band_members WHERE id = '40000000-0000-0000-0000-000000000001')
  AND (SELECT assigned_to IS NULL FROM public.tasks WHERE id = '50000000-0000-0000-0000-000000000001'), 'member deletion cleanup');
DELETE FROM public.bands WHERE id = '20000000-0000-0000-0000-000000000002';
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.bands WHERE id = '20000000-0000-0000-0000-000000000002'), 'band deletion');

ROLLBACK;
