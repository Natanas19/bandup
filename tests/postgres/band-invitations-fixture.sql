-- Synthetic only: never a claim about the remote RPC body.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.role',true),'');
$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TABLE public.bands(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE public.band_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),band_id uuid REFERENCES public.bands ON DELETE CASCADE,
 user_id uuid REFERENCES auth.users ON DELETE CASCADE,role text NOT NULL CHECK(role IN ('admin','member')),UNIQUE(band_id,user_id));
ALTER TABLE public.band_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT,DELETE ON public.band_members TO authenticated;
CREATE TABLE public.musician_availability(user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,available boolean NOT NULL DEFAULT false);
ALTER TABLE public.musician_availability ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.musician_availability TO authenticated;
GRANT UPDATE(available) ON public.musician_availability TO authenticated;
CREATE POLICY own_availability ON public.musician_availability TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE TABLE public.band_join_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),band_id uuid NOT NULL REFERENCES public.bands ON DELETE CASCADE,
 requester_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,applicant_name text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 requested_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,decided_by uuid REFERENCES auth.users ON DELETE SET NULL,cancelled_at timestamptz,
 CONSTRAINT band_join_requests_check CHECK (
 (status='pending' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NULL)
 OR (status IN ('approved','rejected') AND decided_at IS NOT NULL AND cancelled_at IS NULL)
 OR (status='cancelled' AND decided_at IS NULL AND decided_by IS NULL AND cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX fixture_pending_request ON public.band_join_requests(band_id,requester_id) WHERE status='pending';
ALTER TABLE public.band_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.band_join_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.bandup_decide_entry(p_request_id uuid,p_decision text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req public.band_join_requests%ROWTYPE;
BEGIN
 SELECT * INTO req FROM public.band_join_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT FROM public.band_members WHERE band_id=req.band_id AND user_id=auth.uid() AND role='admin') THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Unauthorized'; END IF;
 IF req.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Completed'; END IF;
 IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 -- Deliberately request first to test deferred integration.
 UPDATE public.band_join_requests SET status=p_decision,decided_at=clock_timestamp(),decided_by=auth.uid() WHERE id=p_request_id;
 IF p_decision='approved' THEN INSERT INTO public.band_members(band_id,user_id,role) VALUES(req.band_id,req.requester_id,'member'); END IF;
END $$;
REVOKE ALL ON FUNCTION public.bandup_decide_entry(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.bandup_decide_entry(uuid,text) TO authenticated;
