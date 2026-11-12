BEGIN;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL request.jwt.claim.role = 'authenticated';

DO $$ DECLARE item record; actual text; BEGIN
  FOR item IN SELECT * FROM discovery_test.urls LOOP
    UPDATE public.bands SET logo_url=item.value WHERE id='00000000-0000-0000-0000-000000000001';
    SELECT logo_url INTO actual FROM public.bandup_discover_bands_v2(NULL,1);
    PERFORM discovery_test.assert_true(actual IS NOT DISTINCT FROM CASE WHEN item.valid THEN item.value ELSE NULL END, item.label);
  END LOOP;
END $$;

SET LOCAL ROLE authenticated;
SELECT discovery_test.assert_true((SELECT count(*)=0 FROM public.bands),'direct RLS remains closed');
SELECT discovery_test.assert_true((SELECT count(*)=20 FROM public.bandup_discover_bands_v2()),'default limit');
SELECT discovery_test.assert_true((SELECT count(*)=1 FROM public.bandup_discover_bands_v2(NULL,1)),'minimum limit');
SELECT discovery_test.assert_true((SELECT count(*)=50 FROM public.bandup_discover_bands_v2(NULL,50)),'maximum limit');
SELECT discovery_test.assert_true((SELECT count(*)=0 FROM public.bandup_discover_bands_v2('ffffffff-ffff-ffff-ffff-ffffffffffff',20)),'exhausted cursor');
DO $$ DECLARE lim integer; BEGIN
  FOREACH lim IN ARRAY ARRAY[NULL::integer,0,-1,51] LOOP
    BEGIN PERFORM * FROM public.bandup_discover_bands_v2(NULL,lim);
      RAISE EXCEPTION 'Accepted invalid limit';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
END $$;
WITH first_page AS (SELECT * FROM public.bandup_discover_bands_v2(NULL,50)),
 second_page AS (SELECT * FROM public.bandup_discover_bands_v2((SELECT max(band_id::text)::uuid FROM first_page),50)),
 both_pages AS (SELECT * FROM first_page UNION ALL SELECT * FROM second_page)
SELECT discovery_test.assert_true((SELECT count(*)=65 AND count(DISTINCT band_id)=65 FROM both_pages),'no missing or duplicate bands');
SELECT discovery_test.assert_true((SELECT bool_and(previous IS NULL OR previous<band_id) FROM
 (SELECT band_id,lag(band_id) OVER () AS previous FROM public.bandup_discover_bands_v2(NULL,50)) ordered),'UUID ordering');
SELECT discovery_test.assert_true((SELECT bool_and(summary='') FROM public.bandup_discover_bands_v2(NULL,50)),'summary empty');
SELECT discovery_test.assert_true((SELECT bool_and((SELECT count(*) FROM jsonb_object_keys(to_jsonb(r)))=4)
 FROM public.bandup_discover_bands_v2(NULL,50) r),'only four public fields');
SELECT discovery_test.assert_true(NOT EXISTS(
 (SELECT band_id,display_name,summary FROM public.bandup_discover_bands(NULL,50)
  EXCEPT SELECT band_id,display_name,summary FROM public.bandup_discover_bands_v2(NULL,50))), 'old and new universe agree');
SET LOCAL request.jwt.claim.sub = '';
DO $$ BEGIN
  BEGIN PERFORM * FROM public.bandup_discover_bands_v2(); RAISE EXCEPTION 'Accepted missing actor';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL request.jwt.claim.role = 'anon';
DO $$ BEGIN
  BEGIN PERFORM * FROM public.bandup_discover_bands_v2(); RAISE EXCEPTION 'Accepted wrong JWT role';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.bandup_discover_bands_v2(); RAISE EXCEPTION 'anon executed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.bandup_discover_bands_v2(); RAISE EXCEPTION 'service_role executed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT discovery_test.assert_true((SELECT o.metadata=to_jsonb(p) AND o.definition=pg_get_functiondef(p.oid)
 FROM discovery_test.original o CROSS JOIN pg_proc p
 WHERE p.oid='public.bandup_discover_bands(uuid,integer)'::regprocedure),'original metadata and definition unchanged');
SELECT discovery_test.assert_true((SELECT p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='s'
 AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=off']
 FROM pg_proc p WHERE p.oid='public.bandup_discover_bands_v2(uuid,integer)'::regprocedure),'v2 owner and security settings');
ROLLBACK;
