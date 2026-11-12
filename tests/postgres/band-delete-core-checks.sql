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

-- Roll back both the trigger UPDATE and the member removal after inspecting them.
DO $$ DECLARE before jsonb:=delete_test.snapshot(); BEGIN
 BEGIN
  DELETE FROM public.band_members WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001' AND user_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
  PERFORM delete_test.ok(NOT EXISTS(SELECT 1 FROM public.tasks WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001' AND assigned_to IS NOT NULL),'real member-removal trigger cleared task assignment');
  PERFORM delete_test.ok(NOT EXISTS(SELECT 1 FROM public.task_assignees WHERE band_id='bbbbbbbb-bbbb-4bbb-8bbb-000000000001' AND user_id='aaaaaaaa-aaaa-4aaa-8aaa-000000000002'),'member cascade and legacy bridge remove assignments');
  RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Synthetic failure after trigger update';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
 END;
 PERFORM delete_test.ok(delete_test.snapshot()=before,'rollback restores membership and triggered task updates');
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE target uuid; actor uuid; i int; before jsonb; other jsonb; affected int; deleted jsonb; caught text; constraint_name text; BEGIN
 FOR i IN 1..2 LOOP
  target:=('bbbbbbbb-bbbb-4bbb-8bbb-'||lpad(i::text,12,'0'))::uuid;
  actor:=CASE WHEN i=1 THEN 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid ELSE 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'::uuid END;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  before:=delete_test.snapshot(); other:=delete_test.snapshot('bbbbbbbb-bbbb-4bbb-8bbb-000000000003');
  PERFORM delete_test.ok((SELECT count(*)=i FROM public.band_members WHERE band_id=target AND role='admin'),'administrator count before cascade '||i);
  -- Reproduce the actual local defect without changing any production trigger.
  caught:=NULL; constraint_name:=NULL;
  BEGIN
   DELETE FROM public.bands WHERE id=target;
  EXCEPTION WHEN foreign_key_violation THEN
   GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE, constraint_name=CONSTRAINT_NAME;
  END;
  PERFORM delete_test.ok(caught='23503' AND constraint_name='tasks_band_id_fkey','direct cascade reproduces task-parent FK violation '||i);
  PERFORM delete_test.ok(delete_test.snapshot()=before,'failed direct cascade rolls back all rows '||i);
  RAISE NOTICE 'DIRECT_CASCADE_REJECTED:23503:tasks_band_id_fkey';
  -- Diagnostic alternative only: remove tasks first, then let parent cascades run.
  BEGIN
   DELETE FROM public.tasks WHERE band_id=target;
   DELETE FROM public.bands WHERE id=target;
   GET DIAGNOSTICS affected=ROW_COUNT;
   PERFORM delete_test.ok(affected=1,'one parent removed before forced rollback '||i);
   PERFORM delete_test.ok(NOT EXISTS(SELECT 1 FROM public.tasks WHERE band_id=target),'tasks gone before forced rollback '||i);
   RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Synthetic error after cascade';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
  END;
  PERFORM delete_test.ok(delete_test.snapshot()=before,'complete rollback after cascade '||i);
  DELETE FROM public.tasks WHERE band_id=target;
  DELETE FROM public.bands WHERE id=target;
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM delete_test.ok(affected=1,'tasks-first diagnostic deletes one band '||i);
  deleted:=delete_test.snapshot(target);
  PERFORM delete_test.ok(jsonb_array_length(deleted->'bands')=0,'band removed '||i);
  PERFORM delete_test.ok(jsonb_array_length(deleted->'members')=0,'members removed including last admin '||i);
  PERFORM delete_test.ok(jsonb_array_length(deleted->'tasks')=0,'assigned and unassigned tasks removed '||i);
  PERFORM delete_test.ok(jsonb_array_length(deleted->'events')=0,'events removed '||i);
  PERFORM delete_test.ok(jsonb_array_length(deleted->'links')=0,'social links removed '||i);
  PERFORM delete_test.ok(jsonb_array_length(deleted->'assignees')=0,'multi and scalar assignees removed '||i);
  PERFORM delete_test.ok(jsonb_array_length(deleted->'requests')=0,'requests in all states removed '||i);
  PERFORM delete_test.ok(jsonb_array_length(deleted->'directory')=0,'discovery directory removed '||i);
  PERFORM delete_test.ok(delete_test.no_orphans(),'no orphans after controlled deletion '||i);
  PERFORM delete_test.ok(delete_test.snapshot('bbbbbbbb-bbbb-4bbb-8bbb-000000000003')=other,'other band and Auth users byte-equivalent '||i);
 END LOOP;
END $$;
-- RLS denial is tested on the surviving band, not inferred from an absent target.
DO $$ DECLARE actor uuid; before jsonb:=delete_test.snapshot(); affected int; BEGIN
 FOREACH actor IN ARRAY ARRAY['aaaaaaaa-aaaa-4aaa-8aaa-000000000002'::uuid,'aaaaaaaa-aaaa-4aaa-8aaa-000000000004'::uuid] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  DELETE FROM public.bands WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-000000000003';
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM delete_test.ok(affected=0 AND delete_test.snapshot()=before,'member or external cannot delete');
 END LOOP;
END $$;
RESET ROLE;
SELECT 'SQL_ASSERTIONS:'||count(*) FROM delete_test.results;
ROLLBACK;
