-- Scheduling API contract double. Fresh isolated cluster ONLY; no timer/background worker.
-- This is not pg_cron and must never be installed on an existing application database.
CREATE SCHEMA cron;
CREATE TABLE cron.job (
 jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 schedule text NOT NULL, command text NOT NULL,
 nodename text NOT NULL DEFAULT 'localhost',
 nodeport integer NOT NULL DEFAULT current_setting('port')::integer,
 database text NOT NULL DEFAULT current_database(), username text NOT NULL DEFAULT current_user,
 active boolean NOT NULL DEFAULT true, jobname name,
 UNIQUE(jobname,username)
);
CREATE FUNCTION cron.schedule(job_name name,expression text,body text) RETURNS bigint
LANGUAGE plpgsql AS $$ DECLARE result bigint; BEGIN
 INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,expression,body)
 ON CONFLICT(jobname,username) DO UPDATE SET schedule=excluded.schedule,command=excluded.command,active=true
 RETURNING jobid INTO result;
 RETURN result;
END $$;
CREATE FUNCTION cron.unschedule(target bigint) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN DELETE FROM cron.job WHERE jobid=target AND username=current_user; RETURN FOUND; END $$;

CREATE SCHEMA cron_test;
CREATE TABLE cron_test.results(label text);
CREATE FUNCTION cron_test.ok(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Cron assertion failed: %',label; END IF;
 INSERT INTO cron_test.results VALUES(label);
END $$;
CREATE FUNCTION cron_test.expect(query text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text; BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE; END;
 PERFORM cron_test.ok(actual=expected,'expected SQLSTATE '||expected);
END $$;
CREATE FUNCTION cron_test.seed_expired(n integer,offset_id integer DEFAULT 0) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO private.band_deletion_tombstones SELECT md5('cron-band:'||g)::uuid
 FROM generate_series(1+offset_id,n+offset_id) g;
 INSERT INTO private.band_deletion_operations SELECT md5('cron-operation:'||g)::uuid
 FROM generate_series(1+offset_id,n+offset_id) g;
 INSERT INTO private.band_deletion_receipts(operation_id,band_id,requested_by,confirmation_bytes,created_at,expires_at)
 SELECT md5('cron-operation:'||g)::uuid,md5('cron-band:'||g)::uuid,
 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',convert_to('Synthetic private confirmation','UTF8'),
 statement_timestamp()-interval '2184 hours',statement_timestamp()-interval '24 hours'
 FROM generate_series(1+offset_id,n+offset_id) g;
END $$;
CREATE SEQUENCE cron_test.failure_attempts;
CREATE TABLE cron_test.failure_mode(mode text);
INSERT INTO cron_test.failure_mode VALUES('off');
CREATE FUNCTION cron_test.inject_failure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mode text; attempt bigint; BEGIN
 SELECT m.mode INTO mode FROM cron_test.failure_mode m;
 IF mode='transient' THEN
  attempt:=nextval('cron_test.failure_attempts');
  IF attempt<=2 THEN RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='Synthetic retry'; END IF;
 ELSIF mode='exhausted' THEN
  PERFORM nextval('cron_test.failure_attempts');
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Synthetic exhausted retry';
 ELSIF mode='permanent' THEN
  RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Sensitive private fixture must never be logged';
 ELSIF mode='late' THEN
  attempt:=nextval('cron_test.failure_attempts');
  IF attempt>1000 THEN RAISE EXCEPTION USING ERRCODE='PZ001',MESSAGE='Synthetic late failure'; END IF;
 ELSIF mode='timeout' THEN
  PERFORM pg_sleep(0.25);
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER cron_test_receipt_failure BEFORE DELETE ON private.band_deletion_receipts
FOR EACH ROW EXECUTE FUNCTION cron_test.inject_failure();
