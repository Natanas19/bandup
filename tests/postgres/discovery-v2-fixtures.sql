-- Synthetic fixtures only, in the new private local cluster.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE discovery_extra NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '');
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.bands (id uuid PRIMARY KEY, name text NOT NULL, description text, logo_url text);
ALTER TABLE public.bands ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.bands TO authenticated;
CREATE POLICY fixture_members_only ON public.bands FOR SELECT TO authenticated USING (false);
CREATE FUNCTION public.bandup_discover_bands(p_after uuid DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE(band_id uuid, display_name text, summary text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authentication required'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid limit'; END IF;
  RETURN QUERY SELECT b.id,b.name,''::text FROM public.bands b WHERE p_after IS NULL OR b.id>p_after ORDER BY b.id LIMIT p_limit;
END $$;
REVOKE ALL ON FUNCTION public.bandup_discover_bands(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bandup_discover_bands(uuid,integer) TO authenticated;
CREATE SCHEMA discovery_test;
GRANT USAGE ON SCHEMA discovery_test TO authenticated, anon, service_role;
CREATE FUNCTION discovery_test.assert_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF; END $$;
CREATE TABLE discovery_test.original AS SELECT to_jsonb(p) AS metadata, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p WHERE p.oid='public.bandup_discover_bands(uuid,integer)'::regprocedure;
INSERT INTO public.bands
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
  'Same name', 'PRIVATE_DESCRIPTION', NULL FROM generate_series(1,65) i;
CREATE TABLE discovery_test.urls (label text PRIMARY KEY, value text, valid boolean);
INSERT INTO discovery_test.urls VALUES
 ('png','https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/band-logos/00000000-0000-0000-0000-000000000001/11111111-1111-4111-8111-111111111111.png',true),
 ('jpg','https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/band-logos/00000000-0000-0000-0000-000000000001/11111111-1111-4111-8111-111111111111.jpg',true),
 ('webp','https://zwmihhdvvpqgyavworgh.supabase.co/storage/v1/object/public/band-logos/00000000-0000-0000-0000-000000000001/11111111-1111-4111-8111-111111111111.webp',true),
 ('missing',NULL,false),('empty','',false),('malformed','not a URL',false);
INSERT INTO discovery_test.urls
SELECT variants.label, replace(value, old, replacement), false FROM discovery_test.urls u CROSS JOIN (VALUES
 ('other bucket','band-logos','avatars'),
 ('other band','000000000001/','000000000002/'),
 ('other origin','zwmihhdvvpqgyavworgh.supabase.co','evil.example'),
 ('http','https://','http://'),('credentials','https://','https://user:pass@'),
 ('encoded slash','/11111111','%2f11111111'),('traversal','/11111111','/../11111111'),
 ('nested','/11111111','/nested/11111111'),('svg','.png','.svg'),
 ('query','.png','.png?token=secret'),('fragment','.png','.png#fragment'),
 ('newline','.png',E'.png\n'),('suffix','.png','.png.extra')
) AS variants(label,old,replacement) WHERE u.label='png';

-- A custom default grant must abort installation instead of silently exposing v2.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO discovery_extra;
