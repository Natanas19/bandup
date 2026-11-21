SELECT current_database() = 'postgres' AND current_user = 'postgres'
  AND inet_server_addr() = '127.0.0.1'::inet AND inet_server_port() = :'test_port'::int
  AND lower(replace(current_setting('data_directory'), chr(92), '/')) = lower(:'test_data') AS isolated \gset
\if :isolated
\else
DO $$ BEGIN RAISE EXCEPTION 'Unexpected test cluster'; END $$;
\endif

\ir band-delete-bootstrap.sql
\ir ../../supabase/migrations/20261001000000_initial_bandup_schema.sql
\ir ../../supabase/migrations/20261002170000_events_delete_admins_only.sql
\ir ../../supabase/migrations/20261002190800_events_custom_event_type.sql
\ir ../../supabase/migrations/20261002200000_tasks_optional_event_link.sql
\ir ../../supabase/migrations/20261119120000_public_band_identity_v1.sql
\ir ../../supabase/migrations/20261120120000_band_public_links_v1.sql
\ir ../../supabase/migrations/20261120130000_band_public_links_member_read_and_reorder.sql

INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002'), ('10000000-0000-0000-0000-000000000003');
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
INSERT INTO public.bands (id, name, slug)
VALUES ('20000000-0000-0000-0000-000000000001', 'Alpha', 'alpha');
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
INSERT INTO public.bands (id, name, slug)
VALUES ('20000000-0000-0000-0000-000000000002', 'Beta', 'beta');
INSERT INTO public.band_members (band_id, user_id, role)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'member');
INSERT INTO public.events (id, band_id, created_by, title, event_type, start_at)
VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002', 'Existing rehearsal', 'rehearsal', '2030-01-01 20:00+00');

\ir ../../supabase/migrations/20261120140000_public_band_events.sql

CREATE FUNCTION public.assert_public_event_test(ok boolean, context text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', context; END IF;
END;
$$;
CREATE FUNCTION public.expect_event_error(statement text, code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE statement;
  RAISE EXCEPTION 'Expected SQLSTATE %', code;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> code THEN RAISE; END IF;
END;
$$;

SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT public.assert_public_event_test((
  SELECT is_public IS FALSE FROM public.events WHERE title = 'Existing rehearsal'
), 'existing events must remain private');
INSERT INTO public.events (id, band_id, created_by, title, description, event_type, start_at, end_at, location)
VALUES ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002', 'Show Alpha', 'Internal note', 'show',
  '2030-02-01 20:00+00', '2030-02-01 22:00+00', 'Internal location');
SELECT public.assert_public_event_test((
  SELECT is_public IS FALSE FROM public.events WHERE title = 'Show Alpha'
), 'member insert must default to private');
UPDATE public.events SET title = 'Show Alpha edited' WHERE title = 'Show Alpha';
SELECT public.assert_public_event_test(EXISTS (
  SELECT FROM public.events WHERE title = 'Show Alpha edited'
), 'member must be able to edit their own private event');
SELECT public.expect_event_error(
  $$INSERT INTO public.events (band_id, created_by, title, event_type, start_at, is_public)
    VALUES ('20000000-0000-0000-0000-000000000001', auth.uid(), 'Invalid', 'show', now(), true)$$, '23514');
SELECT public.expect_event_error(
  $$UPDATE public.events SET is_public = true, title = 'Invalid' WHERE title = 'Show Alpha edited'$$, '42501');
SELECT public.assert_public_event_test((
  SELECT title = 'Show Alpha edited' AND is_public IS FALSE
  FROM public.events WHERE id = '30000000-0000-0000-0000-000000000002'
), 'denied publication must preserve the private event and its title');
RESET ROLE;

SET ROLE anon;
SELECT public.expect_event_error('SELECT id FROM public.events', '42501');
SELECT public.assert_public_event_test(NOT EXISTS (SELECT FROM public.public_band_events), 'private events leaked');
RESET ROLE;

SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
UPDATE public.bands SET is_public = true WHERE slug = 'alpha';
UPDATE public.events SET is_public = true WHERE title = 'Show Alpha edited';
RESET ROLE;

SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
WITH forbidden AS (
  UPDATE public.events SET is_public = false
  WHERE id = '30000000-0000-0000-0000-000000000002' RETURNING id
)
SELECT public.assert_public_event_test(NOT EXISTS (SELECT FROM forbidden), 'cross-band admin could change publication');
INSERT INTO public.events (id, band_id, created_by, title, event_type, start_at)
VALUES ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002',
  auth.uid(), 'Show Beta', 'show', '2030-03-01 20:00+00');
