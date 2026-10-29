-- COMPATIBILITY BRANCH; PREPARED, NOT EXECUTED. Original suite preserved.
-- PREPARED ONLY: explicit authorization required BEFORE Migration 10.
-- Synthetic seed only. Deliberately COMMITs. Never use on production.
\set ON_ERROR_STOP on
BEGIN;
-- Explicit target flags + exact cluster check must pass before any fixture/test write.
\ir publication_compatibility_target.sql
DO $requirements$
BEGIN
 IF pg_catalog.current_database() <> 'bandup_publication_compat_test'
 OR pg_catalog.to_regprocedure('private.guard_functional_integrity_v1()') IS NOT NULL
 OR pg_catalog.to_regprocedure('private.guard_external_link_url_v1()') IS NULL THEN
 RAISE EXCEPTION 'Requires Migration 9 present, Migration 10 absent'; END IF;
END;
$requirements$;
INSERT INTO auth.users(id) VALUES('a1000000-0000-0000-0000-000000000001'),('a1000000-0000-0000-0000-000000000002');
SELECT set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
INSERT INTO public.bands(id,name,slug,created_at,updated_at) VALUES
 ('a2000000-0000-0000-0000-000000000001',chr(160),'.','infinity','infinity');
INSERT INTO public.band_members(id,band_id,user_id,role,created_at) VALUES
 ('a3000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','member','infinity');
INSERT INTO public.tasks(id,band_id,created_by,title,status,priority,due_date,created_at) VALUES
 ('a4000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',chr(9),'todo','low','infinity','infinity');
INSERT INTO public.events(id,band_id,created_by,title,event_type,start_at,end_at,created_at) VALUES
 ('a5000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',chr(160),chr(9),'2000-01-01T00:00:00Z','infinity','infinity');
INSERT INTO public.social_links(id,band_id,platform,url,created_at) VALUES
 ('a6000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001',chr(9),'https://example.invalid/functional-legacy','infinity');
COMMIT;
