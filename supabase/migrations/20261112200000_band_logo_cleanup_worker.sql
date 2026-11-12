-- Local worker contract only. No remote application, scheduling or Storage deletion here.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles
  WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Reviewed postgres executor required'; END IF;
 IF pg_catalog.to_regclass('private.band_logo_cleanup_jobs') IS NULL
 OR pg_catalog.to_regclass('private.band_deletion_tombstones') IS NULL
 OR pg_catalog.to_regclass('private.band_deletion_operations') IS NULL
 OR pg_catalog.to_regprocedure('auth.role()') IS NULL THEN RAISE EXCEPTION 'Deletion queue contract missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('public','private') AND p.proname IN ('bandup_claim_band_logo_cleanup',
   'bandup_renew_band_logo_cleanup','bandup_finish_band_logo_cleanup','require_band_logo_cleanup_worker'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='private.band_logo_cleanup_jobs'::regclass
  AND attname IN ('lease_token','empty_since','last_scanned_at') AND NOT attisdropped) THEN
  RAISE EXCEPTION 'Worker contract name collision';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls))
 OR pg_catalog.pg_has_role('anon','service_role','MEMBER') OR pg_catalog.pg_has_role('authenticated','service_role','MEMBER') THEN
  RAISE EXCEPTION 'Application roles must not inherit worker privileges';
 END IF;
END $preflight$;

ALTER TABLE private.band_logo_cleanup_jobs
 ADD COLUMN lease_token uuid,
 ADD COLUMN empty_since timestamptz,
 ADD COLUMN last_scanned_at timestamptz;
CREATE UNIQUE INDEX band_logo_cleanup_jobs_lease_token_key ON private.band_logo_cleanup_jobs(lease_token) WHERE lease_token IS NOT NULL;
CREATE INDEX band_logo_cleanup_jobs_due_idx ON private.band_logo_cleanup_jobs(next_attempt_at,created_at,operation_id)
 WHERE status IN ('pending','processing','completed');

CREATE FUNCTION private.require_band_logo_cleanup_worker() RETURNS void
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Worker unavailable';
 END IF;
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='READ COMMITTED required';
 END IF;
END $$;
ALTER FUNCTION private.require_band_logo_cleanup_worker() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.require_band_logo_cleanup_worker() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.bandup_claim_band_logo_cleanup(p_claim_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off' SET lock_timeout TO '3s'
AS $$
DECLARE job private.band_logo_cleanup_jobs%ROWTYPE; cutoff timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 PERFORM private.require_band_logo_cleanup_worker();
 IF p_claim_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Claim identifier required'; END IF;
 IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('bandup-logo-claim:'||p_claim_id::text,0)) THEN RETURN NULL; END IF;
 -- Recover a lost claim response without reserving a second band or incrementing attempts.
 SELECT j.* INTO job FROM private.band_logo_cleanup_jobs j
 WHERE j.lease_token=p_claim_id AND j.status='processing' AND j.lease_until>cutoff
  AND j.bucket_id='band-logos' AND j.object_prefix=j.band_id::text||'/'
  AND EXISTS(SELECT 1 FROM private.band_deletion_tombstones t WHERE t.band_id=j.band_id)
  AND EXISTS(SELECT 1 FROM private.band_deletion_operations o WHERE o.operation_id=j.operation_id)
  AND NOT EXISTS(SELECT 1 FROM public.bands b WHERE b.id=j.band_id)
 FOR UPDATE;
 IF FOUND AND job.lease_until<=pg_catalog.clock_timestamp() THEN RETURN NULL; END IF;
 IF NOT FOUND THEN
  cutoff:=pg_catalog.clock_timestamp();
  -- Crashed eighth attempts must become visible for manual attention, not remain leased forever.
  WITH exhausted AS (
   SELECT j.operation_id FROM private.band_logo_cleanup_jobs j
   WHERE j.status='processing' AND COALESCE(j.lease_until,'-infinity'::timestamptz)<=cutoff AND j.attempts>=8
    AND EXISTS(SELECT 1 FROM private.band_deletion_tombstones t WHERE t.band_id=j.band_id)
    AND NOT EXISTS(SELECT 1 FROM public.bands b WHERE b.id=j.band_id)
   ORDER BY j.next_attempt_at,j.operation_id LIMIT 20 FOR UPDATE SKIP LOCKED
  ) UPDATE private.band_logo_cleanup_jobs j SET status='needs_attention',lease_token=NULL,lease_until=NULL,
   updated_at=cutoff,last_error_code='lease_exhausted' FROM exhausted e WHERE e.operation_id=j.operation_id;
  SELECT j.* INTO job FROM private.band_logo_cleanup_jobs j
  WHERE j.attempts<8 AND j.bucket_id='band-logos' AND j.object_prefix=j.band_id::text||'/'
   AND ((j.status IN ('pending','completed') AND j.next_attempt_at<=cutoff)
    OR (j.status='processing' AND COALESCE(j.lease_until,'-infinity'::timestamptz)<=cutoff))
   AND EXISTS(SELECT 1 FROM private.band_deletion_tombstones t WHERE t.band_id=j.band_id)
   AND EXISTS(SELECT 1 FROM private.band_deletion_operations o WHERE o.operation_id=j.operation_id)
   AND NOT EXISTS(SELECT 1 FROM public.bands b WHERE b.id=j.band_id)
  ORDER BY j.next_attempt_at,j.created_at,j.operation_id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  cutoff:=pg_catalog.clock_timestamp();
  UPDATE private.band_logo_cleanup_jobs j SET status='processing',attempts=j.attempts+1,
   lease_token=p_claim_id,lease_until=cutoff+interval '2 minutes',updated_at=cutoff,completed_at=NULL
  WHERE j.operation_id=job.operation_id RETURNING j.* INTO job;
 END IF;
 RETURN pg_catalog.jsonb_build_object('operation_id',job.operation_id,'band_id',job.band_id,
  'bucket_id',job.bucket_id,'object_prefix',job.object_prefix,'lease_token',job.lease_token);
