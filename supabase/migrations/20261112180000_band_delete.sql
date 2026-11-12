-- LOCAL CANDIDATE ONLY. Separate review/authorization required for any remote application.
-- Part 1: no Storage API calls, worker or application UI.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
SET LOCAL search_path='';
DO $preflight$
DECLARE item record;
BEGIN
 IF current_user<>'postgres' OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'Reviewed postgres executor with existing RLS bypass required';
 END IF;
 IF pg_catalog.to_regprocedure('auth.uid()') IS NULL OR pg_catalog.to_regprocedure('auth.role()') IS NULL THEN
  RAISE EXCEPTION 'Missing Auth helpers';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.proname IN ('bandup_delete_band','bandup_get_band_deletion','guard_deleted_band_identity','guard_band_deletion_receipt','guard_band_deletion_permanent','expire_band_deletion_receipts'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname IN ('band_logo_cleanup_jobs','band_deletion_receipts','band_deletion_tombstones','band_deletion_operations'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='private' AND t.typname IN ('band_logo_cleanup_jobs','band_deletion_receipts','band_deletion_tombstones','band_deletion_operations'))
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.bands'::regclass AND tgname='bands_reject_deleted_identity') THEN RAISE EXCEPTION 'Name collision; inspect destination'; END IF;
 IF NOT pg_catalog.has_schema_privilege(current_user,'private','CREATE') OR NOT pg_catalog.has_schema_privilege('authenticated','public','USAGE') THEN RAISE EXCEPTION 'Missing existing schema privileges'; END IF;
 FOR item IN SELECT * FROM (VALUES
  ('bands','id','uuid'),('bands','name','text'),('band_members','id','uuid'),
  ('band_members','band_id','uuid'),('band_members','user_id','uuid'),('band_members','role','text'),
  ('tasks','id','uuid'),('tasks','band_id','uuid'),('task_assignees','band_id','uuid'),
  ('events','band_id','uuid'),('social_links','band_id','uuid'),
  ('band_join_requests','band_id','uuid'),('band_join_directory','band_id','uuid')
 ) cols(rel,col,typ) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=pg_catalog.to_regclass('public.'||item.rel) AND a.attname=item.col AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid=pg_catalog.to_regtype(item.typ)) THEN RAISE EXCEPTION 'Missing or incompatible source column'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE contype='f' AND confrelid='public.bands'::regclass AND confdeltype='c'
  AND conrelid IN ('public.band_members'::regclass,'public.tasks'::regclass,'public.events'::regclass,'public.social_links'::regclass,'public.band_join_requests'::regclass,'public.band_join_directory'::regclass))<>6
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE contype='f' AND confrelid='public.bands'::regclass AND conrelid NOT IN ('public.band_members'::regclass,'public.tasks'::regclass,'public.events'::regclass,'public.social_links'::regclass,'public.band_join_requests'::regclass,'public.band_join_directory'::regclass)) THEN RAISE EXCEPTION 'Unexpected band dependencies; review cascade inventory'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('public.bands'::regclass,'public.band_members'::regclass,'public.tasks'::regclass) AND relrowsecurity)<>3 THEN RAISE EXCEPTION 'Expected existing RLS'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls))
 OR pg_catalog.has_schema_privilege('authenticated','private','CREATE') OR pg_catalog.has_schema_privilege('anon','private','CREATE')
 OR pg_catalog.pg_has_role('authenticated','postgres','MEMBER') OR pg_catalog.pg_has_role('anon','postgres','MEMBER') THEN RAISE EXCEPTION 'Unexpected application privileges'; END IF;
END $preflight$;

