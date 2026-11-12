-- Executed only in the existing fresh isolated test cluster with synthetic fixtures.
BEGIN;
SELECT cron_test.ok((SELECT count(*)=1 FROM cron.job WHERE jobname='bandup-band-deletion-receipts-purge'
 AND username='postgres' AND active AND schedule='0,5,15 3 * * *'
 AND command='SET statement_timeout = ''30s''; SELECT private.run_band_deletion_receipts_purge();'),'one bounded daily job with two retry passes');
SELECT cron_test.ok((SELECT count(*)=1 FROM cron.job WHERE jobname='unrelated-control'),'unrelated schedule preserved');
SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM private.band_deletion_purge_runs),'install never runs purge');
SELECT cron_test.ok((SELECT relrowsecurity FROM pg_class WHERE oid='private.band_deletion_purge_runs'::regclass),'metrics RLS');
SELECT cron_test.ok((SELECT prosecdef AND proowner='postgres'::regrole AND proconfig @> ARRAY['search_path=""','row_security=off','lock_timeout=3s']
 FROM pg_proc WHERE oid='private.run_band_deletion_receipts_purge()'::regprocedure),'runner security metadata');
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT status='succeeded' AND removed=0 AND batches=1 AND attempts=1 AND backlog_at_least=0
 FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'empty run preserves unexpired receipt');
SELECT cron_test.ok((SELECT count(*)=1 FROM private.band_deletion_receipts),'unexpired receipt remains');
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM cron_test.ok(NOT has_function_privilege(role_name,'private.run_band_deletion_receipts_purge()','EXECUTE'),'runner denied to '||role_name);
  PERFORM cron_test.ok(NOT has_table_privilege(role_name,'private.band_deletion_purge_runs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'metrics denied to '||role_name);
  PERFORM cron_test.ok(NOT has_sequence_privilege(role_name,'private.band_deletion_purge_runs_run_id_seq','USAGE,SELECT,UPDATE'),'sequence denied to '||role_name);
 END LOOP;
END $$;

SELECT cron_test.seed_expired(2501);
INSERT INTO private.band_logo_cleanup_jobs(operation_id,band_id)
VALUES(md5('cron-operation:1')::uuid,md5('cron-band:1')::uuid);
DO $$ DECLARE before_data jsonb:=delete_test.snapshot(); ids jsonb; jobs jsonb; BEGIN
 SELECT jsonb_build_object('bands',(SELECT jsonb_agg(b ORDER BY band_id) FROM private.band_deletion_tombstones b),
 'ops',(SELECT jsonb_agg(o ORDER BY operation_id) FROM private.band_deletion_operations o)) INTO ids;
 SELECT jsonb_agg(j ORDER BY operation_id) INTO jobs FROM private.band_logo_cleanup_jobs j;
 PERFORM private.run_band_deletion_receipts_purge();
 PERFORM cron_test.ok((SELECT status='succeeded' AND removed=2501 AND batches=3 AND attempts=3 AND backlog_at_least=0
 FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'real 1000/1000/501 batches');
 PERFORM cron_test.ok(before_data=delete_test.snapshot(),'all bands and dependencies unchanged');
 PERFORM cron_test.ok(ids=jsonb_build_object('bands',(SELECT jsonb_agg(b ORDER BY band_id) FROM private.band_deletion_tombstones b),
 'ops',(SELECT jsonb_agg(o ORDER BY operation_id) FROM private.band_deletion_operations o)),'permanent identities preserved');
 PERFORM cron_test.ok(jobs=(SELECT jsonb_agg(j ORDER BY operation_id) FROM private.band_logo_cleanup_jobs j),'pending logos jobs preserved');
END $$;

SELECT cron_test.seed_expired(1,3000);
ALTER SEQUENCE cron_test.failure_attempts RESTART WITH 1;
UPDATE cron_test.failure_mode SET mode='transient';
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT status='succeeded' AND removed=1 AND attempts=3 AND batches=1 AND error_sqlstate IS NULL
 FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'two transient failures then successful third attempt');

SELECT cron_test.seed_expired(1,3001);
UPDATE cron_test.failure_mode SET mode='exhausted';
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT status='failed' AND removed=0 AND attempts=3 AND batches=0 AND error_sqlstate='40001' AND backlog_at_least=1
 FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'retry exhaustion recorded without data loss');
UPDATE cron_test.failure_mode SET mode='permanent';
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT status='failed' AND attempts=1 AND error_sqlstate='PZ001' FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'nontransient failure is not retried');
SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM private.band_deletion_purge_runs r
 WHERE to_jsonb(r)::text LIKE '%Sensitive private fixture%'),'metrics contain no error message or personal confirmation');
UPDATE cron_test.failure_mode SET mode='off';
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT status='succeeded' AND removed=1 FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'next scheduled pass safely retries failed run');

SELECT cron_test.seed_expired(1501,4000);
ALTER SEQUENCE cron_test.failure_attempts RESTART WITH 1;
UPDATE cron_test.failure_mode SET mode='late';
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT status='failed' AND removed=1000 AND batches=1 AND attempts=2 AND backlog_at_least=501
 FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'late failure preserves completed batches and rolls back failed batch');
UPDATE cron_test.failure_mode SET mode='off';
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT removed=501 AND status='succeeded' FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'late failure retried safely');

SELECT cron_test.seed_expired(20001,10000);
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT status='limited' AND removed BETWEEN 1 AND 20000 AND batches BETWEEN 1 AND 20 AND attempts<=60 AND backlog_at_least>0
 FROM private.band_deletion_purge_runs ORDER BY run_id DESC LIMIT 1),'batch/time limit leaves measurable backlog');
SELECT private.run_band_deletion_receipts_purge();
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM private.band_deletion_receipts WHERE expires_at<=clock_timestamp()),'bounded subsequent passes drain backlog');

INSERT INTO private.band_deletion_purge_runs(started_at,finished_at,status,batches,attempts,removed)
SELECT clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days','succeeded',0,0,0 FROM generate_series(1,1005);
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok((SELECT count(*)=5 FROM private.band_deletion_purge_runs WHERE started_at<clock_timestamp()-interval '30 days'),'metric retention deletes at most 1000 per pass');
SELECT private.run_band_deletion_receipts_purge();
SELECT cron_test.ok(NOT EXISTS(SELECT 1 FROM private.band_deletion_purge_runs WHERE started_at<clock_timestamp()-interval '30 days'),'next pass finishes metric retention');
SELECT cron_test.ok((SELECT count(*)=11 FROM pg_attribute WHERE attrelid='private.band_deletion_purge_runs'::regclass AND attnum>0 AND NOT attisdropped),'metrics contain only eleven aggregate columns');
SELECT 'CRON_ASSERTIONS:'||count(*) FROM cron_test.results;
ROLLBACK;
