-- PREPARED, NOT EXECUTED. After bridge, BEFORE legacy URL stage. ROLLBACK only.
\set ON_ERROR_STOP on
BEGIN;
\ir publication_compatibility_target.sql
DO $stage$ BEGIN
 IF pg_catalog.to_regprocedure('private.guard_external_link_url_v1()') IS NOT NULL THEN
  RAISE EXCEPTION 'Wrong phase: URL stage already installed';
 END IF;
END; $stage$;
CREATE FUNCTION pg_temp.stage_denied(command text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE marker text;
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN check_violation THEN
  GET STACKED DIAGNOSTICS marker=CONSTRAINT_NAME;
  IF marker='social_links_url_stage_required' THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'Link publication succeeded before URL protection';
END;
$$;
SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.stage_denied($q$UPDATE public.social_links SET is_public=true
 WHERE id='63000000-0000-0000-0000-000000000001'$q$);
SELECT pg_temp.stage_denied($q$INSERT INTO public.social_links(band_id,platform,url,is_public)
 VALUES('62000000-0000-0000-0000-000000000001','website','javascript:blocked',true)$q$);
SELECT pg_temp.stage_denied($q$INSERT INTO public.social_links(id,band_id,platform,url,is_public)
 VALUES('63000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001',
 'website','https://example.invalid',true) ON CONFLICT(id) DO UPDATE SET is_public=true$q$);
RESET ROLE;
SET LOCAL ROLE anon;
DO $hidden$ BEGIN
 IF EXISTS (SELECT 1 FROM public.public_social_links)
    OR EXISTS (SELECT 1 FROM public.public_band_profiles WHERE links<>'[]'::jsonb) THEN
  RAISE EXCEPTION 'Interstage link exposure';
 END IF;
END; $hidden$;
RESET ROLE;
ROLLBACK;