UPDATE public.events SET is_public = true WHERE title = 'Show Beta';
RESET ROLE;

SET ROLE anon;
SELECT public.assert_public_event_test((
  SELECT jsonb_agg(to_jsonb(event) ORDER BY event.id) FROM public.public_band_events AS event
) = jsonb_build_array(jsonb_build_object(
  'slug', 'alpha', 'id', '30000000-0000-0000-0000-000000000002',
  'title', 'Show Alpha edited', 'start_at', '2030-02-01 20:00+00'::timestamptz,
  'end_at', '2030-02-01 22:00+00'::timestamptz
)), 'projection must expose only Alpha public event and allowlisted fields');
SELECT public.assert_public_event_test(
  NOT has_any_column_privilege(current_user, 'public.public_band_events', 'INSERT,UPDATE')
  AND NOT has_table_privilege(current_user, 'public.public_band_events', 'DELETE'),
  'anonymous event view must be read-only');
RESET ROLE;

SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT public.expect_event_error(
  $$UPDATE public.events SET id = '30000000-0000-0000-0000-000000000004'
    WHERE id = '30000000-0000-0000-0000-000000000002'$$, '42501');
SELECT public.expect_event_error(
  $$UPDATE public.events SET title = 'Leak' WHERE title = 'Show Alpha edited'$$, '42501');
SELECT public.expect_event_error(
  $$UPDATE public.events SET start_at = start_at - interval '1 hour' WHERE title = 'Show Alpha edited'$$, '42501');
SELECT public.expect_event_error(
  $$UPDATE public.events SET end_at = NULL WHERE title = 'Show Alpha edited'$$, '42501');
SELECT public.expect_event_error(
  $$UPDATE public.events SET is_public = false, title = 'Leak', description = 'Changed'
    WHERE title = 'Show Alpha edited'$$, '42501');
SELECT public.assert_public_event_test((
  SELECT is_public AND title = 'Show Alpha edited' AND description = 'Internal note'
    AND start_at = '2030-02-01 20:00+00'::timestamptz AND end_at = '2030-02-01 22:00+00'::timestamptz
  FROM public.events WHERE id = '30000000-0000-0000-0000-000000000002'
), 'denied writes must preserve the ID, public fields, publication and internal note');
UPDATE public.events SET description = 'Updated internal note', location = NULL WHERE title = 'Show Alpha edited';
SELECT public.assert_public_event_test((
  SELECT description = 'Updated internal note' AND location IS NULL FROM public.events WHERE title = 'Show Alpha edited'
), 'member internal edit should remain permitted');
RESET ROLE;

SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
UPDATE public.events SET is_public = false WHERE title = 'Show Alpha edited';
RESET ROLE;
SET ROLE anon;
SELECT public.assert_public_event_test(NOT EXISTS (SELECT FROM public.public_band_events), 'withdrawn event remained visible');
RESET ROLE;

SET ROLE authenticated;
UPDATE public.events SET is_public = true, title = 'Admin approved title' WHERE title = 'Show Alpha edited';
RESET ROLE;
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
UPDATE public.bands SET is_public = true WHERE slug = 'beta';
RESET ROLE;
SET ROLE anon;
SELECT public.assert_public_event_test((
  SELECT array_agg(title) FROM public.public_band_events WHERE slug = 'alpha'
) = ARRAY['Admin approved title'], 'filtering Alpha must return only the approved Alpha event');
SELECT public.assert_public_event_test((
  SELECT array_agg(title) FROM public.public_band_events WHERE slug = 'beta'
) = ARRAY['Show Beta'], 'filtering Beta must return only its published event');
RESET ROLE;

SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
UPDATE public.bands SET is_public = false WHERE slug = 'alpha';
RESET ROLE;
SET ROLE anon;
SELECT public.assert_public_event_test((
  SELECT array_agg(slug) FROM public.public_band_events
) = ARRAY['beta'], 'withdrawing Alpha must hide its events without affecting Beta');
RESET ROLE;

\echo 'PASS: public event visibility, projection and permissions'
