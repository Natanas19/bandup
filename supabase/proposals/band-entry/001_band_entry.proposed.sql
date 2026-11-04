-- PROPOSAL ONLY. Not an executable migration; never include in db push.
-- Target schema, executor and identity have NOT been verified.
BEGIN;
DO $execution_disabled$
BEGIN
  RAISE EXCEPTION 'Band entry proposal: target/schema review and explicit approval required; execution disabled';
END;
$execution_disabled$;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

-- This gate is additional evidence, not a replacement for the manual contract review.
DO $preflight$
DECLARE item RECORD; source_oid OID; owner_oid OID;
BEGIN
  IF current_user <> session_user OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN RAISE EXCEPTION 'Fresh reviewed administrative executor with RLS bypass required'; END IF;
  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname = current_user;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Missing trusted Supabase Auth contract';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('public','bands','id','uuid'),
    ('public','band_members','band_id','uuid'),
    ('public','band_members','user_id','uuid'),
    ('public','band_members','role','text'),
    ('auth','users','id','uuid')
  ) AS expected(schema_name,table_name,column_name,type_name) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=item.schema_name AND c.relname=item.table_name
        AND c.relkind='r' AND a.attname=item.column_name AND NOT a.attisdropped
        AND a.atttypid=pg_catalog.to_regtype(item.type_name) AND a.attnotnull
    ) THEN RAISE EXCEPTION 'Missing/incompatible source column: %.%.%', item.schema_name,item.table_name,item.column_name; END IF;
  END LOOP;
  FOREACH source_oid IN ARRAY ARRAY[
    pg_catalog.to_regclass('public.bands')::oid,
    pg_catalog.to_regclass('public.band_members')::oid
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=source_oid AND relrowsecurity) THEN
      RAISE EXCEPTION 'Source RLS must already be enabled';
    END IF;
  END LOOP;
  -- Approval relies on the existing immediate unique constraint; no duplicates tolerated.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.band_members'::regclass AND c.contype='u'
      AND NOT c.condeferrable AND c.convalidated
      AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality)
        FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)
        =ARRAY['band_id','user_id']::text[]
  ) THEN RAISE EXCEPTION 'Reviewed immediate unique(band_id,user_id) required'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.band_members'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attnotnull AND a.attname NOT IN ('band_id','user_id','role')
      AND a.attidentity='' AND a.attgenerated=''
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum)) THEN
    RAISE EXCEPTION 'Membership INSERT has additional required columns without defaults';
  END IF;
  IF pg_catalog.to_regclass('public.band_join_directory') IS NOT NULL
     OR pg_catalog.to_regclass('public.band_join_requests') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN (
         'bandup_set_discovery','bandup_get_discovery','bandup_discover_bands',
         'bandup_request_entry','bandup_cancel_entry','bandup_decide_entry')) THEN
    RAISE EXCEPTION 'Proposal object collision; do not replace existing objects';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
    WHERE r.rolname IN ('anon','authenticated','service_role')
      AND (r.rolsuper OR r.oid=owner_oid OR pg_catalog.pg_has_role(r.oid,owner_oid,'MEMBER'))) THEN
    RAISE EXCEPTION 'Application role must not inherit the privileged function owner';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated') AND rolbypassrls) THEN
    RAISE EXCEPTION 'Unprivileged anon/authenticated roles required';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role'))<>3 THEN
    RAISE EXCEPTION 'Expected Supabase application roles are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE d.defaclrole=owner_oid AND d.defaclobjtype IN ('r','f')
      AND d.defaclnamespace IN (0,'public'::regnamespace::oid)
      AND a.grantee<>0 AND a.grantee<>owner_oid
      AND a.grantee NOT IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role'))) THEN
    RAISE EXCEPTION 'Unexpected default grantees; manual ACL review required';
  END IF;
END;
$preflight$;

