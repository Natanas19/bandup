-- Isolated synthetic cluster only. All fixture data changes are rolled back.
BEGIN;
CREATE SCHEMA logo_worker_test;
GRANT USAGE ON SCHEMA logo_worker_test TO anon,authenticated,service_role;
CREATE TABLE logo_worker_test.results(label text);
CREATE FUNCTION logo_worker_test.ok(value boolean,label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Logo worker assertion failed: %',label; END IF;
 INSERT INTO logo_worker_test.results VALUES(label);
END $$;
CREATE FUNCTION logo_worker_test.expect(query text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text; BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE; END;
 PERFORM logo_worker_test.ok(actual=expected,'expected SQLSTATE '||expected);
END $$;
-- Existing jobs are synthetic fixtures; postpone them only inside this rollback transaction.
UPDATE private.band_logo_cleanup_jobs SET next_attempt_at='infinity';
INSERT INTO private.band_deletion_tombstones VALUES(md5('worker-band:1')::uuid),('bbbbbbbb-bbbb-4bbb-8bbb-000000000003');
INSERT INTO private.band_deletion_operations VALUES(md5('worker-op:1')::uuid),(md5('worker-live-op')::uuid);
INSERT INTO private.band_logo_cleanup_jobs(operation_id,band_id) VALUES
 (md5('worker-op:1')::uuid,md5('worker-band:1')::uuid),
 (md5('worker-live-op')::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-000000000003');
DO $$ DECLARE role_name text; signature text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM logo_worker_test.ok(NOT has_table_privilege(role_name,'private.band_logo_cleanup_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'queue remains private for '||role_name);
  FOREACH signature IN ARRAY ARRAY['public.bandup_claim_band_logo_cleanup(uuid)',
   'public.bandup_renew_band_logo_cleanup(uuid,uuid)','public.bandup_finish_band_logo_cleanup(uuid,uuid,text)'] LOOP
   PERFORM logo_worker_test.ok(has_function_privilege(role_name,signature,'EXECUTE')=(role_name='service_role'),'exact worker execute grant for '||role_name);
   PERFORM logo_worker_test.ok(NOT has_function_privilege(role_name,signature,'EXECUTE WITH GRANT OPTION'),'no worker grant option');
  END LOOP;
 END LOOP;
END $$;
SET LOCAL request.jwt.claim.role='authenticated';
SELECT logo_worker_test.expect($q$SELECT public.bandup_claim_band_logo_cleanup(gen_random_uuid())$q$,'42501');
SET LOCAL ROLE authenticated;
SELECT logo_worker_test.expect($q$SELECT public.bandup_claim_band_logo_cleanup(gen_random_uuid())$q$,'42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT logo_worker_test.expect($q$SELECT public.bandup_claim_band_logo_cleanup(gen_random_uuid())$q$,'42501');
RESET ROLE;
SET LOCAL request.jwt.claim.role='service_role';
SELECT logo_worker_test.expect($q$SELECT public.bandup_claim_band_logo_cleanup(NULL)$q$,'22023');
SELECT logo_worker_test.expect($q$SELECT public.bandup_finish_band_logo_cleanup(NULL,NULL,'wrong')$q$,'22023');
SET LOCAL ROLE service_role;
SELECT public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000001');
RESET ROLE;
SELECT logo_worker_test.ok((SELECT status='processing' AND attempts=1 AND lease_token='aaaaaaaa-0000-4000-8000-000000000001'
 FROM private.band_logo_cleanup_jobs WHERE operation_id=md5('worker-op:1')::uuid),'service role claims authorized deleted band');
SELECT logo_worker_test.ok((SELECT status='pending' AND lease_token IS NULL
 FROM private.band_logo_cleanup_jobs WHERE operation_id=md5('worker-live-op')::uuid),'live band job never authorized');
SELECT logo_worker_test.ok(public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000001')->>'operation_id'=md5('worker-op:1')::uuid::text,'lost claim response recovered');
SELECT logo_worker_test.ok((SELECT attempts=1 FROM private.band_logo_cleanup_jobs WHERE operation_id=md5('worker-op:1')::uuid),'replayed claim does not increment attempts');
SELECT logo_worker_test.ok(public.bandup_claim_band_logo_cleanup(gen_random_uuid()) IS NULL,'active lease not claimable');
SELECT logo_worker_test.ok(NOT public.bandup_renew_band_logo_cleanup(md5('worker-live-op')::uuid,'aaaaaaaa-0000-4000-8000-000000000001'),'lease cannot redirect to another operation');
SELECT logo_worker_test.ok(public.bandup_finish_band_logo_cleanup(md5('worker-live-op')::uuid,'aaaaaaaa-0000-4000-8000-000000000001','empty') IS NULL,'finish cannot target live band');
SELECT logo_worker_test.ok(public.bandup_renew_band_logo_cleanup(md5('worker-op:1')::uuid,'aaaaaaaa-0000-4000-8000-000000000001'),'valid lease renewal');
UPDATE private.band_logo_cleanup_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=md5('worker-op:1')::uuid;
SELECT public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000002');
SELECT logo_worker_test.ok(NOT public.bandup_renew_band_logo_cleanup(md5('worker-op:1')::uuid,'aaaaaaaa-0000-4000-8000-000000000001'),'stale lease renewal rejected');
SELECT logo_worker_test.ok(public.bandup_finish_band_logo_cleanup(md5('worker-op:1')::uuid,'aaaaaaaa-0000-4000-8000-000000000001','empty') IS NULL,'stale finish rejected after takeover');
SELECT logo_worker_test.ok((SELECT attempts=2 AND lease_token='aaaaaaaa-0000-4000-8000-000000000002'
 FROM private.band_logo_cleanup_jobs WHERE operation_id=md5('worker-op:1')::uuid),'takeover preserved new owner');
SELECT logo_worker_test.ok(public.bandup_finish_band_logo_cleanup(md5('worker-op:1')::uuid,'aaaaaaaa-0000-4000-8000-000000000002','empty')='pending','first empty scan is not completion');
SELECT logo_worker_test.ok((SELECT attempts=0 AND empty_since IS NOT NULL AND lease_token IS NULL AND next_attempt_at>clock_timestamp()+interval '23 hours'
 FROM private.band_logo_cleanup_jobs WHERE operation_id=md5('worker-op:1')::uuid),'empty scan releases lease and schedules verification');
SELECT logo_worker_test.ok(public.bandup_finish_band_logo_cleanup(md5('worker-op:1')::uuid,'aaaaaaaa-0000-4000-8000-000000000002','retry') IS NULL,'repeated finish never overwrites prior outcome');
UPDATE private.band_logo_cleanup_jobs SET next_attempt_at=clock_timestamp()-interval '1 second',empty_since=clock_timestamp()-interval '25 hours'
 WHERE operation_id=md5('worker-op:1')::uuid;
SELECT public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000003');
SELECT logo_worker_test.ok(public.bandup_finish_band_logo_cleanup(md5('worker-op:1')::uuid,'aaaaaaaa-0000-4000-8000-000000000003','empty')='completed','second independent empty scan completes observation');
UPDATE private.band_logo_cleanup_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE operation_id=md5('worker-op:1')::uuid;
SELECT logo_worker_test.ok(public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000004') IS NOT NULL,'completed job is rechecked for late uploads');
SELECT logo_worker_test.ok(public.bandup_finish_band_logo_cleanup(md5('worker-op:1')::uuid,'aaaaaaaa-0000-4000-8000-000000000004','progress')='pending','late object progress reopens verification');
SELECT logo_worker_test.ok((SELECT empty_since IS NULL AND completed_at IS NULL AND attempts=0 FROM private.band_logo_cleanup_jobs WHERE operation_id=md5('worker-op:1')::uuid),'late upload invalidates old empty observation');
DO $$ DECLARE i integer; token uuid; result text; BEGIN
 FOR i IN 1..8 LOOP
  UPDATE private.band_logo_cleanup_jobs SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE operation_id=md5('worker-op:1')::uuid;
  token:=gen_random_uuid();
  PERFORM public.bandup_claim_band_logo_cleanup(token);
  result:=public.bandup_finish_band_logo_cleanup(md5('worker-op:1')::uuid,token,'retry');
  PERFORM logo_worker_test.ok(result=CASE WHEN i=8 THEN 'needs_attention' ELSE 'pending' END,'bounded retry '||i);
 END LOOP;
END $$;
SELECT logo_worker_test.ok(public.bandup_claim_band_logo_cleanup(gen_random_uuid()) IS NULL,'attention jobs are not automatically retried');
UPDATE private.band_logo_cleanup_jobs SET status='pending',attempts=0,next_attempt_at=clock_timestamp()-interval '1 second' WHERE operation_id=md5('worker-op:1')::uuid;
SELECT public.bandup_claim_band_logo_cleanup('aaaaaaaa-0000-4000-8000-000000000005');
SELECT logo_worker_test.ok(public.bandup_finish_band_logo_cleanup(md5('worker-op:1')::uuid,'aaaaaaaa-0000-4000-8000-000000000005','unsafe')='needs_attention','unsafe paths immediately require attention');
UPDATE private.band_logo_cleanup_jobs SET status='processing',attempts=8,lease_token=gen_random_uuid(),lease_until=clock_timestamp()-interval '1 second'
 WHERE operation_id=md5('worker-op:1')::uuid;
SELECT logo_worker_test.ok(public.bandup_claim_band_logo_cleanup(gen_random_uuid()) IS NULL,'crashed last attempt is not reclaimed');
SELECT logo_worker_test.ok((SELECT status='needs_attention' AND lease_token IS NULL AND last_error_code='lease_exhausted'
 FROM private.band_logo_cleanup_jobs WHERE operation_id=md5('worker-op:1')::uuid),'crashed last attempt surfaced for attention');
SELECT logo_worker_test.ok(EXISTS(SELECT 1 FROM public.bands WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-000000000003'),'control band preserved');
SELECT logo_worker_test.ok(EXISTS(SELECT 1 FROM private.band_deletion_tombstones WHERE band_id=md5('worker-band:1')::uuid),'permanent tombstone preserved');
SELECT logo_worker_test.ok(EXISTS(SELECT 1 FROM private.band_deletion_operations WHERE operation_id=md5('worker-op:1')::uuid),'permanent operation preserved');
SELECT 'LOGO_WORKER_ASSERTIONS:'||count(*) FROM logo_worker_test.results;
ROLLBACK;
