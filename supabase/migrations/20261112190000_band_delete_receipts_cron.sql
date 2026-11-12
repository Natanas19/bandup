-- Local implementation only. Separate authorization is required to apply remotely.
-- Does not change 20261112180000_band_delete.sql, its ACLs, or Storage objects.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $cron_required$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_cron') THEN
  RAISE EXCEPTION 'Enable the Supabase pg_cron extension before applying this migration';
 END IF;
 IF COALESCE(pg_catalog.current_setting('cron.database_name',true),'postgres')<>pg_catalog.current_database()
 OR COALESCE(pg_catalog.current_setting('cron.timezone',true),'GMT') NOT IN ('GMT','UTC','Etc/UTC')
 OR COALESCE(pg_catalog.current_setting('cron.launch_active_jobs',true),'on')<>'on' THEN
  RAISE EXCEPTION 'pg_cron must target this database, use UTC/GMT, and have active jobs enabled';
 END IF;
END $cron_required$;

DO $preflight$
DECLARE dependency oid:=pg_catalog.to_regprocedure('private.expire_band_deletion_receipts(integer)');
BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles
  WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Reviewed postgres executor with RLS bypass required';
 END IF;
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'READ COMMITTED required';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bandup-receipt-cron-install',0));
 IF pg_catalog.to_regprocedure('cron.schedule(name,text,text)') IS NULL
 OR pg_catalog.to_regprocedure('cron.unschedule(bigint)') IS NULL
 OR pg_catalog.to_regclass('cron.job') IS NULL THEN
  RAISE EXCEPTION 'Named pg_cron scheduling API is unavailable';
 END IF;
 IF dependency IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=dependency
  AND prokind='f' AND proowner='postgres'::regrole AND prosecdef
  AND prorettype='integer'::regtype AND proconfig @> ARRAY['search_path=""','row_security=off','lock_timeout=3s'])
 OR pg_catalog.to_regclass('private.band_deletion_receipts') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass('private.band_deletion_receipts_expiry_idx')
  AND indrelid='private.band_deletion_receipts'::regclass AND indisvalid AND indisready)
 THEN RAISE EXCEPTION 'Reviewed receipt expiration migration must already be installed'; END IF;
 IF pg_catalog.to_regclass('private.band_deletion_purge_runs') IS NOT NULL
 OR pg_catalog.to_regtype('private.band_deletion_purge_runs') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('private','public') AND p.proname='run_band_deletion_receipts_purge') THEN
  RAISE EXCEPTION 'Purge automation name collision; inspect destination';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
  WHERE p.oid=dependency AND (a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole OR a.is_grantable))
 OR pg_catalog.has_function_privilege('anon',dependency,'EXECUTE')
 OR pg_catalog.has_function_privilege('authenticated',dependency,'EXECUTE')
 OR pg_catalog.has_function_privilege('service_role',dependency,'EXECUTE') THEN
  RAISE EXCEPTION 'Expiration dependency has unexpected privileges';
 END IF;
END $preflight$;

-- Aggregated operational data only: no band/operation/user IDs, names or error text.
CREATE TABLE private.band_deletion_purge_runs (
 run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 started_at timestamptz NOT NULL,
 finished_at timestamptz NOT NULL CHECK(finished_at>=started_at),
 status text NOT NULL CHECK(status IN ('succeeded','limited','failed','skipped')),
 batches integer NOT NULL CHECK(batches BETWEEN 0 AND 20),
 attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND 60),
 removed integer NOT NULL CHECK(removed BETWEEN 0 AND 20000),
 backlog_at_least integer CHECK(backlog_at_least BETWEEN 0 AND 10001),
 backlog_capped boolean,
 oldest_expired_at timestamptz,
 error_sqlstate text CHECK(error_sqlstate ~ '^[0-9A-Z]{5}$')
);
CREATE INDEX band_deletion_purge_runs_started_idx ON private.band_deletion_purge_runs(started_at,run_id);
ALTER TABLE private.band_deletion_purge_runs OWNER TO postgres;
ALTER TABLE private.band_deletion_purge_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.band_deletion_purge_runs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE private.band_deletion_purge_runs_run_id_seq FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.run_band_deletion_receipts_purge() RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO '' SET row_security TO 'off' SET lock_timeout TO '3s'
AS $worker$
DECLARE
 started timestamptz:=pg_catalog.clock_timestamp();
 cutoff timestamptz; result_id bigint; state text:='limited'; code text;
 total integer:=0; batches integer:=0; attempts integer:=0;
 removed integer; attempt integer; batch integer; completed boolean;
 backlog integer; oldest timestamptz;
