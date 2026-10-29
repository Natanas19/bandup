-- FUTURE historical phase, before Bridge. All test data is rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
\ir historical_lab_identity_check.sql
\ir historical_public_read_layer_contract.sql
SELECT pg_temp.historical_check();
\ir historical_public_read_layer_data.sql
-- Direct reader access distinguishes policy filtering from view filtering.
SET LOCAL ROLE bandup_public_reader;
SELECT pg_temp.historical_assert((SELECT count(*) FROM public.events
  WHERE band_id IN ('82000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000002'))=2,
  'reader sees present/future public events only');
SELECT pg_temp.historical_assert(NOT EXISTS (SELECT 1 FROM public.events
  WHERE band_id='82000000-0000-0000-0000-000000000001' AND start_at<pg_catalog.now()), 'reader hides past events');
SELECT pg_temp.historical_assert(NOT EXISTS (SELECT 1 FROM public.events
  WHERE band_id='82000000-0000-0000-0000-000000000002'), 'reader hides private-band events');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.historical_assert((SELECT count(*) FROM public.public_events
  WHERE band_id IN ('82000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000002'))=2,
  'anon sees present/future public events only');
SELECT pg_temp.historical_assert(NOT EXISTS (SELECT 1 FROM public.public_events
  WHERE band_id='82000000-0000-0000-0000-000000000002')
  AND NOT EXISTS (SELECT 1 FROM public.public_events
    WHERE band_id='82000000-0000-0000-0000-000000000001' AND start_at<pg_catalog.now()),
  'anon hides private-band and past events');
SELECT pg_temp.historical_assert((SELECT count(*) FROM public.public_bands
  WHERE id IN ('82000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000002'))=1,
  'anon sees public band only');
-- Unsafe URL visibility is a historical limitation, never a desired final state.
SELECT pg_temp.historical_assert((SELECT count(*) FROM public.public_social_links
  WHERE band_id='82000000-0000-0000-0000-000000000001')=2,
  'historical links have no individual publication or URL filter');
SELECT pg_temp.historical_assert(NOT EXISTS (SELECT 1 FROM public.public_social_links
  WHERE band_id='82000000-0000-0000-0000-000000000002'), 'anon hides private-band links');
RESET ROLE;
CREATE FUNCTION pg_temp.historical_denied(command text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $denied$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'Historical denial missing: %',command;
END;
$denied$;
SET LOCAL ROLE anon;
SELECT pg_temp.historical_denied('SELECT id FROM public.bands');
SELECT pg_temp.historical_denied('SELECT url FROM public.social_links');
SELECT pg_temp.historical_denied('SELECT title FROM public.events');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.historical_denied('SELECT * FROM public.public_bands');
SELECT pg_temp.historical_denied('SELECT * FROM public.public_events');
SELECT pg_temp.historical_denied('SELECT * FROM public.public_social_links');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.historical_denied('SELECT * FROM public.public_bands');
SELECT pg_temp.historical_denied('SELECT * FROM public.public_events');
SELECT pg_temp.historical_denied('SELECT * FROM public.public_social_links');
RESET ROLE;
SELECT pg_temp.historical_check();
ROLLBACK;
