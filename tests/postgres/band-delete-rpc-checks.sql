-- Expanded dependency test: exact supplied bridge/CHECK; local base migrations. No Demo connection.
BEGIN;
CREATE SCHEMA delete_test;
GRANT USAGE ON SCHEMA delete_test TO authenticated;
CREATE TABLE delete_test.results(label text);
CREATE FUNCTION delete_test.ok(value boolean,label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF;
 INSERT INTO delete_test.results VALUES(label);
END $$;
CREATE FUNCTION delete_test.snapshot(target uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object(
 'bands',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.bands r WHERE target IS NULL OR r.id=target),
 'members',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.band_members r WHERE target IS NULL OR r.band_id=target),
 'tasks',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.tasks r WHERE target IS NULL OR r.band_id=target),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.events r WHERE target IS NULL OR r.band_id=target),
 'links',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.social_links r WHERE target IS NULL OR r.band_id=target),
 'assignees',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.task_id,r.user_id),'[]') FROM public.task_assignees r WHERE target IS NULL OR r.band_id=target),
 'requests',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') FROM public.band_join_requests r WHERE target IS NULL OR r.band_id=target),
 'directory',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.band_id),'[]') FROM public.band_join_directory r WHERE target IS NULL OR r.band_id=target),
 'users',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM auth.users r));
