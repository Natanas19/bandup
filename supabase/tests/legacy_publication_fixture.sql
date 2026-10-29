-- SYNTHETIC CONTRACT, NOT the missing 20261004120000 SQL and not production evidence.
-- PREPARED, NOT EXECUTED. Disposable target gate BEFORE any write.
-- Requires initial five LOCAL migrations + ownership guards only, standard auth
-- helpers/roles with reviewed application grants. Deliberately COMMITs the legacy
-- contract and two unpublished/public sample bands for the upgrade test.
\set ON_ERROR_STOP on
BEGIN;
\ir publication_compatibility_target.sql
CREATE ROLE bandup_public_reader
 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER TABLE public.bands ADD COLUMN is_public boolean NOT NULL DEFAULT false;
GRANT USAGE ON SCHEMA public TO bandup_public_reader;
GRANT SELECT (id,name,slug,description,logo_url,is_public) ON public.bands TO bandup_public_reader;
GRANT SELECT (band_id,title,event_type,start_at,end_at,location) ON public.events TO bandup_public_reader;
GRANT SELECT (band_id,platform,url) ON public.social_links TO bandup_public_reader;
CREATE POLICY bands_select_for_public_reader ON public.bands FOR SELECT TO bandup_public_reader
 USING (is_public IS TRUE);
CREATE POLICY events_select_for_public_reader ON public.events FOR SELECT TO bandup_public_reader
 USING (EXISTS (SELECT 1 FROM public.bands band WHERE band.id=events.band_id AND band.is_public IS TRUE));
CREATE POLICY social_links_select_for_public_reader ON public.social_links FOR SELECT TO bandup_public_reader
 USING (EXISTS (SELECT 1 FROM public.bands band WHERE band.id=social_links.band_id AND band.is_public IS TRUE));
CREATE VIEW public.public_bands WITH (security_barrier=true,security_invoker=false) AS
 SELECT id,name,slug,description,logo_url FROM public.bands WHERE is_public IS TRUE;
CREATE VIEW public.public_events WITH (security_barrier=true,security_invoker=false) AS
 SELECT band_id,title,event_type,start_at,end_at,location FROM public.events
 WHERE start_at>=pg_catalog.now() AND EXISTS (SELECT 1 FROM public.bands band
   WHERE band.id=events.band_id AND band.is_public IS TRUE);
CREATE VIEW public.public_social_links WITH (security_barrier=true,security_invoker=false) AS
 SELECT band_id,platform,url FROM public.social_links WHERE EXISTS (SELECT 1 FROM public.bands band
   WHERE band.id=social_links.band_id AND band.is_public IS TRUE);
-- Only a newly created reader is configured here. This is a fixture, not repair.
GRANT CREATE ON SCHEMA public TO bandup_public_reader;
ALTER VIEW public.public_bands OWNER TO bandup_public_reader;
ALTER VIEW public.public_events OWNER TO bandup_public_reader;
ALTER VIEW public.public_social_links OWNER TO bandup_public_reader;
REVOKE CREATE ON SCHEMA public FROM bandup_public_reader;
REVOKE ALL ON public.public_bands,public.public_events,public.public_social_links
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.public_bands,public.public_events,public.public_social_links TO anon,authenticated;
INSERT INTO auth.users(id) VALUES ('61000000-0000-0000-0000-000000000001');
SELECT pg_catalog.set_config('request.jwt.claim.sub','61000000-0000-0000-0000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
INSERT INTO public.bands(id,name,slug,is_public) VALUES
 ('62000000-0000-0000-0000-000000000001','Legacy public fixture','compat-existing-public',true),
 ('62000000-0000-0000-0000-000000000002','Legacy private fixture','compat-existing-private',false);
INSERT INTO public.social_links(id,band_id,platform,url) VALUES
 ('63000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','website','https://example.com/legacy'),
 ('63000000-0000-0000-0000-000000000002','62000000-0000-0000-0000-000000000002','website','https://example.com/hidden'),
 ('63000000-0000-0000-0000-000000000003','62000000-0000-0000-0000-000000000001','website','javascript:legacy');
COMMIT;
