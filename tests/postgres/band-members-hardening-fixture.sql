-- Synthetic objects only, installed exclusively in the runner's private cluster.
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
GRANT USAGE ON SCHEMA auth,private TO authenticated;
CREATE TABLE public.bands(id uuid PRIMARY KEY,name text NOT NULL);
CREATE TABLE public.band_members(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 band_id uuid NOT NULL REFERENCES public.bands ON DELETE CASCADE,
 user_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('admin','member')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(band_id,user_id));
CREATE TABLE private.requests(id uuid PRIMARY KEY,band_id uuid NOT NULL REFERENCES public.bands,
 requester_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('pending','approved')));
REVOKE ALL ON private.requests FROM PUBLIC,authenticated,anon;
ALTER TABLE public.bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.bands TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.band_members TO authenticated;
CREATE POLICY create_band ON public.bands FOR INSERT TO authenticated WITH CHECK(auth.uid() IS NOT NULL);
CREATE POLICY read_band ON public.bands FOR SELECT TO authenticated USING(true);
CREATE FUNCTION private.is_admin(b uuid) RETURNS boolean LANGUAGE sql STABLE
 SECURITY DEFINER SET search_path='' SET row_security=off AS $$
 SELECT EXISTS(SELECT FROM public.band_members WHERE band_id=b AND user_id=auth.uid() AND role='admin');
$$;
CREATE FUNCTION private.is_member(b uuid) RETURNS boolean LANGUAGE sql STABLE
 SECURITY DEFINER SET search_path='' SET row_security=off AS $$
 SELECT EXISTS(SELECT FROM public.band_members WHERE band_id=b AND user_id=auth.uid());
$$;
CREATE POLICY read_members ON public.band_members FOR SELECT TO authenticated USING(private.is_member(band_id));
CREATE POLICY add_members ON public.band_members FOR INSERT TO authenticated WITH CHECK(private.is_admin(band_id));
CREATE POLICY change_members ON public.band_members FOR UPDATE TO authenticated
 USING(private.is_admin(band_id)) WITH CHECK(private.is_admin(band_id));
CREATE POLICY remove_members ON public.band_members FOR DELETE TO authenticated
 USING(private.is_admin(band_id) AND role='member');
CREATE FUNCTION private.add_band_creator_as_admin() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path='' SET row_security=off AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Identity required'; END IF;
 INSERT INTO public.band_members(band_id,user_id,role) VALUES(NEW.id,auth.uid(),'admin');
 RETURN NEW;
END $$;
CREATE TRIGGER creator AFTER INSERT ON public.bands FOR EACH ROW
 EXECUTE FUNCTION private.add_band_creator_as_admin();
CREATE FUNCTION private.prevent_last_band_admin_removal() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path='' SET row_security=off AS $$
BEGIN
 IF OLD.role='admin' AND (TG_OP='DELETE' OR NEW.role<>'admin')
 AND EXISTS(SELECT FROM public.bands WHERE id=OLD.band_id)
 AND NOT EXISTS(SELECT FROM public.band_members WHERE band_id=OLD.band_id AND role='admin' AND id<>OLD.id)
 THEN RAISE EXCEPTION 'Last administrator'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER last_admin BEFORE UPDATE OR DELETE ON public.band_members FOR EACH ROW
 EXECUTE FUNCTION private.prevent_last_band_admin_removal();
CREATE FUNCTION public.bandup_decide_entry(request_id uuid) RETURNS void LANGUAGE plpgsql
 SECURITY DEFINER SET search_path='' SET row_security=off AS $$
DECLARE req private.requests%ROWTYPE;
BEGIN
 SELECT * INTO req FROM private.requests WHERE id=request_id AND status='pending' FOR UPDATE;
 IF NOT FOUND OR NOT private.is_admin(req.band_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Unauthorized request'; END IF;
 INSERT INTO public.band_members(band_id,user_id,role) VALUES(req.band_id,req.requester_id,'member');
 UPDATE private.requests SET status='approved' WHERE id=request_id;
END $$;
CREATE FUNCTION public.bandup_leave_band(b uuid) RETURNS void LANGUAGE plpgsql
 SECURITY DEFINER SET search_path='' SET row_security=off AS $$
DECLARE m public.band_members%ROWTYPE; successor uuid;
BEGIN
 PERFORM 1 FROM public.bands WHERE id=b FOR UPDATE;
 SELECT * INTO m FROM public.band_members WHERE band_id=b AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Not a member'; END IF;
 IF m.role='admin' AND NOT EXISTS(SELECT FROM public.band_members WHERE band_id=b AND role='admin' AND id<>m.id) THEN
  SELECT id INTO successor FROM public.band_members WHERE band_id=b AND id<>m.id ORDER BY created_at,id LIMIT 1;
  IF successor IS NULL THEN RAISE EXCEPTION USING ERRCODE='PBL01',MESSAGE='No successor'; END IF;
  UPDATE public.band_members SET role='admin' WHERE id=successor;
 END IF;
 DELETE FROM public.band_members WHERE id=m.id;
END $$;
CREATE FUNCTION public.bandup_delete_band(b uuid) RETURNS void LANGUAGE plpgsql
 SECURITY DEFINER SET search_path='' SET row_security=off AS $$
BEGIN
 IF NOT private.is_admin(b) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 DELETE FROM public.bands WHERE id=b;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public,private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_admin(uuid),private.is_member(uuid),
 public.bandup_decide_entry(uuid),public.bandup_leave_band(uuid),public.bandup_delete_band(uuid) TO authenticated;