$$;
INSERT INTO auth.users SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,4) i;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
INSERT INTO public.bands(id,name,slug)
SELECT ('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad(i::text,12,'0'))::uuid,'Synthetic band '||i,'delete-core-'||i FROM generate_series(1,3) i;
INSERT INTO public.band_members(band_id,user_id,role)
SELECT id,'aaaaaaaa-aaaa-4aaa-8aaa-000000000002','member' FROM public.bands;
INSERT INTO public.band_members(band_id,user_id,role) VALUES
('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-000000000003','admin');
INSERT INTO public.events(band_id,created_by,title,event_type,start_at)
SELECT id,'aaaaaaaa-aaaa-4aaa-8aaa-000000000001','Synthetic event','rehearsal','2026-01-01' FROM public.bands;
INSERT INTO public.tasks(band_id,created_by,title,status,priority,assigned_to,event_id)
SELECT b.id,'aaaaaaaa-aaaa-4aaa-8aaa-000000000001','Assigned task','todo','medium','aaaaaaaa-aaaa-4aaa-8aaa-000000000002',e.id
FROM public.bands b JOIN public.events e ON e.band_id=b.id;
INSERT INTO public.tasks(band_id,created_by,title,status,priority)
SELECT id,'aaaaaaaa-aaaa-4aaa-8aaa-000000000001','Unassigned task','done','low' FROM public.bands;
INSERT INTO public.social_links(band_id,platform,url)
SELECT id,'other','https://example.invalid/' FROM public.bands;
SELECT delete_test.ok((SELECT count(*)=3 FROM public.tasks WHERE assigned_to IS NOT NULL),'assigned fixtures linked to members');
SELECT delete_test.ok((SELECT count(*)=3 FROM public.tasks WHERE event_id IS NOT NULL),'tasks linked to events');
-- Add multi-assignee tasks without invoking a fictitious activation RPC.
-- The real legacy bridge cannot create multiple assignments; seed table rows as test owner.
INSERT INTO public.tasks(band_id,created_by,title,status,priority)
SELECT id,'aaaaaaaa-aaaa-4aaa-8aaa-000000000001','Multiple assignees','todo','medium' FROM public.bands;
INSERT INTO public.task_assignees(task_id,user_id,band_id)
SELECT t.id,m.user_id,t.band_id FROM public.tasks t JOIN public.band_members m ON m.band_id=t.band_id
WHERE t.title='Multiple assignees' AND m.user_id IN ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000002');
INSERT INTO public.band_join_directory(band_id,display_name,summary,accepting_requests)
SELECT id,name,'Synthetic summary',true FROM public.bands;
INSERT INTO public.band_join_requests(band_id,requester_id,applicant_name,status,decided_at,decided_by,cancelled_at)
SELECT b.id,'aaaaaaaa-aaaa-4aaa-8aaa-000000000004','Synthetic applicant',state,
 CASE WHEN state IN ('approved','rejected') THEN '2026-01-02'::timestamptz END,
 CASE WHEN state IN ('approved','rejected') THEN 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid END,
 CASE WHEN state='cancelled' THEN '2026-01-02'::timestamptz END
FROM public.bands b CROSS JOIN unnest(ARRAY['pending','approved','rejected','cancelled']) state;
SELECT delete_test.ok((SELECT count(*)=6 FROM pg_constraint WHERE contype='f' AND confrelid='public.bands'::regclass AND confdeltype='c'),'six direct band cascades');
SELECT delete_test.ok((SELECT count(*)=2 FROM pg_constraint WHERE contype='f' AND conrelid='public.task_assignees'::regclass AND confdeltype='c'),'two indirect assignee cascades');
SELECT delete_test.ok((SELECT count(*)=3 FROM public.task_assignees a JOIN public.tasks t ON t.id=a.task_id WHERE t.title='Assigned task'),'real INSERT bridge creates legacy assignments');
SELECT delete_test.ok((SELECT count(*)=6 FROM public.task_assignees a JOIN public.tasks t ON t.id=a.task_id WHERE t.title='Multiple assignees'),'two assignees on each multi task');
SELECT delete_test.ok((SELECT count(*)=12 AND count(DISTINCT status)=4 FROM public.band_join_requests),'all request states in all bands');
SELECT delete_test.ok((SELECT count(*)=3 FROM public.band_join_directory),'directory in every band');
-- Trigger guard must reject scalar overwrite, preserving all assignment rows.
DO $$ DECLARE before jsonb:=delete_test.snapshot(); caught text; BEGIN
 BEGIN
  UPDATE public.tasks SET assigned_to='aaaaaaaa-aaaa-4aaa-8aaa-000000000002' WHERE title='Multiple assignees';
 EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
 PERFORM delete_test.ok(caught='23514','exact legacy bridge guards multiple assignments');
 PERFORM delete_test.ok(before=delete_test.snapshot(),'bridge guard rolls back task and assignment changes');
END $$;
-- Assert the supplied CHECK, including that approved decisions may have NULL decided_by.
DO $$ DECLARE state text; before jsonb:=delete_test.snapshot(); caught text; cname text; BEGIN
 FOREACH state IN ARRAY ARRAY['pending','approved','rejected','cancelled'] LOOP
  caught:=NULL; cname:=NULL;
  BEGIN
   UPDATE public.band_join_requests SET decided_at=NULL,decided_by=NULL,cancelled_at=NULL,
    status=state, requested_at='2026-02-01'
   WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001' AND status=state;
   IF state='pending' THEN
    UPDATE public.band_join_requests SET cancelled_at='2026-02-01' WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001' AND status=state;
   END IF;
  EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE,cname=CONSTRAINT_NAME; END;
  PERFORM delete_test.ok(caught='23514' AND cname='band_join_requests_check','exact state/timestamp CHECK: '||state);
  PERFORM delete_test.ok(before=delete_test.snapshot(),'invalid request update fully rolls back: '||state);
 END LOOP;
 BEGIN
  UPDATE public.band_join_requests SET decided_by=NULL WHERE status IN ('approved','rejected');
  PERFORM delete_test.ok((SELECT count(*)=6 FROM public.band_join_requests WHERE status IN ('approved','rejected') AND decided_by IS NULL),'approved/rejected allow NULL decision actor');
  RAISE EXCEPTION USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL; END;
 PERFORM delete_test.ok(before=delete_test.snapshot(),'restore request actors after diagnostic');
END $$;
CREATE FUNCTION delete_test.no_orphans() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.band_members c LEFT JOIN public.bands b ON b.id=c.band_id WHERE b.id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.tasks c LEFT JOIN public.bands b ON b.id=c.band_id WHERE b.id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.events c LEFT JOIN public.bands b ON b.id=c.band_id WHERE b.id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.social_links c LEFT JOIN public.bands b ON b.id=c.band_id WHERE b.id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.band_join_requests c LEFT JOIN public.bands b ON b.id=c.band_id LEFT JOIN auth.users u ON u.id=c.requester_id LEFT JOIN auth.users d ON d.id=c.decided_by WHERE b.id IS NULL OR u.id IS NULL OR (c.decided_by IS NOT NULL AND d.id IS NULL))
 AND NOT EXISTS(SELECT 1 FROM public.band_join_directory c LEFT JOIN public.bands b ON b.id=c.band_id WHERE b.id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.task_assignees a LEFT JOIN public.tasks t ON t.id=a.task_id AND t.band_id=a.band_id LEFT JOIN public.band_members m ON m.band_id=a.band_id AND m.user_id=a.user_id WHERE t.id IS NULL OR m.id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.tasks t LEFT JOIN public.band_members m ON m.band_id=t.band_id AND m.user_id=t.assigned_to LEFT JOIN public.events e ON e.band_id=t.band_id AND e.id=t.event_id WHERE (t.assigned_to IS NOT NULL AND m.id IS NULL) OR (t.event_id IS NOT NULL AND e.id IS NULL));
