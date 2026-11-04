-- PREPARED, NOT EXECUTED. Synthetic isolated database only. Never bandup-demo/live users.
\set ON_ERROR_STOP on
BEGIN;
DO $execution_disabled$
BEGIN
  RAISE EXCEPTION 'Band entry test target not reviewed; execution disabled';
END;
$execution_disabled$;
-- Future approved harness must pin database/cluster/host identity before this point.
-- Requires candidate installed and the reviewed initial Auth/bands/membership contracts.
CREATE FUNCTION pg_temp.assert_true(ok BOOLEAN,label TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; END;
$$;
CREATE FUNCTION pg_temp.expect_error(command TEXT,expected TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actual TEXT;
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE;
    IF actual=expected THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE %, command succeeded',expected;
END;
$$;
CREATE FUNCTION pg_temp.actor(user_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',user_id,true);
  PERFORM pg_catalog.set_config('request.jwt.claims',pg_catalog.json_build_object('sub',NULLIF(user_id,''),'role','authenticated')::text,true);
END;
$$;

-- Collision = failure. These are fictitious users; never reuse existing identities.
INSERT INTO auth.users(id) VALUES
 ('b1000000-0000-0000-0000-000000000001'), -- admin A
 ('b1000000-0000-0000-0000-000000000002'), -- admin B
 ('b1000000-0000-0000-0000-000000000003'), -- applicant
 ('b1000000-0000-0000-0000-000000000004'), -- outsider/applicant
 ('b1000000-0000-0000-0000-000000000005'); -- ordinary member A
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000001');
INSERT INTO public.bands(id,name,slug) VALUES('b2000000-0000-0000-0000-000000000001','Synthetic A','join-proposal-a');
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000002');
INSERT INTO public.bands(id,name,slug) VALUES('b2000000-0000-0000-0000-000000000002','Synthetic B','join-proposal-b');
INSERT INTO public.band_members(band_id,user_id,role) VALUES
 ('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000005','member');

SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.bandup_discover_bands()),'default not discoverable');
SELECT public.bandup_set_discovery('b2000000-0000-0000-0000-000000000001','Public label','Public summary',true);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.bandup_discover_bands()),'explicit opt in only');
SELECT pg_temp.expect_error('SELECT * FROM public.bandup_discover_bands(NULL,51)','22023');
SELECT pg_temp.expect_error('SELECT * FROM public.band_join_directory','42501');

SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000003');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.bands WHERE id='b2000000-0000-0000-0000-000000000001'),'discovery does not open base band');
SELECT pg_temp.expect_error($q$SELECT public.bandup_request_entry('b2000000-0000-0000-0000-000000000002','Applicant')$q$,'42501');
SELECT public.bandup_request_entry('b2000000-0000-0000-0000-000000000001','Applicant') AS request_id \gset
SELECT pg_temp.expect_error($q$SELECT public.bandup_request_entry('b2000000-0000-0000-0000-000000000001','Duplicate')$q$,'23505');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.band_join_requests),'own request visible');
SELECT pg_temp.expect_error($q$INSERT INTO public.band_members(band_id,user_id,role) VALUES
 ('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000003','admin')$q$,'42501');
SELECT pg_temp.expect_error($q$INSERT INTO public.band_join_requests(band_id,requester_id,applicant_name,status) VALUES
 ('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000004','Forged','approved')$q$,'42501');
SELECT pg_temp.expect_error('UPDATE public.band_join_requests SET status=''approved''','42501');
SELECT pg_temp.expect_error('DELETE FROM public.band_join_requests','42501');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_decide_entry(%L,''approved'')',:'request_id'),'42501');

SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000005');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.band_join_requests),'ordinary member cannot see received requests');
SELECT pg_temp.expect_error($q$SELECT public.bandup_request_entry('b2000000-0000-0000-0000-000000000001','Member')$q$,'23505');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_decide_entry(%L,''approved'')',:'request_id'),'42501');
SELECT pg_temp.expect_error($q$SELECT public.bandup_set_discovery('b2000000-0000-0000-0000-000000000001','Hijack','',true)$q$,'42501');

SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000004');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.band_join_requests),'outsider cannot read applicant');
SELECT pg_temp.expect_error($q$SELECT * FROM public.bandup_get_discovery('b2000000-0000-0000-0000-000000000001')$q$,'42501');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_cancel_entry(%L)',:'request_id'),'42501');
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000002');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.band_join_requests),'other band admin cannot read requests');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_decide_entry(%L,''approved'')',:'request_id'),'42501');

SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000001');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.band_join_requests),'admin reads incoming request');
SELECT pg_temp.expect_error($q$SELECT public.bandup_request_entry('b2000000-0000-0000-0000-000000000001','   ')$q$,'22023');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_decide_entry(%L,''admin'')',:'request_id'),'22023');
SELECT public.bandup_decide_entry(:'request_id','approved');
SELECT pg_temp.assert_true((SELECT role='member' FROM public.band_members WHERE band_id='b2000000-0000-0000-0000-000000000001'
 AND user_id='b1000000-0000-0000-0000-000000000003'),'approval only grants member');
SELECT pg_temp.assert_true((SELECT status='approved' AND decided_at IS NOT NULL AND decided_by=auth.uid()
 FROM public.band_join_requests WHERE id=:'request_id'),'decision recorded');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_decide_entry(%L,''approved'')',:'request_id'),'55000');
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000003');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.bands WHERE id='b2000000-0000-0000-0000-000000000001'),'approved applicant can access band');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_cancel_entry(%L)',:'request_id'),'55000');

-- Cancel, resubmit, reject: terminal rows retained; only one pending row is allowed.
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000004');
SELECT public.bandup_request_entry('b2000000-0000-0000-0000-000000000001','Applicant 2') AS cancelled_id \gset
SELECT public.bandup_cancel_entry(:'cancelled_id');
SELECT pg_temp.assert_true((SELECT status='cancelled' AND cancelled_at IS NOT NULL FROM public.band_join_requests WHERE id=:'cancelled_id'),'own cancellation');
SELECT public.bandup_request_entry('b2000000-0000-0000-0000-000000000001','Applicant 2') AS rejected_id \gset
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000001');
SELECT public.bandup_decide_entry(:'rejected_id','rejected');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.band_members WHERE band_id='b2000000-0000-0000-0000-000000000001'
 AND user_id='b1000000-0000-0000-0000-000000000004'),'rejection creates no membership');

-- Inject a failure AFTER the membership INSERT, into the NEW requests table only.
RESET ROLE;
CREATE FUNCTION public.bandup_proposal_test_fail_approval() RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.applicant_name='Atomic failure' AND NEW.status='approved' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic approval failure';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bandup_proposal_test_fail_approval() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER synthetic_approval_failure BEFORE UPDATE ON public.band_join_requests
 FOR EACH ROW EXECUTE FUNCTION public.bandup_proposal_test_fail_approval();
SET LOCAL ROLE authenticated;
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000004');
SELECT public.bandup_request_entry('b2000000-0000-0000-0000-000000000001','Atomic failure') AS atomic_id \gset
SELECT pg_temp.actor('b1000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_decide_entry(%L,''approved'')',:'atomic_id'),'23514');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.band_members WHERE band_id='b2000000-0000-0000-0000-000000000001'
 AND user_id='b1000000-0000-0000-0000-000000000004'),'failed decision rolls membership back');
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.band_join_requests WHERE id=:'atomic_id'),'failed decision keeps request pending');
RESET ROLE;
DROP TRIGGER synthetic_approval_failure ON public.band_join_requests;
DROP FUNCTION public.bandup_proposal_test_fail_approval();

-- An out-of-band legitimate admin addition must not be promoted/overwritten by approval.
INSERT INTO public.band_members(band_id,user_id,role) VALUES
 ('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000004','member');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_decide_entry(%L,''approved'')',:'atomic_id'),'23505');
SELECT pg_temp.assert_true((SELECT status='pending' FROM public.band_join_requests WHERE id=:'atomic_id'),'duplicate membership does not change decision');
SELECT public.bandup_set_discovery('b2000000-0000-0000-0000-000000000001','Public label','Public summary',false);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.bandup_discover_bands()),'closing discovery hides the band');

-- Missing claims cannot use privileged RPCs even with the authenticated SQL role.
SELECT pg_temp.actor('');
SELECT pg_temp.expect_error('SELECT * FROM public.bandup_discover_bands()','42501');
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT * FROM public.band_join_requests','42501');
SELECT pg_temp.expect_error('SELECT * FROM public.bandup_discover_bands()','42501');
SELECT pg_temp.expect_error(pg_catalog.format('SELECT public.bandup_decide_entry(%L,''approved'')',:'atomic_id'),'42501');
RESET ROLE;
-- Owner/privilege assertions: no application role may write new sources directly.
SELECT pg_temp.assert_true(NOT pg_catalog.has_table_privilege('authenticated','public.band_join_requests','INSERT')
 AND NOT pg_catalog.has_table_privilege('authenticated','public.band_join_requests','UPDATE')
 AND NOT pg_catalog.has_table_privilege('authenticated','public.band_join_requests','DELETE'),'RPC-only mutations');
SELECT pg_temp.assert_true(NOT pg_catalog.has_function_privilege('anon','public.bandup_request_entry(uuid,text)','EXECUTE')
 AND NOT pg_catalog.has_function_privilege('service_role','public.bandup_request_entry(uuid,text)','EXECUTE'),'restricted RPC execution');
ROLLBACK;