-- Explicit administrator-written discovery data. No automatic publication of bands fields.
CREATE TABLE public.band_join_directory (
  band_id UUID PRIMARY KEY REFERENCES public.bands(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 100),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary)<=500),
  accepting_requests BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.band_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id UUID NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  applicant_name TEXT NOT NULL CHECK (length(btrim(applicant_name)) BETWEEN 1 AND 80),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  CHECK (
    (status='pending' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NULL) OR
    (status IN ('approved','rejected') AND decided_at IS NOT NULL AND cancelled_at IS NULL) OR
    (status='cancelled' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX band_join_one_pending ON public.band_join_requests(band_id,requester_id) WHERE status='pending';
CREATE INDEX band_join_requests_requester ON public.band_join_requests(requester_id,requested_at);
CREATE INDEX band_join_requests_band_status ON public.band_join_requests(band_id,status,requested_at);

ALTER TABLE public.band_join_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.band_join_directory, public.band_join_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.band_join_requests TO authenticated;
-- No INSERT/UPDATE/DELETE policy or grant. State changes happen only through RPCs.
CREATE POLICY band_join_read_own_or_admin ON public.band_join_requests FOR SELECT TO authenticated
USING (requester_id=(SELECT auth.uid()) OR EXISTS (
  SELECT 1 FROM public.band_members m WHERE m.band_id=band_join_requests.band_id
    AND m.user_id=(SELECT auth.uid()) AND m.role='admin'
));

CREATE FUNCTION public.bandup_set_discovery(p_band_id UUID,p_display_name TEXT,p_summary TEXT,p_accepting BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $fn$
DECLARE actor UUID := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  -- Keep the admin membership stable until this transaction finishes.
  PERFORM 1 FROM public.band_members WHERE band_id=p_band_id AND user_id=actor AND role='admin' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band administrator required'; END IF;
  PERFORM 1 FROM public.bands WHERE id=p_band_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable'; END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 100
     OR p_summary IS NULL OR length(p_summary)>500 OR p_accepting IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid discovery settings';
  END IF;
  INSERT INTO public.band_join_directory(band_id,display_name,summary,accepting_requests)
    VALUES(p_band_id,btrim(p_display_name),p_summary,p_accepting)
    ON CONFLICT(band_id) DO UPDATE SET display_name=EXCLUDED.display_name,summary=EXCLUDED.summary,
      accepting_requests=EXCLUDED.accepting_requests,updated_at=statement_timestamp();
END;
$fn$;

CREATE FUNCTION public.bandup_get_discovery(p_band_id UUID)
RETURNS TABLE(band_id UUID,display_name TEXT,summary TEXT,accepting_requests BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET row_security=off AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.band_members m
    WHERE m.band_id=p_band_id AND m.user_id=auth.uid() AND m.role='admin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band administrator required';
  END IF;
  RETURN QUERY SELECT d.band_id,d.display_name,d.summary,d.accepting_requests
    FROM public.band_join_directory d WHERE d.band_id=p_band_id;
END;
$fn$;

CREATE FUNCTION public.bandup_discover_bands(p_after UUID DEFAULT NULL,p_limit INTEGER DEFAULT 20)
RETURNS TABLE(band_id UUID,display_name TEXT,summary TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET row_security=off AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Limit must be between 1 and 50';
  END IF;
  RETURN QUERY SELECT d.band_id,d.display_name,d.summary FROM public.band_join_directory d
    WHERE d.accepting_requests AND (p_after IS NULL OR d.band_id>p_after)
    ORDER BY d.band_id LIMIT p_limit;
END;
$fn$;

CREATE FUNCTION public.bandup_request_entry(p_band_id UUID,p_applicant_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $fn$
DECLARE actor UUID := auth.uid(); request_id UUID;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  IF p_applicant_name IS NULL OR length(btrim(p_applicant_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid applicant name';
  END IF;
  PERFORM 1 FROM public.bands WHERE id=p_band_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.band_join_directory
    WHERE band_id=p_band_id AND accepting_requests) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band unavailable for requests';
  END IF;
  IF EXISTS (SELECT 1 FROM public.band_members WHERE band_id=p_band_id AND user_id=actor) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='Already a band member';
  END IF;
  INSERT INTO public.band_join_requests(band_id,requester_id,applicant_name)
    VALUES(p_band_id,actor,btrim(p_applicant_name)) RETURNING id INTO request_id;
  RETURN request_id;
END;
$fn$;

CREATE FUNCTION public.bandup_cancel_entry(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $fn$
DECLARE actor UUID := auth.uid(); target_band UUID; request_row public.band_join_requests%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  SELECT band_id INTO target_band FROM public.band_join_requests WHERE id=p_request_id AND requester_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Request unavailable'; END IF;
  PERFORM 1 FROM public.bands WHERE id=target_band FOR UPDATE;
  SELECT * INTO request_row FROM public.band_join_requests WHERE id=p_request_id AND requester_id=actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Request unavailable'; END IF;
  IF request_row.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Request is not pending'; END IF;
  UPDATE public.band_join_requests SET status='cancelled',cancelled_at=statement_timestamp() WHERE id=p_request_id;
END;
$fn$;

CREATE FUNCTION public.bandup_decide_entry(p_request_id UUID,p_decision TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $fn$
DECLARE actor UUID := auth.uid(); target_band UUID; request_row public.band_join_requests%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authentication required'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid decision';
  END IF;
  SELECT band_id INTO target_band FROM public.band_join_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Request unavailable'; END IF;
  -- Membership lock comes first, matching existing last-admin membership triggers.
  PERFORM 1 FROM public.band_members WHERE band_id=target_band AND user_id=actor AND role='admin' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Band administrator required'; END IF;
  PERFORM 1 FROM public.bands WHERE id=target_band FOR UPDATE;
  SELECT * INTO request_row FROM public.band_join_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Request unavailable'; END IF;
  IF request_row.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Request is not pending'; END IF;
  IF p_decision='approved' THEN
    -- No role parameter and no conflict UPDATE: never promote an existing member.
    INSERT INTO public.band_members(band_id,user_id,role) VALUES(target_band,request_row.requester_id,'member');
  END IF;
  UPDATE public.band_join_requests SET status=p_decision,decided_at=statement_timestamp(),decided_by=actor
    WHERE id=p_request_id;
END;
$fn$;

-- Revoke default function privileges, including defaults inherited from Supabase setup.
REVOKE ALL ON FUNCTION public.bandup_set_discovery(UUID,TEXT,TEXT,BOOLEAN),
  public.bandup_get_discovery(UUID),public.bandup_discover_bands(UUID,INTEGER),
  public.bandup_request_entry(UUID,TEXT),public.bandup_cancel_entry(UUID),public.bandup_decide_entry(UUID,TEXT)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bandup_set_discovery(UUID,TEXT,TEXT,BOOLEAN),
  public.bandup_get_discovery(UUID),public.bandup_discover_bands(UUID,INTEGER),
  public.bandup_request_entry(UUID,TEXT),public.bandup_cancel_entry(UUID),public.bandup_decide_entry(UUID,TEXT)
  TO authenticated;
COMMIT;