$$;
SELECT delete_test.ok(delete_test.no_orphans(),'no fixture orphans');


GRANT USAGE ON SCHEMA delete_test TO anon,service_role;
-- Extend snapshots with durable jobs; no worker/API privileges are installed.
CREATE FUNCTION delete_test.full_snapshot() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('data',delete_test.snapshot(),
 'tombstones',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.band_id),'[]') FROM private.band_deletion_tombstones r),
 'operations',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.operation_id),'[]') FROM private.band_deletion_operations r),
 'receipts',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.operation_id),'[]') FROM private.band_deletion_receipts r),'jobs',
 (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY j.operation_id),'[]') FROM private.band_logo_cleanup_jobs j));
$$;
CREATE FUNCTION delete_test.expect(query text,state text,label text,expected_message text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE caught text; msg text;
BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE,msg=MESSAGE_TEXT; END;
 PERFORM delete_test.ok(caught=state AND (expected_message IS NULL OR msg=expected_message),label);
END $$;
CREATE FUNCTION delete_test.fail_band_delete() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Synthetic deletion failure'; END $$;
CREATE TRIGGER delete_test_failure BEFORE DELETE ON public.bands FOR EACH ROW EXECUTE FUNCTION delete_test.fail_band_delete();
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL ROLE authenticated;
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Synthetic band 1','dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'PZ001','injected failure after queue insertion and task deletion');
RESET ROLE;
SELECT delete_test.ok((SELECT count(*)=3 FROM public.bands),'injected failure restores band');
SELECT delete_test.ok((SELECT count(*)=9 FROM public.tasks),'injected failure restores tasks');
SELECT delete_test.ok((SELECT count(*)=9 FROM public.task_assignees),'injected failure restores assignments');
SELECT delete_test.ok(NOT EXISTS(SELECT 1 FROM private.band_logo_cleanup_jobs),'injected failure leaves no cleanup job');
DROP TRIGGER delete_test_failure ON public.bands;
-- Fail after permanent identities, band deletion and receipt insertion.
CREATE TRIGGER delete_test_job_failure BEFORE INSERT ON private.band_logo_cleanup_jobs
FOR EACH ROW EXECUTE FUNCTION delete_test.fail_band_delete();
DO $$ DECLARE before jsonb:=delete_test.full_snapshot(); BEGIN
 PERFORM delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Synthetic band 1','dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'PZ001','late job failure');
 PERFORM delete_test.ok(before=delete_test.full_snapshot(),'late failure restores public data, identities, receipts and jobs');
END $$;
DROP TRIGGER delete_test_job_failure ON private.band_logo_cleanup_jobs;
-- A separate subtransaction verifies byte-identical rollback across all tables.
DO $$ DECLARE before jsonb:=delete_test.full_snapshot(); BEGIN
 BEGIN
  PERFORM public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Synthetic band 1','dddddddd-dddd-4ddd-8ddd-000000000001');
  RAISE EXCEPTION USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL; END;
 PERFORM delete_test.ok(before=delete_test.full_snapshot(),'caller rollback restores every row and removes cleanup job');