-- Permanent minimum identities: no actor, name, confirmation, timestamps or mapping.
CREATE TABLE private.band_deletion_tombstones (band_id uuid PRIMARY KEY);
CREATE TABLE private.band_deletion_operations (operation_id uuid PRIMARY KEY);
ALTER TABLE private.band_deletion_tombstones OWNER TO postgres;
ALTER TABLE private.band_deletion_operations OWNER TO postgres;
ALTER TABLE private.band_deletion_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.band_deletion_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.band_deletion_tombstones,private.band_deletion_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.guard_band_deletion_permanent() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Deletion identities are permanent'; END $$;
ALTER FUNCTION private.guard_band_deletion_permanent() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_band_deletion_permanent() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER band_deletion_tombstones_immutable BEFORE UPDATE OR DELETE ON private.band_deletion_tombstones
FOR EACH ROW EXECUTE FUNCTION private.guard_band_deletion_permanent();
CREATE TRIGGER band_deletion_tombstones_no_truncate BEFORE TRUNCATE ON private.band_deletion_tombstones
FOR EACH STATEMENT EXECUTE FUNCTION private.guard_band_deletion_permanent();
CREATE TRIGGER band_deletion_operations_immutable BEFORE UPDATE OR DELETE ON private.band_deletion_operations
FOR EACH ROW EXECUTE FUNCTION private.guard_band_deletion_permanent();
CREATE TRIGGER band_deletion_operations_no_truncate BEFORE TRUNCATE ON private.band_deletion_operations
FOR EACH STATEMENT EXECUTE FUNCTION private.guard_band_deletion_permanent();

-- Personal data is recoverable for exactly 2160 hours; physical purge is scheduled separately.
CREATE TABLE private.band_deletion_receipts (
 operation_id uuid PRIMARY KEY REFERENCES private.band_deletion_operations(operation_id) ON DELETE RESTRICT,
 band_id uuid NOT NULL UNIQUE REFERENCES private.band_deletion_tombstones(band_id) ON DELETE RESTRICT,
 requested_by uuid NOT NULL,
 confirmation_bytes bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT (pg_catalog.statement_timestamp()+interval '2160 hours'),
 CHECK(expires_at=created_at+interval '2160 hours')
);
CREATE INDEX band_deletion_receipts_expiry_idx ON private.band_deletion_receipts(expires_at,operation_id);
ALTER TABLE private.band_deletion_receipts OWNER TO postgres;
ALTER TABLE private.band_deletion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.band_deletion_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.guard_band_deletion_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.expires_at<=pg_catalog.clock_timestamp() THEN RETURN OLD; END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only expired receipts may be deleted; updates and truncate are forbidden';
END $$;
ALTER FUNCTION private.guard_band_deletion_receipt() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_band_deletion_receipt() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER band_deletion_receipts_immutable BEFORE UPDATE OR DELETE ON private.band_deletion_receipts
FOR EACH ROW EXECUTE FUNCTION private.guard_band_deletion_receipt();
CREATE TRIGGER band_deletion_receipts_no_truncate BEFORE TRUNCATE ON private.band_deletion_receipts
FOR EACH STATEMENT EXECUTE FUNCTION private.guard_band_deletion_receipt();

