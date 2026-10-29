-- PREPARED, NOT EXECUTED. After legacy_publication_fixture, BEFORE compatibility.
-- Synthetic corpus only. Deliberate COMMIT; the bridge will make every link private.
\set ON_ERROR_STOP on
BEGIN;
\ir publication_compatibility_target.sql
\ir compatibility_url_cases.sql
INSERT INTO public.social_links(id,band_id,platform,url)
SELECT ('65000000-0000-0000-0000-'||pg_catalog.lpad((id+1)::text,12,'0'))::uuid,
 '62000000-0000-0000-0000-000000000001'::uuid,'url-case-'||id,input
FROM pg_temp.url_cases WHERE input IS NOT NULL;
COMMIT;
