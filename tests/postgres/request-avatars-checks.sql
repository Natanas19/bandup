BEGIN;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
DO $$ DECLARE item record; actual text; BEGIN
  FOR item IN SELECT * FROM avatar_test.urls LOOP
    UPDATE auth.users SET raw_user_meta_data=item.metadata WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
    SELECT avatar_url INTO actual FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',ARRAY['cccccccc-cccc-4ccc-8ccc-000000000001']::uuid[]);
    PERFORM avatar_test.assert_true(actual IS NOT DISTINCT FROM CASE WHEN item.valid THEN item.metadata->>'avatar_url' ELSE NULL END, 'URL: '||item.label);
  END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT avatar_test.expect_state('SELECT * FROM auth.users','42501','Auth table still inaccessible');
SELECT avatar_test.assert_true((SELECT count(*)=1 FROM public.bandup_pending_request_avatars(
 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',ARRAY['cccccccc-cccc-4ccc-8ccc-000000000001']::uuid[])), 'admin A sees pending request');
SELECT avatar_test.assert_true((SELECT array_agg(request_id)=ARRAY['cccccccc-cccc-4ccc-8ccc-000000000001']::uuid[]
 FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',ARRAY[
 'cccccccc-cccc-4ccc-8ccc-000000000001','cccccccc-cccc-4ccc-8ccc-000000000001',
 'dddddddd-dddd-4ddd-8ddd-000000000001','eeeeeeee-eeee-4eee-8eee-000000000001',
 'eeeeeeee-eeee-4eee-8eee-000000000002','eeeeeeee-eeee-4eee-8eee-000000000003',
 'ffffffff-ffff-4fff-8fff-000000000001']::uuid[])), 'foreign/closed/missing IDs omitted, duplicate IDs deduplicated');
SELECT avatar_test.assert_true((SELECT count(*)=0 FROM public.bandup_pending_request_avatars(
 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}'::uuid[])), 'empty page');
SELECT avatar_test.assert_true((SELECT count(*)=0 FROM public.bandup_pending_request_avatars(
 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',ARRAY['dddddddd-dddd-4ddd-8ddd-000000000001']::uuid[])), 'no cross-band enumeration');
WITH first_page AS (SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
 (SELECT array_agg(('cccccccc-cccc-4ccc-8ccc-'||lpad(i::text,12,'0'))::uuid) FROM generate_series(1,20) i))),
 second_page AS (SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
 (SELECT array_agg(('cccccccc-cccc-4ccc-8ccc-'||lpad(i::text,12,'0'))::uuid) FROM generate_series(21,25) i))),
 both_pages AS (SELECT * FROM first_page UNION ALL SELECT * FROM second_page)
SELECT avatar_test.assert_true((SELECT count(*)=25 AND count(DISTINCT request_id)=25 FROM both_pages),'two existing UI pages, no missing/duplicated results');
SELECT avatar_test.assert_true((SELECT bool_and((SELECT count(*) FROM jsonb_object_keys(to_jsonb(r)))=2)
 FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',ARRAY['cccccccc-cccc-4ccc-8ccc-000000000001']::uuid[]) r),'only request_id and avatar_url returned');
SELECT avatar_test.assert_true((SELECT to_jsonb(r)::text !~ 'PRIVATE_|email|requester_id|raw_user_meta_data'
 FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',ARRAY['cccccccc-cccc-4ccc-8ccc-000000000001']::uuid[]) r),'no private metadata or user IDs');
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL)$q$,'22023','NULL page rejected');
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',ARRAY[NULL]::uuid[])$q$,'22023','NULL element rejected');
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',array_fill('cccccccc-cccc-4ccc-8ccc-000000000001'::uuid,ARRAY[21]))$q$,'22023','21 IDs rejected');
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',ARRAY[ARRAY['cccccccc-cccc-4ccc-8ccc-000000000001']]::uuid[])$q$,'22023','multidimensional page rejected');
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}')$q$,'42501','member denied');
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}')$q$,'42501','external applicant denied');
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('ffffffff-ffff-4fff-8fff-000000000001',NULL)$q$,'42501','nonexistent band same denial before argument checks');
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars(NULL,'{}')$q$,'42501','NULL band denied');
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}')$q$,'42501','admin B cannot inspect A');
SELECT avatar_test.assert_true((SELECT request_id='dddddddd-dddd-4ddd-8ddd-000000000001'::uuid FROM public.bandup_pending_request_avatars(
 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002',ARRAY['dddddddd-dddd-4ddd-8ddd-000000000001']::uuid[])), 'admin B sees only B');
SET LOCAL request.jwt.claim.sub='';
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}')$q$,'42501','authenticated without UID denied');
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
SET LOCAL request.jwt.claim.role='anon';
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}')$q$,'42501','wrong JWT role denied');
SET LOCAL ROLE anon;
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}')$q$,'42501','anon lacks EXECUTE');
SET LOCAL ROLE service_role;
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}')$q$,'42501','service_role lacks EXECUTE');
RESET ROLE;
SET LOCAL request.jwt.claim.role='authenticated';
UPDATE public.band_members SET role='member' WHERE user_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
SET LOCAL ROLE authenticated;
SELECT avatar_test.expect_state($q$SELECT * FROM public.bandup_pending_request_avatars('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','{}')$q$,'42501','demoted admin immediately denied on next statement');
RESET ROLE;
SELECT avatar_test.assert_true((SELECT value=avatar_test.snapshot() FROM avatar_test.original),'all original policies, grants, functions, buckets unchanged');
SELECT avatar_test.assert_true((SELECT p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='s'
 AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=off']
 AND pg_get_function_result(p.oid)='TABLE(request_id uuid, avatar_url text)'
 FROM pg_proc p WHERE p.oid='public.bandup_pending_request_avatars(uuid,uuid[])'::regprocedure),'RPC metadata and two-field contract');
SELECT 'SQL_ASSERTIONS:'||count(*) FROM avatar_test.results;
ROLLBACK;