BEGIN
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='READ COMMITTED required';
 END IF;
 IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('bandup-receipt-cron-run',0)) THEN
  INSERT INTO private.band_deletion_purge_runs(started_at,finished_at,status,batches,attempts,removed)
  VALUES(started,pg_catalog.clock_timestamp(),'skipped',0,0,0) RETURNING run_id INTO result_id;
  RETURN result_id;
 END IF;

 -- One bounded transaction per invocation. The job sets a hard 30s statement timeout.
 <<work>>
 FOR batch IN 1..20 LOOP
  EXIT WHEN pg_catalog.clock_timestamp()>=started+interval '10 seconds';
  completed:=false;
  FOR attempt IN 1..3 LOOP
   EXIT WHEN pg_catalog.clock_timestamp()>=started+interval '10 seconds';
   attempts:=attempts+1;
   BEGIN
    removed:=private.expire_band_deletion_receipts(1000);
    IF removed IS NULL OR removed<0 OR removed>1000 THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid expiration batch result';
    END IF;
    completed:=true; code:=NULL;
   EXCEPTION
    WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
     GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
    WHEN OTHERS THEN
     GET STACKED DIAGNOSTICS code=RETURNED_SQLSTATE;
     state:='failed'; EXIT work;
   END;
   EXIT WHEN completed;
  END LOOP;
  IF NOT completed THEN
   IF code IS NOT NULL THEN state:='failed'; END IF;
   EXIT work;
  END IF;
  batches:=batches+1; total:=total+removed;
  -- A short batch can mean SKIP LOCKED. Backlog below determines the final state.
  EXIT WHEN removed<1000;
 END LOOP work;

 cutoff:=pg_catalog.clock_timestamp();
 SELECT count(*)::integer,min(expires_at) INTO backlog,oldest FROM (
  SELECT r.expires_at FROM private.band_deletion_receipts r
  WHERE r.expires_at<=cutoff ORDER BY r.expires_at,r.operation_id LIMIT 10001
 ) remaining;
 IF state<>'failed' THEN state:=CASE WHEN backlog=0 THEN 'succeeded' ELSE 'limited' END; END IF;

 -- Retain 30 days of metrics; bound cleanup and never touch pg_cron's global history.
 WITH old_runs AS (
  SELECT run_id FROM private.band_deletion_purge_runs
  WHERE started_at<cutoff-interval '30 days' ORDER BY started_at,run_id
  LIMIT 1000 FOR UPDATE SKIP LOCKED
 )
 DELETE FROM private.band_deletion_purge_runs r USING old_runs o WHERE r.run_id=o.run_id;
 INSERT INTO private.band_deletion_purge_runs(started_at,finished_at,status,batches,attempts,removed,
  backlog_at_least,backlog_capped,oldest_expired_at,error_sqlstate)
 VALUES(started,pg_catalog.clock_timestamp(),state,batches,attempts,total,
  backlog,backlog=10001,oldest,code) RETURNING run_id INTO result_id;
 RETURN result_id;
 -- query_canceled/backend termination are intentionally not swallowed: all changes
 -- roll back and cron.job_run_details must be monitored for the failed invocation.
END $worker$;
ALTER FUNCTION private.run_band_deletion_receipts_purge() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.run_band_deletion_receipts_purge() FROM PUBLIC,anon,authenticated,service_role;

DO $schedule$
DECLARE
 job_name name:='bandup-band-deletion-receipts-purge';
 expression text:='0,5,15 3 * * *';
 job_command text:='SET statement_timeout = ''30s''; SELECT private.run_band_deletion_receipts_purge();';
 scheduled_id bigint;
BEGIN
 -- A matching pre-existing definition may be reused; never overwrite a different job.
 IF (SELECT count(*) FROM cron.job WHERE jobname=job_name)>1
 OR EXISTS(SELECT 1 FROM cron.job j WHERE j.jobname=job_name AND (
  j.username IS DISTINCT FROM 'postgres' OR j.database IS DISTINCT FROM pg_catalog.current_database()
  OR j.schedule IS DISTINCT FROM expression OR j.command IS DISTINCT FROM job_command OR NOT j.active
  OR j.nodename IS DISTINCT FROM COALESCE(pg_catalog.current_setting('cron.host',true),'localhost')
  OR j.nodeport IS DISTINCT FROM pg_catalog.current_setting('port')::integer)) THEN
  RAISE EXCEPTION 'Conflicting purge cron job; no existing job was changed';
 END IF;
 SELECT cron.schedule(job_name,expression,job_command) INTO scheduled_id;
 IF NOT EXISTS(SELECT 1 FROM cron.job j WHERE j.jobid=scheduled_id AND j.jobname=job_name
  AND j.username='postgres' AND j.database=pg_catalog.current_database()
  AND j.schedule=expression AND j.command=job_command AND j.active) THEN
  RAISE EXCEPTION 'Purge cron job postflight failed';
 END IF;
END $schedule$;

DO $postflight$
DECLARE role_name text; target oid:='private.run_band_deletion_receipts_purge()'::regprocedure::oid;
BEGIN
 IF (SELECT count(*) FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target)<>1
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
  WHERE p.oid=target AND (a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole OR a.is_grantable OR a.privilege_type<>'EXECUTE')) THEN
  RAISE EXCEPTION 'Unexpected purge runner ACL';
 END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF pg_catalog.has_function_privilege(role_name,target,'EXECUTE')
  OR pg_catalog.has_table_privilege(role_name,'private.band_deletion_purge_runs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR pg_catalog.has_sequence_privilege(role_name,'private.band_deletion_purge_runs_run_id_seq','USAGE,SELECT,UPDATE') THEN
   RAISE EXCEPTION 'Unexpected effective purge automation privileges';
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='private.band_deletion_purge_runs'::regclass)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
  WHERE c.oid IN ('private.band_deletion_purge_runs'::regclass,'private.band_deletion_purge_runs_run_id_seq'::regclass)
  AND (a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole OR a.is_grantable)) THEN
  RAISE EXCEPTION 'Unexpected purge metrics ACL or policy';
 END IF;
END $postflight$;
COMMIT;