END $$;
SET LOCAL ROLE authenticated;
SELECT delete_test.expect($q$DELETE FROM public.bands WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001'$q$,'42501','authenticated cannot DELETE directly');
SELECT delete_test.expect($q$SELECT * FROM private.band_logo_cleanup_jobs$q$,'42501','queue read denied');
SELECT delete_test.expect($q$INSERT INTO private.band_logo_cleanup_jobs(band_id) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-000000000001')$q$,'42501','queue insert denied');
SELECT delete_test.expect($q$UPDATE private.band_logo_cleanup_jobs SET status='completed'$q$,'42501','queue modification denied');
SELECT delete_test.expect($q$DELETE FROM private.band_logo_cleanup_jobs$q$,'42501','queue deletion denied');
DO $$ DECLARE confirmation text; before jsonb:=delete_test.full_snapshot(); BEGIN
 FOREACH confirmation IN ARRAY ARRAY['wrong','synthetic band 1','Synthetic band 1 ',NULL] LOOP
  PERFORM delete_test.expect(pg_catalog.format('SELECT public.bandup_delete_band(%L,%L,%L)','bbbbbbbb-bbbb-4bbb-8bbb-000000000001',confirmation,'dddddddd-dddd-4ddd-8ddd-000000000001'),'22023','exact confirmation enforced');
 END LOOP;
 PERFORM delete_test.ok(before=delete_test.full_snapshot(),'invalid confirmations do not mutate data or queue');
END $$;
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL,'dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','common member denied before confirmation','Band unavailable');
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL,'dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','external denied','Band unavailable');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-999999999999',NULL,'dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','missing band same denial','Band unavailable');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band(NULL,NULL,'dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','NULL band same denial','Band unavailable');
SET LOCAL request.jwt.claim.sub='';
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL,'dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','missing identity denied','Band unavailable');
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
SET LOCAL request.jwt.claim.role='anon';
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL,'dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','wrong JWT role denied','Band unavailable');
SET LOCAL ROLE anon;
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL,'dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','anon lacks EXECUTE');
SET LOCAL ROLE service_role;
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001',NULL,'dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','service_role lacks EXECUTE');
SELECT delete_test.expect($q$SELECT * FROM private.band_logo_cleanup_jobs$q$,'42501','service_role has no queue access yet');
RESET ROLE;
-- Revocation before the call must be authoritative even for a former admin.
UPDATE public.band_members SET role='member' WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000002' AND user_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','Synthetic band 2','dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','demoted admin denied','Band unavailable');
RESET ROLE;
UPDATE public.band_members SET role='admin' WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000002' AND user_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
SET LOCAL ROLE authenticated;
DO $$ DECLARE i int; target uuid; operation uuid; result jsonb; other jsonb; BEGIN
 FOR i IN 1..2 LOOP
  target:=('bbbbbbbb-bbbb-4bbb-8bbb-'||pg_catalog.lpad(i::text,12,'0'))::uuid;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',CASE WHEN i=1 THEN 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001' ELSE 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003' END,true);
  operation:=('dddddddd-dddd-4ddd-8ddd-'||pg_catalog.lpad(i::text,12,'0'))::uuid;
  other:=delete_test.snapshot('bbbbbbbb-bbbb-4bbb-8bbb-000000000003');
  result:=public.bandup_delete_band(target,'Synthetic band '||i,operation);
  PERFORM delete_test.ok(result->>'status'='deleted' AND result->>'cleanup_status'='pending' AND (SELECT count(*)=3 FROM pg_catalog.jsonb_object_keys(result)),'minimal RPC result '||i);
  PERFORM delete_test.ok((SELECT bool_and(pg_catalog.jsonb_array_length(value)=0) FROM pg_catalog.jsonb_each(delete_test.snapshot(target)) WHERE key<>'users'),'all band dependencies gone '||i);
  PERFORM delete_test.ok(delete_test.no_orphans(),'no orphans after RPC '||i);
  PERFORM delete_test.ok(other=delete_test.snapshot('bbbbbbbb-bbbb-4bbb-8bbb-000000000003'),'other band and Auth users unchanged '||i);
  PERFORM delete_test.ok(result=public.bandup_delete_band(target,'Synthetic band '||i,operation),'exact replay returns original receipt '||i);
  PERFORM delete_test.ok(result=public.bandup_get_band_deletion(operation),'actor can query receipt after membership is gone '||i);
 END LOOP;