-- Private maintenance entry point: no caller-supplied cutoff, actor or operation filter.
-- Only postgres can execute; no scheduler or additional privileged role is installed.
CREATE FUNCTION private.expire_band_deletion_receipts(p_batch_size integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO '' SET row_security TO 'off' SET lock_timeout TO '3s' AS $$
DECLARE affected integer; cutoff timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF p_batch_size IS NULL OR p_batch_size<1 OR p_batch_size>1000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Batch size must be between 1 and 1000';
 END IF;
 WITH expired AS (
  SELECT r.operation_id FROM private.band_deletion_receipts r
  WHERE r.expires_at<=cutoff
  ORDER BY r.expires_at,r.operation_id LIMIT p_batch_size FOR UPDATE SKIP LOCKED
 )
 DELETE FROM private.band_deletion_receipts r USING expired e WHERE r.operation_id=e.operation_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END $$;
ALTER FUNCTION private.expire_band_deletion_receipts(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.expire_band_deletion_receipts(integer) FROM PUBLIC,anon,authenticated,service_role;

-- AFTER is essential: a concurrent INSERT may wait on the old band's primary key.
-- This volatile trigger then sees the committed tombstone in a fresh RC snapshot.
CREATE FUNCTION private.guard_deleted_band_identity() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS NOT DISTINCT FROM OLD.id THEN RETURN NEW; END IF;
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band identity cannot change';
 END IF;
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='READ COMMITTED required for band creation';
 END IF;
 IF EXISTS(SELECT 1 FROM private.band_deletion_tombstones r WHERE r.band_id=NEW.id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band identity unavailable';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION private.guard_deleted_band_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_deleted_band_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bands_reject_deleted_identity AFTER INSERT OR UPDATE OF id ON public.bands
FOR EACH ROW EXECUTE FUNCTION private.guard_deleted_band_identity();

-- No FK to bands or Auth: cleanup survives removal of band and actor account.
CREATE TABLE private.band_logo_cleanup_jobs (
 operation_id uuid PRIMARY KEY REFERENCES private.band_deletion_operations(operation_id) ON DELETE RESTRICT,
 band_id uuid NOT NULL UNIQUE REFERENCES private.band_deletion_tombstones(band_id) ON DELETE RESTRICT,
 bucket_id text NOT NULL DEFAULT 'band-logos' CHECK(bucket_id='band-logos'),
 object_prefix text GENERATED ALWAYS AS (band_id::text||'/') STORED,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','needs_attention')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 next_attempt_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 lease_until timestamptz,
 last_error_code text CHECK(pg_catalog.length(last_error_code)<=100),
 completed_at timestamptz
);
ALTER TABLE private.band_logo_cleanup_jobs OWNER TO postgres;
ALTER TABLE private.band_logo_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.band_logo_cleanup_jobs FROM PUBLIC,anon,authenticated,service_role;
-- Processing may update state, never redirect the destination or operation.
CREATE TRIGGER band_logo_cleanup_jobs_identity_immutable BEFORE UPDATE OF operation_id,band_id ON private.band_logo_cleanup_jobs
FOR EACH ROW EXECUTE FUNCTION private.guard_band_deletion_permanent();

-- NULL means unknown OR owned by another actor; no existence oracle for third parties.
CREATE FUNCTION public.bandup_get_band_deletion(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO '' SET row_security TO 'off' AS $$
DECLARE actor uuid:=auth.uid(); answer jsonb;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable';
 END IF;
 SELECT pg_catalog.jsonb_build_object('status','deleted','operation_id',r.operation_id,
  'cleanup_status',COALESCE(j.status,'not_available')) INTO answer
 FROM private.band_deletion_receipts r LEFT JOIN private.band_logo_cleanup_jobs j ON j.operation_id=r.operation_id
 WHERE r.operation_id=p_operation_id AND r.requested_by=actor AND r.expires_at>pg_catalog.clock_timestamp();
 RETURN answer;
END $$;
ALTER FUNCTION public.bandup_get_band_deletion(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_get_band_deletion(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bandup_get_band_deletion(uuid) TO authenticated;

CREATE FUNCTION public.bandup_delete_band(p_band_id uuid,p_confirmation text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO '' SET row_security TO 'off' SET lock_timeout TO '3s'
AS $function$
DECLARE actor uuid:=auth.uid(); current_name text; affected bigint; deleted_at timestamptz; receipt private.band_deletion_receipts%ROWTYPE;
BEGIN
 IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable';
 END IF;
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='READ COMMITTED required';
 END IF;
 IF p_operation_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Operation identifier required';
 END IF;
 -- Serialize this operation across bands/accounts; collisions deny, never redirect.
 IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('bandup-delete-operation:'||p_operation_id::text,0)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable';
 END IF;
 SELECT r.* INTO receipt FROM private.band_deletion_receipts r
 WHERE r.operation_id=p_operation_id AND r.expires_at>pg_catalog.clock_timestamp() FOR SHARE;
 IF FOUND THEN
  IF receipt.requested_by IS DISTINCT FROM actor OR receipt.band_id IS DISTINCT FROM p_band_id
   OR p_confirmation IS NULL OR receipt.confirmation_bytes IS DISTINCT FROM pg_catalog.convert_to(p_confirmation,'UTF8') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable';
  END IF;
  RETURN public.bandup_get_band_deletion(p_operation_id);
 END IF;
 -- Expired/purged operations are never fresh requests, even against another band.
 IF EXISTS(SELECT 1 FROM private.band_deletion_operations o WHERE o.operation_id=p_operation_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable';
 END IF;
 -- Preliminary denial prevents untrusted callers from locking arbitrary bands.
 IF NOT EXISTS(SELECT 1 FROM public.band_members m WHERE m.band_id=p_band_id AND m.user_id=actor AND m.role='admin') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable';
 END IF;
 BEGIN
  SELECT b.name INTO current_name FROM public.bands b WHERE b.id=p_band_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable'; END IF;
  -- Serialize with direct role changes; avoid reverse-order deadlock waits.
  PERFORM m.id FROM public.band_members m WHERE m.band_id=p_band_id ORDER BY m.id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable';
 END;
 IF NOT EXISTS(SELECT 1 FROM public.band_members m WHERE m.band_id=p_band_id AND m.user_id=actor AND m.role='admin') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable';
 END IF;
 -- Byte equality even on databases with nondeterministic collations; no trim/case folding.
 IF p_confirmation IS NULL OR pg_catalog.convert_to(p_confirmation,'UTF8') IS DISTINCT FROM pg_catalog.convert_to(current_name,'UTF8') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Confirmation does not match';
 END IF;
 INSERT INTO private.band_deletion_tombstones(band_id) VALUES(p_band_id);
 INSERT INTO private.band_deletion_operations(operation_id) VALUES(p_operation_id);
 DELETE FROM public.tasks WHERE band_id=p_band_id;
 DELETE FROM public.bands WHERE id=p_band_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Band unavailable'; END IF;
 deleted_at:=pg_catalog.clock_timestamp();
 INSERT INTO private.band_deletion_receipts(operation_id,band_id,requested_by,confirmation_bytes,created_at,expires_at)
 VALUES(p_operation_id,p_band_id,actor,pg_catalog.convert_to(current_name,'UTF8'),deleted_at,deleted_at+interval '2160 hours');
 INSERT INTO private.band_logo_cleanup_jobs(operation_id,band_id) VALUES(p_operation_id,p_band_id);
 RETURN pg_catalog.jsonb_build_object('status','deleted','operation_id',p_operation_id,'cleanup_status','pending');
END;
$function$;
ALTER FUNCTION public.bandup_delete_band(uuid,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_delete_band(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bandup_delete_band(uuid,text,uuid) TO authenticated;
-- Retain the existing policy; table privilege removal closes the direct API path.
REVOKE DELETE ON public.bands FROM authenticated;
DO $postflight$
DECLARE target oid; role_name text; relation oid;
BEGIN
 IF pg_catalog.has_table_privilege('authenticated','public.bands','DELETE') OR pg_catalog.has_table_privilege('anon','public.bands','DELETE') THEN RAISE EXCEPTION 'Inherited direct DELETE remains; no existing memberships repaired'; END IF;
 FOREACH target IN ARRAY ARRAY['public.bandup_delete_band(uuid,text,uuid)'::regprocedure::oid,'public.bandup_get_band_deletion(uuid)'::regprocedure::oid] LOOP
  IF (SELECT count(*) FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target)<>2
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target AND (a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.grantor<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  OR NOT pg_catalog.has_function_privilege('authenticated',target,'EXECUTE')
  OR pg_catalog.has_function_privilege('authenticated',target,'EXECUTE WITH GRANT OPTION')
  OR pg_catalog.has_function_privilege('anon',target,'EXECUTE') OR pg_catalog.has_function_privilege('service_role',target,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected effective RPC ACL'; END IF;
 END LOOP;
 -- All private functions must have only the owner ACL, including default grants.
 FOREACH target IN ARRAY ARRAY['private.guard_band_deletion_permanent()'::regprocedure::oid,'private.guard_band_deletion_receipt()'::regprocedure::oid,'private.guard_deleted_band_identity()'::regprocedure::oid,'private.expire_band_deletion_receipts(integer)'::regprocedure::oid] LOOP
  IF (SELECT count(*) FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target)<>1
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=target AND (a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  OR pg_catalog.has_function_privilege('anon',target,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',target,'EXECUTE') OR pg_catalog.has_function_privilege('service_role',target,'EXECUTE') THEN RAISE EXCEPTION 'Unexpected private function ACL'; END IF;
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['private.band_logo_cleanup_jobs'::regclass::oid,'private.band_deletion_receipts'::regclass::oid,'private.band_deletion_tombstones'::regclass::oid,'private.band_deletion_operations'::regclass::oid] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF pg_catalog.has_table_privilege(role_name,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Unexpected effective private table privileges'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a WHERE c.oid=relation AND (a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole OR a.is_grantable)) THEN RAISE EXCEPTION 'Unexpected private table ACL'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=relation) THEN RAISE EXCEPTION 'Unexpected private table policy'; END IF;
 END LOOP;
END $postflight$;
COMMIT;
