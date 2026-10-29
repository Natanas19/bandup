-- PREPARED, NOT EXECUTED. After synthetic fixture + compatibility + M8 + legacy
-- URL branch; also repeat after M10 in a separate fresh session. No production.
\set ON_ERROR_STOP on
BEGIN;
\ir publication_compatibility_target.sql
DO $prerequisites$
BEGIN
  IF pg_catalog.to_regclass('public.public_band_profiles') IS NULL
     OR pg_catalog.to_regprocedure('private.is_safe_external_url_v1(text)') IS NULL
     OR (SELECT relowner FROM pg_catalog.pg_class WHERE oid='public.public_band_profiles'::regclass)
         IS DISTINCT FROM 'bandup_profile_reader'::regrole::oid THEN
    RAISE EXCEPTION 'Compatibility and legacy URL branch required';
  END IF;
END;
$prerequisites$;
CREATE FUNCTION pg_temp.compat_assert(ok boolean,label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF ok IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Compatibility assertion: %',label; END IF; END;
$$;
CREATE FUNCTION pg_temp.compat_error(command text,state text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actual text;
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE;
    IF actual=state THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Expected rejection absent';
END;
$$;
CREATE FUNCTION pg_temp.compat_zero(command text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE affected bigint;
BEGIN EXECUTE command; GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'Unauthorized change'; END IF;
END;
$$;
CREATE FUNCTION pg_temp.compat_actor(user_id text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',user_id,true);
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object('sub',user_id,'role','authenticated')::text,true);
END;
$$;

-- Upgrade must preserve the existing public band, private band, IDs and rows,
-- while making ALL legacy links private without normalizing/deleting URLs.
SELECT pg_temp.compat_assert((SELECT count(*)=2 AND count(*) FILTER (WHERE is_public)=1
  FROM public.bands WHERE id IN ('62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002')),
  'existing band publication retained');
SELECT pg_temp.compat_assert((SELECT count(*)=3 AND bool_and(NOT is_public)
  FROM public.social_links WHERE id IN ('63000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000002','63000000-0000-0000-0000-000000000003')),
  'legacy rows retained and unpublished');
SELECT pg_temp.compat_assert((SELECT url='javascript:legacy' FROM public.social_links
  WHERE id='63000000-0000-0000-0000-000000000003'),'invalid legacy value not rewritten');

INSERT INTO auth.users(id) VALUES
 ('61000000-0000-0000-0000-000000000002'),('61000000-0000-0000-0000-000000000003');
SELECT pg_temp.compat_actor('61000000-0000-0000-0000-000000000002');
INSERT INTO public.bands(id,name,slug) VALUES
 ('62000000-0000-0000-0000-000000000003','Other admin fixture','compat-other-admin');
INSERT INTO public.band_members(band_id,user_id,role) VALUES
 ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000003','member');

SET LOCAL ROLE anon;
SELECT pg_temp.compat_assert((SELECT count(*)=1 FROM public.public_bands
  WHERE slug IN ('compat-existing-public','compat-existing-private')),'legacy public band projection');
SELECT pg_temp.compat_assert((SELECT count(*)=1 AND bool_and(links='[]'::jsonb)
  FROM public.public_band_profiles WHERE slug IN ('compat-existing-public','compat-existing-private')),
  'new profile preserves band and hides default-private links');
SELECT pg_temp.compat_assert(NOT EXISTS (SELECT 1 FROM public.public_social_links
  WHERE band_id IN ('62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002')),
  'legacy endpoint hides default-private links');
SELECT pg_temp.compat_error('SELECT * FROM public.social_links','42501');
SELECT pg_temp.compat_error('UPDATE public.public_social_links SET url=''https://example.com/forbidden''','42501');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.compat_actor('61000000-0000-0000-0000-000000000001');
UPDATE public.social_links SET is_public=true
 WHERE id IN ('63000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000002');
INSERT INTO public.social_links(id,band_id,platform,url) VALUES
 ('63000000-0000-0000-0000-000000000004','62000000-0000-0000-0000-000000000001','website','https://example.com/private'),
 ('63000000-0000-0000-0000-000000000005','62000000-0000-0000-0000-000000000002','website','https://example.com/private-band-private-link');
INSERT INTO public.events(id,band_id,created_by,title,event_type,start_at) VALUES
 ('64000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001','Public event fixture','show',pg_catalog.now()+interval '2 days');
SELECT pg_temp.compat_error('UPDATE public.social_links SET is_public=true WHERE id=''63000000-0000-0000-0000-000000000003''','23514');
UPDATE public.social_links SET is_public=false WHERE id='63000000-0000-0000-0000-000000000003';
SELECT pg_temp.compat_error('UPDATE public.social_links SET band_id=''62000000-0000-0000-0000-000000000002'' WHERE id=''63000000-0000-0000-0000-000000000001''','23514');
SELECT pg_temp.compat_error('UPDATE public.social_links SET is_public=false, band_id=''62000000-0000-0000-0000-000000000001'' WHERE id IN (''63000000-0000-0000-0000-000000000001'',''63000000-0000-0000-0000-000000000002'')','23514');
SELECT pg_temp.compat_assert((SELECT bool_and(is_public) FROM public.social_links
 WHERE id IN ('63000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000002')),
 'mixed bulk transfer is atomic');
SELECT pg_temp.compat_error('INSERT INTO public.bands(name,slug,is_public) VALUES (''Rejected fixture'',''compat-rejected-insert'',true)','23514');
RESET ROLE;

-- Four combinations: public/public visible; public/private hidden;
-- private/public hidden; private/private hidden, in BOTH public interfaces.
SET LOCAL ROLE anon;
SELECT pg_temp.compat_assert((SELECT count(*)=1 FROM public.public_social_links
  WHERE band_id IN ('62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002')),
  'legacy visibility matrix');
SELECT pg_temp.compat_assert((SELECT links='[{"platform":"website","url":"https://example.com/legacy"}]'::jsonb
  FROM public.public_band_profiles WHERE slug='compat-existing-public'),'profile visibility matrix');
SELECT pg_temp.compat_assert(NOT EXISTS (SELECT 1 FROM public.public_band_profiles
  WHERE slug='compat-existing-private'),'private band never has a public profile');
RESET ROLE;

SET LOCAL ROLE bandup_public_reader;
SELECT pg_temp.compat_assert((SELECT count(*)=1 FROM public.social_links
  WHERE band_id IN ('62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002')),
  'legacy RLS itself filters links, not only the view');
RESET ROLE;
SET LOCAL ROLE bandup_profile_reader;
SELECT pg_temp.compat_assert((SELECT count(*)=1 FROM public.social_links
  WHERE band_id IN ('62000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000002')),
  'isolated profile RLS');
SELECT pg_temp.compat_error('SELECT title FROM public.events','42501');
SELECT pg_temp.compat_error('SELECT title FROM public.tasks','42501');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.compat_actor('61000000-0000-0000-0000-000000000003');
SELECT pg_temp.compat_assert((SELECT count(*)=3 FROM public.social_links
  WHERE band_id='62000000-0000-0000-0000-000000000001'
    AND id IN ('63000000-0000-0000-0000-000000000001',
      '63000000-0000-0000-0000-000000000003','63000000-0000-0000-0000-000000000004')),
  'members retain internal private-link access');
SELECT pg_temp.compat_zero('UPDATE public.bands SET is_public=false WHERE id=''62000000-0000-0000-0000-000000000001''');
SELECT pg_temp.compat_zero('UPDATE public.social_links SET is_public=false WHERE id=''63000000-0000-0000-0000-000000000001''');
-- Public view must not inherit the authenticated caller's membership access.
SELECT pg_temp.compat_assert((SELECT count(*)=1 FROM public.public_social_links
  WHERE band_id='62000000-0000-0000-0000-000000000001'),'member public projection remains filtered');
SELECT pg_temp.compat_actor('61000000-0000-0000-0000-000000000002');
SELECT pg_temp.compat_zero('UPDATE public.bands SET is_public=false WHERE id=''62000000-0000-0000-0000-000000000001''');
SELECT pg_temp.compat_zero('UPDATE public.social_links SET is_public=false WHERE id=''63000000-0000-0000-0000-000000000001''');
SELECT pg_temp.compat_actor('61000000-0000-0000-0000-000000000001');
-- Admin UPSERT is subject to both publication and URL guards.
INSERT INTO public.social_links(id,band_id,platform,url,is_public) VALUES
 ('63000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','website','https://example.com/legacy',true)
ON CONFLICT (id) DO UPDATE SET is_public=EXCLUDED.is_public;
UPDATE public.bands SET is_public=false WHERE id='62000000-0000-0000-0000-000000000001';
UPDATE public.bands SET is_public=true WHERE id='62000000-0000-0000-0000-000000000002';
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.compat_assert(NOT EXISTS (SELECT 1 FROM public.public_bands
  WHERE id='62000000-0000-0000-0000-000000000001'),'unpublish removes legacy band');
SELECT pg_temp.compat_assert(NOT EXISTS (SELECT 1 FROM public.public_events
  WHERE band_id='62000000-0000-0000-0000-000000000001'),'unpublish removes legacy events');
SELECT pg_temp.compat_assert(NOT EXISTS (SELECT 1 FROM public.public_social_links
  WHERE band_id='62000000-0000-0000-0000-000000000001'),'unpublish removes legacy links');
SELECT pg_temp.compat_assert(NOT EXISTS (SELECT 1 FROM public.public_band_profiles
  WHERE slug='compat-existing-public'),'unpublish removes new profile');
SELECT pg_temp.compat_assert((SELECT count(*)=1 FROM public.public_social_links
  WHERE band_id='62000000-0000-0000-0000-000000000002'),'publishing band reveals only selected link');
SELECT pg_temp.compat_assert((SELECT links='[{"platform":"website","url":"https://example.com/hidden"}]'::jsonb
  FROM public.public_band_profiles WHERE slug='compat-existing-private'),'new profile after band publication');
RESET ROLE;
ROLLBACK;