END $$;
RESET ROLE;
SELECT delete_test.ok((SELECT count(*)=2 FROM private.band_logo_cleanup_jobs),'two durable jobs survive parent deletion');
SELECT delete_test.expect($q$UPDATE private.band_logo_cleanup_jobs SET band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000002' WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001'$q$,'42501','job cannot redirect its band');
SELECT delete_test.expect($q$UPDATE private.band_logo_cleanup_jobs SET operation_id='dddddddd-dddd-4ddd-8ddd-000000000002' WHERE operation_id='dddddddd-dddd-4ddd-8ddd-000000000001'$q$,'42501','job cannot redirect its operation');
SELECT delete_test.ok((SELECT bool_and(bucket_id='band-logos' AND object_prefix=band_id::text||'/' AND status='pending' AND attempts=0 AND lease_until IS NULL AND completed_at IS NULL) FROM private.band_logo_cleanup_jobs),'exact bucket/prefix and retry defaults');
SELECT delete_test.ok(NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid IN ('private.band_logo_cleanup_jobs'::regclass,'private.band_deletion_receipts'::regclass) AND contype='f' AND confrelid IN ('public.bands'::regclass,'auth.users'::regclass)),'queue independent of deleted band/account');
SELECT delete_test.ok((SELECT prosecdef AND proowner='postgres'::regrole AND proconfig @> ARRAY['search_path=""','row_security=off'] FROM pg_catalog.pg_proc WHERE oid='public.bandup_delete_band(uuid,text,uuid)'::regprocedure),'definer metadata');
-- New recovery, immutable identity and receipt isolation checks.
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
SET LOCAL ROLE authenticated;
SELECT delete_test.ok(public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000001')->>'status'='deleted','lost response recovered by original actor');
SELECT delete_test.ok(public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000002') IS NULL,'admin of both bands cannot read another actor receipt');
SELECT delete_test.ok(public.bandup_get_band_deletion('eeeeeeee-eeee-4eee-8eee-000000000001') IS NULL,'unknown receipt indistinguishable from foreign receipt');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000003','Synthetic band 3','dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','same operation cannot target another band','Band unavailable');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','wrong','dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','replay confirmation must match original bytes');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000003','Synthetic band 3',NULL)$q$,'22023','operation identifier mandatory');
SELECT delete_test.expect($q$INSERT INTO public.bands(id,name,slug) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Recreated','recreated')$q$,'42501','cannot recreate deleted UUID');
SELECT delete_test.expect($q$UPDATE public.bands SET id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-000000000003'$q$,'42501','cannot move existing band into deleted UUID');
SELECT delete_test.expect($q$SELECT * FROM private.band_deletion_receipts$q$,'42501','raw receipts private');
SELECT delete_test.expect($q$DELETE FROM private.band_deletion_receipts$q$,'42501','users cannot remove tombstones');
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
SELECT delete_test.ok(public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000001') IS NULL,'external cannot query known operation');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Synthetic band 1','dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','another actor cannot replay operation','Band unavailable');
SET LOCAL ROLE anon;
SELECT delete_test.expect($q$SELECT public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','anon cannot call receipt RPC');
SET LOCAL ROLE service_role;
SELECT delete_test.expect($q$SELECT public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000001')$q$,'42501','service_role cannot call receipt RPC');
RESET ROLE;
-- Simulate future job retention/cleanup: identity and receipt must survive even then.
DELETE FROM private.band_logo_cleanup_jobs WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
SET LOCAL ROLE authenticated;
SELECT delete_test.expect($q$INSERT INTO public.bands(id,name,slug) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','Recreated','recreated')$q$,'42501','tombstone survives job deletion');
SELECT delete_test.ok(public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000001')->>'cleanup_status'='not_available','receipt survives job retention without inventing completion');
RESET ROLE;
SELECT delete_test.expect($q$DELETE FROM private.band_deletion_receipts$q$,'42501','tombstones immutable even to ordinary owner DML');
SELECT delete_test.expect($q$UPDATE private.band_deletion_receipts SET requested_by='aaaaaaaa-aaaa-4aaa-8aaa-000000000004'$q$,'42501','receipt actor cannot be rewritten');
SELECT delete_test.expect($q$TRUNCATE private.band_deletion_receipts CASCADE$q$,'42501','tombstone truncation blocked');
SELECT delete_test.ok((SELECT count(*)=1 FROM public.bands WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-000000000003'),'cross-band replay leaves live band intact');
SELECT delete_test.ok((SELECT count(*)=2 FROM private.band_deletion_receipts),'no duplicate receipts');
-- Private expiration cannot be invoked by any API role; owner cannot delete early.
SELECT delete_test.expect($q$SELECT private.expire_band_deletion_receipts(0)$q$,'22023','invalid purge batch rejected');
SELECT delete_test.expect($q$SELECT private.expire_band_deletion_receipts(NULL)$q$,'22023','null purge batch rejected');
SELECT delete_test.expect($q$SELECT private.expire_band_deletion_receipts(1001)$q$,'22023','oversized purge batch rejected');
SELECT delete_test.ok(private.expire_band_deletion_receipts()=0,'purge preserves unexpired receipts');
SELECT delete_test.ok((SELECT bool_and(expires_at=created_at+interval '2160 hours') FROM private.band_deletion_receipts),'exact 90 day retention');
SET LOCAL ROLE authenticated;
SELECT delete_test.expect($q$SELECT private.expire_band_deletion_receipts()$q$,'42501','authenticated cannot purge');
SELECT delete_test.expect($q$SELECT * FROM private.band_deletion_tombstones$q$,'42501','tombstones private');
SELECT delete_test.expect($q$SELECT * FROM private.band_deletion_operations$q$,'42501','operations private');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT delete_test.expect($q$SELECT private.expire_band_deletion_receipts()$q$,'42501','anon cannot purge');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT delete_test.expect($q$SELECT private.expire_band_deletion_receipts()$q$,'42501','service role cannot purge');
RESET ROLE;
-- Historical synthetic fixtures avoid changing clocks or weakening production guards.
INSERT INTO private.band_deletion_tombstones VALUES('eeeeeeee-eeee-4eee-8eee-000000000090');
INSERT INTO private.band_deletion_operations VALUES('dddddddd-dddd-4ddd-8ddd-000000000090');
INSERT INTO private.band_deletion_receipts(operation_id,band_id,requested_by,confirmation_bytes,created_at,expires_at)
VALUES('dddddddd-dddd-4ddd-8ddd-000000000090','eeeeeeee-eeee-4eee-8eee-000000000090',
 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',convert_to('Historical private name','UTF8'),
 statement_timestamp()-interval '91 days',statement_timestamp()-interval '1 day');
INSERT INTO private.band_logo_cleanup_jobs(operation_id,band_id)
VALUES('dddddddd-dddd-4ddd-8ddd-000000000090','eeeeeeee-eeee-4eee-8eee-000000000090');
SET LOCAL request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
SET LOCAL ROLE authenticated;
SELECT delete_test.ok(public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000090') IS NULL,'expired receipt hidden before physical purge');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('eeeeeeee-eeee-4eee-8eee-000000000090','Historical private name','dddddddd-dddd-4ddd-8ddd-000000000090')$q$,'42501','expired exact replay denied');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000003','Synthetic band 3','dddddddd-dddd-4ddd-8ddd-000000000090')$q$,'42501','expired operation cannot target live band');
RESET ROLE;
DO $$ DECLARE before jsonb:=delete_test.full_snapshot(); BEGIN
 BEGIN
  PERFORM delete_test.ok(private.expire_band_deletion_receipts(1)=1,'expired purge inside rollback');
  RAISE EXCEPTION USING ERRCODE='PZ001';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL; END;
 PERFORM delete_test.ok(before=delete_test.full_snapshot(),'purge rollback restores all rows');
END $$;
SELECT delete_test.ok(private.expire_band_deletion_receipts(1)=1,'bounded purge removes expired receipt');
SELECT delete_test.ok(private.expire_band_deletion_receipts(1)=0,'purge is repeatable');
SELECT delete_test.ok(NOT EXISTS(SELECT 1 FROM private.band_deletion_receipts WHERE operation_id='dddddddd-dddd-4ddd-8ddd-000000000090'),'expired personal data removed');
SELECT delete_test.ok(EXISTS(SELECT 1 FROM private.band_deletion_tombstones WHERE band_id='eeeeeeee-eeee-4eee-8eee-000000000090'),'purge preserves band tombstone');
SELECT delete_test.ok(EXISTS(SELECT 1 FROM private.band_deletion_operations WHERE operation_id='dddddddd-dddd-4ddd-8ddd-000000000090'),'purge preserves consumed operation');
SELECT delete_test.ok(EXISTS(SELECT 1 FROM private.band_logo_cleanup_jobs WHERE operation_id='dddddddd-dddd-4ddd-8ddd-000000000090' AND status='pending'),'pending cleanup survives purge');
SELECT delete_test.ok((SELECT count(*)=2 FROM private.band_deletion_receipts),'purge preserves other unexpired receipts');
SET LOCAL ROLE authenticated;
SELECT delete_test.ok(public.bandup_get_band_deletion('dddddddd-dddd-4ddd-8ddd-000000000090') IS NULL,'purged receipt stays unavailable');
SELECT delete_test.expect($q$SELECT public.bandup_delete_band('bbbbbbbb-bbbb-4bbb-8bbb-000000000003','Synthetic band 3','dddddddd-dddd-4ddd-8ddd-000000000090')$q$,'42501','purged operation cannot be reused');
SELECT delete_test.expect($q$INSERT INTO public.bands(id,name,slug) VALUES('eeeeeeee-eeee-4eee-8eee-000000000090','Recreated','purged-recreation')$q$,'42501','purged receipt never releases band UUID');
RESET ROLE;
SELECT delete_test.expect($q$DELETE FROM private.band_deletion_tombstones$q$,'42501','permanent tombstones cannot be deleted');
SELECT delete_test.expect($q$UPDATE private.band_deletion_tombstones SET band_id=band_id$q$,'42501','permanent tombstones cannot be updated');
SELECT delete_test.expect($q$TRUNCATE private.band_deletion_tombstones CASCADE$q$,'42501','permanent tombstones cannot be truncated');
SELECT delete_test.expect($q$DELETE FROM private.band_deletion_operations$q$,'42501','consumed operations cannot be deleted');
SELECT delete_test.expect($q$UPDATE private.band_deletion_operations SET operation_id=operation_id$q$,'42501','consumed operations cannot be updated');
SELECT delete_test.expect($q$TRUNCATE private.band_deletion_operations CASCADE$q$,'42501','consumed operations cannot be truncated');
SELECT delete_test.ok((SELECT count(*)=1 FROM pg_catalog.pg_attribute WHERE attrelid='private.band_deletion_tombstones'::regclass AND attnum>0 AND NOT attisdropped),'permanent band record has only UUID');
SELECT delete_test.ok((SELECT count(*)=1 FROM pg_catalog.pg_attribute WHERE attrelid='private.band_deletion_operations'::regclass AND attnum>0 AND NOT attisdropped),'permanent operation record has only UUID');
SELECT delete_test.ok(NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='private.band_logo_cleanup_jobs'::regclass AND attname='requested_by' AND NOT attisdropped),'jobs retain no actor');
SELECT delete_test.ok(NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='private.band_logo_cleanup_jobs'::regclass AND confrelid='private.band_deletion_receipts'::regclass),'jobs have no receipt FK');
SELECT delete_test.ok((SELECT count(*)=1 FROM public.bands WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-000000000003'),'purge and replay preserve control band');
SELECT 'RPC_ASSERTIONS:'||count(*) FROM delete_test.results;
ROLLBACK;
