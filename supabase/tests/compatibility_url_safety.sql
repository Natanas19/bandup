-- PREPARED, NOT EXECUTED. After compatibility + legacy URL stage, repeat after M10.
-- Never disable a guard or manufacture publicly selected unsafe rows.
\set ON_ERROR_STOP on
BEGIN;
\ir publication_compatibility_target.sql
\ir compatibility_url_cases.sql
CREATE FUNCTION pg_temp.url_check(ok boolean,label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'URL compatibility: %',label; END IF; END;
$$;
CREATE FUNCTION pg_temp.url_denied(command text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE marker text;
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS marker=CONSTRAINT_NAME;
  IF marker='social_links_external_url_safe' THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'Unsafe URL write accepted';
END;
$$;
SELECT pg_temp.url_check(NOT EXISTS (SELECT 1 FROM pg_temp.url_cases
 WHERE private.is_safe_external_url_v1(input) IS DISTINCT FROM expected),'complete validator corpus');
SELECT pg_temp.url_check((SELECT count(*) FROM public.social_links WHERE platform LIKE 'url-case-%'
 AND band_id='62000000-0000-0000-0000-000000000001')=(SELECT count(*) FROM pg_temp.url_cases WHERE input IS NOT NULL),
 'all synthetic pre-upgrade rows retained');
SELECT pg_temp.url_check(NOT EXISTS (SELECT 1 FROM pg_temp.url_cases c LEFT JOIN public.social_links l
 ON l.id=('65000000-0000-0000-0000-'||pg_catalog.lpad((c.id+1)::text,12,'0'))::uuid
 WHERE c.input IS NOT NULL AND (l.id IS NULL OR l.url IS DISTINCT FROM c.input OR l.is_public)),
 'legacy values unchanged and private before test writes');
GRANT SELECT ON pg_temp.url_cases TO authenticated,anon;
SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $writes$
DECLARE c record; link_id uuid;
BEGIN
 FOR c IN SELECT * FROM pg_temp.url_cases WHERE input IS NOT NULL LOOP
  link_id:=('65000000-0000-0000-0000-'||pg_catalog.lpad((c.id+1)::text,12,'0'))::uuid;
  IF c.expected THEN
   UPDATE public.social_links SET is_public=true WHERE id=link_id;
   PERFORM pg_temp.url_check((SELECT is_public AND url=c.input FROM public.social_links WHERE id=link_id),'valid publication persisted');
  ELSE
   PERFORM pg_temp.url_denied(pg_catalog.format('UPDATE public.social_links SET is_public=true WHERE id=%L::uuid',link_id));
   PERFORM pg_temp.url_denied(pg_catalog.format('INSERT INTO public.social_links(band_id,platform,url) VALUES (%L::uuid,%L,%L)',
    '62000000-0000-0000-0000-000000000001','unsafe-candidate',c.input));
   PERFORM pg_temp.url_denied(pg_catalog.format('INSERT INTO public.social_links(id,band_id,platform,url) VALUES (%L::uuid,%L::uuid,%L,%L) ON CONFLICT(id) DO UPDATE SET url=EXCLUDED.url',
    link_id,'62000000-0000-0000-0000-000000000001','unsafe-candidate',c.input));
   PERFORM pg_temp.url_denied(pg_catalog.format('INSERT INTO public.social_links(id,band_id,platform,url) VALUES (%L::uuid,%L::uuid,%L,%L),(%L::uuid,%L::uuid,%L,%L)',
    '66000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','atomic-good','https://example.invalid/atomic',
    '66000000-0000-0000-0000-000000000002','62000000-0000-0000-0000-000000000001','atomic-bad',c.input));
   PERFORM pg_temp.url_check(NOT EXISTS(SELECT 1 FROM public.social_links WHERE id IN
    ('66000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000002')),'bulk atomicity');
   PERFORM pg_temp.url_check((SELECT NOT is_public AND url=c.input FROM public.social_links WHERE id=link_id),'unsafe legacy publication rejected without rewrite');
  END IF;
 END LOOP;
END;
$writes$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.url_check(NOT EXISTS (SELECT 1 FROM pg_temp.url_cases c
 LEFT JOIN public.public_social_links l ON l.band_id='62000000-0000-0000-0000-000000000001'
 AND l.platform='url-case-'||c.id
 WHERE (l.url IS NOT NULL) IS DISTINCT FROM (c.expected AND c.input IS NOT NULL)
 OR (l.url IS NOT NULL AND l.url IS DISTINCT FROM c.input)), 'legacy public view filters every unsafe case');
SELECT pg_temp.url_check(NOT EXISTS (SELECT 1 FROM pg_temp.url_cases c
 LEFT JOIN LATERAL (SELECT link FROM public.public_band_profiles p,
  LATERAL pg_catalog.jsonb_array_elements(p.links) link
  WHERE p.slug='compat-existing-public' AND link->>'platform'='url-case-'||c.id) visible ON true
 WHERE (visible.link IS NOT NULL) IS DISTINCT FROM (c.expected AND c.input IS NOT NULL)
 OR (visible.link IS NOT NULL AND visible.link->>'url' IS DISTINCT FROM c.input)),
 'profile view filters every unsafe case');
RESET ROLE;
ROLLBACK;
