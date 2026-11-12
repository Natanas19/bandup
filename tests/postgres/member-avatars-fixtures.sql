-- Synthetic schema based on the local contracts, NOT a clone of Demo.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE avatar_extra NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
REVOKE ALL ON auth.users FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role',true),'');
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, public boolean NOT NULL);
INSERT INTO storage.buckets VALUES ('avatars',true);
CREATE TABLE public.bands (id uuid PRIMARY KEY);
CREATE TABLE public.band_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid REFERENCES public.bands(id),
  user_id uuid REFERENCES auth.users(id), role text NOT NULL, UNIQUE(band_id,user_id)
);
CREATE TABLE public.band_join_requests (
  id uuid PRIMARY KEY, band_id uuid REFERENCES public.bands(id), requester_id uuid REFERENCES auth.users(id),
  status text NOT NULL, applicant_name text, requested_at timestamptz DEFAULT now(), private_message text
);
ALTER TABLE public.bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_join_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.bands,public.band_members,public.band_join_requests TO authenticated;
CREATE POLICY fixture_own_membership ON public.band_members FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY fixture_request_read ON public.band_join_requests FOR SELECT TO authenticated USING (
  requester_id=auth.uid() OR EXISTS(SELECT 1 FROM public.band_members m
    WHERE m.band_id=band_join_requests.band_id AND m.user_id=auth.uid() AND m.role='admin')
);
CREATE FUNCTION public.existing_request_contract() RETURNS integer LANGUAGE sql AS $$ SELECT 1; $$;

-- Actors 1=admin A, 2=member A, 3=admin B, 4=external applicant.
INSERT INTO auth.users SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(i::text,12,'0'))::uuid,
  'PRIVATE_EMAIL_'||i||'@example.invalid', jsonb_build_object('bio','PRIVATE_BIO','secret','PRIVATE_METADATA')
FROM generate_series(1,4) i;
INSERT INTO public.bands VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001'),('bbbbbbbb-bbbb-4bbb-8bbb-000000000002');
INSERT INTO public.band_members(band_id,user_id,role) VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000001','admin'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000002','member'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-000000000003','admin');
INSERT INTO public.band_join_requests(id,band_id,requester_id,status,applicant_name,private_message)
SELECT ('cccccccc-cccc-4ccc-8ccc-'||lpad(i::text,12,'0'))::uuid,
 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
 'pending','Applicant snapshot','PRIVATE_MESSAGE' FROM generate_series(1,25) i;
INSERT INTO public.band_join_requests(id,band_id,requester_id,status) VALUES
 ('dddddddd-dddd-4ddd-8ddd-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-000000000004','pending'),
 ('eeeeeeee-eeee-4eee-8eee-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000004','approved'),
 ('eeeeeeee-eeee-4eee-8eee-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000004','rejected'),
 ('eeeeeeee-eeee-4eee-8eee-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000004','cancelled');

CREATE SCHEMA avatar_test;
GRANT USAGE ON SCHEMA avatar_test TO anon, authenticated, service_role;
CREATE TABLE avatar_test.results(label text NOT NULL);
CREATE FUNCTION avatar_test.assert_true(value boolean,label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF;
  INSERT INTO avatar_test.results VALUES(label);
END $$;
CREATE FUNCTION avatar_test.expect_state(query text,state text,label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
DECLARE caught text;
BEGIN
  BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS caught=RETURNED_SQLSTATE; END;
  PERFORM avatar_test.assert_true(caught=state,label);
END $$;
CREATE FUNCTION avatar_test.snapshot() RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object(
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.schemaname,p.tablename,p.policyname) FROM pg_policies p
    WHERE p.schemaname IN ('public','auth','storage')),
  'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity)
    ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage') AND c.relkind='r'),
  'columns',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.attacl)
    ORDER BY n.nspname,c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND a.attnum>0 AND NOT a.attisdropped),
  'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','auth','storage') AND p.proname<>'bandup_member_avatars'),
  'buckets',(SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM storage.buckets b)
 );
$$;
-- Add targets and external/shared actors for member-specific checks.
INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT ('aaaaaaaa-aaaa-4aaa-8aaa-'||lpad(i::text,12,'0'))::uuid,
 'PRIVATE_EMAIL_'||i||'@example.invalid','{"bio":"PRIVATE_BIO","secret":"PRIVATE_METADATA"}'
FROM generate_series(5,7) i;
INSERT INTO public.band_members(band_id,user_id,role) VALUES
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000004','member'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-000000000006','member'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-000000000007','member'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-000000000007','member');
INSERT INTO auth.users(id,email,raw_user_meta_data)
SELECT ('ffffffff-ffff-4fff-8fff-'||lpad(i::text,12,'0'))::uuid,'PRIVATE_EMAIL_'||i||'@example.invalid','{}'
FROM generate_series(1,25) i;
INSERT INTO public.band_members(band_id,user_id,role)
SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',('ffffffff-ffff-4fff-8fff-'||lpad(i::text,12,'0'))::uuid,'member'
FROM generate_series(1,25) i;
CREATE TABLE avatar_test.original AS SELECT avatar_test.snapshot() AS value;
CREATE TABLE avatar_test.urls(label text PRIMARY KEY, metadata jsonb, valid boolean);
INSERT INTO avatar_test.urls VALUES
 ('png','{"avatar_url":"https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/avatars/aaaaaaaa-aaaa-4aaa-8aaa-000000000004/11111111-1111-4111-8111-111111111111.png"}',true),
 ('absent','{}',false),('null','{"avatar_url":null}',false),('number','{"avatar_url":42}',false),
 ('object','{"avatar_url":{}}',false),('legacy','{"avatar_url":"https://provider.example/photo.png"}',false);
INSERT INTO avatar_test.urls SELECT variants.label,
 jsonb_build_object('avatar_url',replace(u.metadata->>'avatar_url',old,replacement)),variants.valid
FROM avatar_test.urls u CROSS JOIN (VALUES
 ('jpg','.png','.jpg',true),('webp','.png','.webp',true),
 ('other origin','zwmihhdvvpqgyavworgh.supabase.co','evil.example',false),
 ('other bucket','/avatars/','/band-logos/',false),('other user','000000000004/','000000000001/',false),
 ('http','https://','http://',false),('credentials','https://','https://user:pass@',false),
 ('query','.png','.png?token=secret',false),('fragment','.png','.png#fragment',false),
 ('newline','.png',E'.png\n',false),('svg','.png','.svg',false),
 ('encoded slash','/11111111','%2f11111111',false),('traversal','/11111111','/../11111111',false),
 ('suffix','.png','.png.extra',false)
) AS variants(label,old,replacement,valid) WHERE u.label='png';
