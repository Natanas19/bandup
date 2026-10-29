-- INCLUDE ONLY in a gated test transaction; synthetic data, NOT archived SQL.
-- now() is transaction-stable: equality is tested without wall-clock races.
-- Direct invocation must fail at the same identity gate as the parent suite.
\set ON_ERROR_STOP on
\ir historical_lab_identity_check.sql
INSERT INTO auth.users(id) VALUES ('81000000-0000-0000-0000-000000000001');
SELECT pg_catalog.set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
INSERT INTO public.bands(id,name,slug,is_public) VALUES
 ('82000000-0000-0000-0000-000000000001','Historical public fixture','historical-fixture-public',true),
 ('82000000-0000-0000-0000-000000000002','Historical private fixture','historical-fixture-private',false);
INSERT INTO public.social_links(band_id,platform,url) VALUES
 ('82000000-0000-0000-0000-000000000001','website','https://example.com/historical'),
 ('82000000-0000-0000-0000-000000000001','website','javascript:historical-fixture'),
 ('82000000-0000-0000-0000-000000000002','website','https://example.com/private');
INSERT INTO public.events(band_id,created_by,title,event_type,start_at)
SELECT band_id,'81000000-0000-0000-0000-000000000001'::uuid,'Historical event fixture','rehearsal',moment
FROM (VALUES ('82000000-0000-0000-0000-000000000001'::uuid),
 ('82000000-0000-0000-0000-000000000002'::uuid)) AS b(band_id)
CROSS JOIN (VALUES (pg_catalog.now()-interval '1 day'),(pg_catalog.now()),
 (pg_catalog.now()+interval '1 day')) AS t(moment);