END $$;

CREATE FUNCTION public.bandup_renew_band_logo_cleanup(p_operation_id uuid,p_lease_token uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off' SET lock_timeout TO '3s'
AS $$
DECLARE cutoff timestamptz; job private.band_logo_cleanup_jobs%ROWTYPE;
BEGIN
 PERFORM private.require_band_logo_cleanup_worker();
 SELECT j.* INTO job FROM private.band_logo_cleanup_jobs j
 WHERE j.operation_id=p_operation_id AND j.lease_token=p_lease_token AND j.status='processing'
  AND j.bucket_id='band-logos' AND j.object_prefix=j.band_id::text||'/'
  AND EXISTS(SELECT 1 FROM private.band_deletion_tombstones t WHERE t.band_id=j.band_id)
  AND EXISTS(SELECT 1 FROM private.band_deletion_operations o WHERE o.operation_id=j.operation_id)
  AND NOT EXISTS(SELECT 1 FROM public.bands b WHERE b.id=j.band_id) FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Recheck the clock after acquiring the row: a lock wait must not revive an expired lease.
 cutoff:=pg_catalog.clock_timestamp();
 IF job.lease_until IS NULL OR job.lease_until<=cutoff THEN RETURN false; END IF;
 UPDATE private.band_logo_cleanup_jobs j SET lease_until=cutoff+interval '2 minutes',updated_at=cutoff
 WHERE j.operation_id=job.operation_id;
 RETURN true;
END $$;

CREATE FUNCTION public.bandup_finish_band_logo_cleanup(p_operation_id uuid,p_lease_token uuid,p_outcome text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off' SET lock_timeout TO '3s'
AS $$
DECLARE cutoff timestamptz:=pg_catalog.clock_timestamp(); job private.band_logo_cleanup_jobs%ROWTYPE; result text;
BEGIN
 PERFORM private.require_band_logo_cleanup_worker();
 IF p_outcome IS NULL OR p_outcome NOT IN ('empty','progress','retry','unsafe') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid worker outcome';
 END IF;
 SELECT j.* INTO job FROM private.band_logo_cleanup_jobs j
 WHERE j.operation_id=p_operation_id AND j.lease_token=p_lease_token AND j.status='processing' AND j.lease_until>cutoff
  AND j.bucket_id='band-logos' AND j.object_prefix=j.band_id::text||'/'
  AND EXISTS(SELECT 1 FROM private.band_deletion_tombstones t WHERE t.band_id=j.band_id)
  AND EXISTS(SELECT 1 FROM private.band_deletion_operations o WHERE o.operation_id=j.operation_id)
  AND NOT EXISTS(SELECT 1 FROM public.bands b WHERE b.id=j.band_id)
 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 cutoff:=pg_catalog.clock_timestamp();
 IF job.lease_until<=cutoff THEN RETURN NULL; END IF;
 result:=CASE
  WHEN p_outcome='unsafe' OR (p_outcome='retry' AND job.attempts>=8) THEN 'needs_attention'
  WHEN p_outcome='empty' AND job.empty_since<=cutoff-interval '24 hours' THEN 'completed'
  ELSE 'pending' END;
 UPDATE private.band_logo_cleanup_jobs j SET status=result,lease_token=NULL,lease_until=NULL,updated_at=cutoff,
  attempts=CASE WHEN p_outcome IN ('empty','progress') THEN 0 ELSE j.attempts END,
  empty_since=CASE WHEN p_outcome='empty' THEN COALESCE(j.empty_since,cutoff) ELSE NULL END,
  last_scanned_at=CASE WHEN p_outcome IN ('empty','progress') THEN cutoff ELSE j.last_scanned_at END,
  completed_at=CASE WHEN result='completed' THEN cutoff ELSE NULL END,
  next_attempt_at=CASE WHEN p_outcome='empty' THEN cutoff+interval '24 hours'
   WHEN p_outcome='progress' THEN cutoff+interval '1 minute'
   ELSE cutoff+pg_catalog.make_interval(mins=>LEAST(1440,5*(1 << (job.attempts-1)))) END,
  last_error_code=CASE WHEN p_outcome='unsafe' THEN 'unsafe_path' WHEN p_outcome='retry' THEN 'storage_retry' ELSE NULL END
 WHERE j.operation_id=job.operation_id;
 -- Completed is a verified-empty observation, not terminal: daily reconciliation remains due.
 RETURN result;
END $$;

ALTER FUNCTION public.bandup_claim_band_logo_cleanup(uuid) OWNER TO postgres;
ALTER FUNCTION public.bandup_renew_band_logo_cleanup(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.bandup_finish_band_logo_cleanup(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_claim_band_logo_cleanup(uuid),public.bandup_renew_band_logo_cleanup(uuid,uuid),
 public.bandup_finish_band_logo_cleanup(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bandup_claim_band_logo_cleanup(uuid),public.bandup_renew_band_logo_cleanup(uuid,uuid),
 public.bandup_finish_band_logo_cleanup(uuid,uuid,text) TO service_role;

DO $postflight$
DECLARE target oid; role_name text;
BEGIN
 FOREACH target IN ARRAY ARRAY['public.bandup_claim_band_logo_cleanup(uuid)'::regprocedure::oid,
  'public.bandup_renew_band_logo_cleanup(uuid,uuid)'::regprocedure::oid,
  'public.bandup_finish_band_logo_cleanup(uuid,uuid,text)'::regprocedure::oid] LOOP
  IF (SELECT count(*) FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target)<>2
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target
   AND (a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole) OR a.grantor<>'postgres'::regrole OR a.is_grantable OR a.privilege_type<>'EXECUTE'))
  OR NOT pg_catalog.has_function_privilege('service_role',target,'EXECUTE')
  OR pg_catalog.has_function_privilege('service_role',target,'EXECUTE WITH GRANT OPTION')
  OR pg_catalog.has_function_privilege('anon',target,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',target,'EXECUTE') THEN
   RAISE EXCEPTION 'Unexpected worker RPC ACL';
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
  WHERE p.oid='private.require_band_logo_cleanup_worker()'::regprocedure)<>1
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
  WHERE p.oid='private.require_band_logo_cleanup_worker()'::regprocedure
  AND (a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole OR a.is_grantable)) THEN RAISE EXCEPTION 'Unexpected worker helper ACL'; END IF;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF pg_catalog.has_table_privilege(role_name,'private.band_logo_cleanup_jobs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR pg_catalog.has_function_privilege(role_name,'private.require_band_logo_cleanup_worker()','EXECUTE') THEN
   RAISE EXCEPTION 'Unexpected direct worker access';
  END IF;
 END LOOP;
END $postflight$;
COMMIT;
