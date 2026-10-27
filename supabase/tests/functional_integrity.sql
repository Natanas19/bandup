-- PREPARED ONLY. This suite never applies migrations; requires prior legacy seed.
\set ON_ERROR_STOP on
BEGIN;
-- Explicit target flags + exact cluster check must pass before any fixture/test write.
\ir sql_test_capabilities.sql
DO $requirements$
BEGIN
 IF pg_catalog.current_database() <> 'bandup_functional_integrity_20261027b'
 OR pg_catalog.to_regprocedure('private.guard_functional_integrity_v1()') IS NULL
 OR NOT EXISTS(SELECT 1 FROM public.bands WHERE id='a2000000-0000-0000-0000-000000000001' AND slug='.' AND name=chr(160))
 OR NOT EXISTS(SELECT 1 FROM public.events WHERE id='a5000000-0000-0000-0000-000000000001' AND start_at='2000-01-01T00:00:00Z'::timestamptz AND end_at='infinity'::timestamptz) THEN
 RAISE EXCEPTION 'Missing Migration 10 or pre-migration functional fixtures'; END IF;
END;
$requirements$;
CREATE FUNCTION pg_temp.fi_assert(ok boolean,label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $assert$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END;
$assert$;
CREATE FUNCTION pg_temp.fi_reject(command text,state text,expected_constraint text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $reject$
DECLARE actual_state text; actual_constraint text;
BEGIN
 BEGIN EXECUTE command;
 EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE,actual_constraint=CONSTRAINT_NAME;
 IF actual_state=state AND (expected_constraint IS NULL OR actual_constraint=expected_constraint) THEN
 RAISE NOTICE 'PASS: rejected % / %',actual_state,actual_constraint; RETURN; END IF;
 RAISE;
 END;
 RAISE EXCEPTION 'Expected rejection did not occur';
END;
$reject$;
SELECT pg_temp.fi_assert((SELECT count(*)=5 FROM pg_catalog.pg_trigger WHERE tgname IN
 ('bands_zz_guard_functional_integrity','band_members_zz_guard_functional_integrity','tasks_zz_guard_functional_integrity','events_zz_guard_functional_integrity','social_links_zz_guard_functional_integrity')
 AND tgtype=23 AND tgenabled='O' AND tgfoid='private.guard_functional_integrity_v1()'::regprocedure),'five real guards installed');
SELECT pg_temp.fi_assert(NOT has_function_privilege('authenticated','private.guard_functional_integrity_v1()','EXECUTE'),'no direct application EXECUTE added');
-- All functional writes run under the actual application role and its RLS.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
INSERT INTO public.bands(id,name,slug) VALUES('a2000000-0000-0000-0000-000000000002','Valid','functional-integrity-valid');
INSERT INTO public.tasks(id,band_id,created_by,title,status,priority) VALUES
 ('a4000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','todo','low');
INSERT INTO public.events(id,band_id,created_by,title,event_type,start_at) VALUES
 ('a5000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','show',statement_timestamp()+interval '1 day');
INSERT INTO public.social_links(id,band_id,platform,url) VALUES
 ('a6000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002','Website','https://example.invalid/functional-valid');
DO $text_cases$
DECLARE value text; item record;
BEGIN
 FOREACH value IN ARRAY ARRAY['',' ',chr(9),chr(160),' '||chr(9)||chr(10)||chr(160),chr(65279)] LOOP
 FOR item IN SELECT * FROM (VALUES
 ('bands','name','a2000000-0000-0000-0000-000000000002'),('tasks','title','a4000000-0000-0000-0000-000000000002'),
 ('events','title','a5000000-0000-0000-0000-000000000002'),('events','event_type','a5000000-0000-0000-0000-000000000002'),
 ('social_links','platform','a6000000-0000-0000-0000-000000000002')) AS cases(table_name,column_name,id) LOOP
 PERFORM pg_temp.fi_reject(format('UPDATE public.%I SET %I=%L WHERE id=%L',item.table_name,item.column_name,value,item.id),'23514',
 CASE WHEN item.column_name='event_type' THEN NULL ELSE item.table_name||'_'||item.column_name||'_nonblank' END);
 END LOOP;
 PERFORM pg_temp.fi_reject(format('INSERT INTO public.bands(name,slug) VALUES(%L,''functional-invalid'')',value),'23514','bands_name_nonblank');
 END LOOP;
END;
$text_cases$;
SELECT pg_temp.fi_reject($q$INSERT INTO public.tasks(band_id,created_by,title,status,priority) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001',chr(160),'todo','low')$q$,'23514','tasks_title_nonblank');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001',chr(160),'show',statement_timestamp()+interval '1 day')$q$,'23514','events_title_nonblank');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid',chr(160),statement_timestamp()+interval '1 day')$q$,'23514','events_event_type_nonblank');
SELECT pg_temp.fi_reject($q$INSERT INTO public.social_links(band_id,platform,url) VALUES('a2000000-0000-0000-0000-000000000002',chr(160),'https://example.invalid/blank-platform')$q$,'23514','social_links_platform_nonblank');
SELECT pg_temp.fi_reject($q$UPDATE public.bands SET name=NULL WHERE id='a2000000-0000-0000-0000-000000000002'$q$,'23502');
SELECT pg_temp.fi_reject($q$UPDATE public.bands SET slug=NULL WHERE id='a2000000-0000-0000-0000-000000000002'$q$,'23502');
SELECT pg_temp.fi_reject($q$UPDATE public.tasks SET title=NULL WHERE id='a4000000-0000-0000-0000-000000000002'$q$,'23502');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET title=NULL WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23502');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET event_type=NULL WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23502');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET start_at=NULL WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23502');
SELECT pg_temp.fi_reject($q$UPDATE public.social_links SET platform=NULL WHERE id='a6000000-0000-0000-0000-000000000002'$q$,'23502');

DO $slug_cases$
DECLARE value text;
BEGIN
 FOREACH value IN ARRAY ARRAY['',' ',chr(160),'.','..','bad'||chr(9),repeat('x',2049),repeat(chr(128512),1025)] LOOP
 PERFORM pg_temp.fi_reject(format('UPDATE public.bands SET slug=%L WHERE id=''a2000000-0000-0000-0000-000000000002''',value),'23514');
 PERFORM pg_temp.fi_reject(format('INSERT INTO public.bands(name,slug) VALUES(''Valid'',%L)',value),'23514');
 END LOOP;
 FOREACH value IN ARRAY ARRAY['Banda '||chr(233),'music/rock','band%20name',repeat(chr(128512),1024)] LOOP
 UPDATE public.bands SET slug=value WHERE id='a2000000-0000-0000-0000-000000000002';
 PERFORM pg_temp.fi_assert((SELECT slug=value FROM public.bands WHERE id='a2000000-0000-0000-0000-000000000002'),'accepted slug is not normalized');
 END LOOP;
END;
$slug_cases$;
SELECT pg_temp.fi_reject($q$UPDATE public.bands SET created_at='infinity' WHERE id='a2000000-0000-0000-0000-000000000002'$q$,'23514','bands_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.bands SET created_at='-infinity' WHERE id='a2000000-0000-0000-0000-000000000002'$q$,'23514','bands_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.tasks SET created_at='infinity' WHERE id='a4000000-0000-0000-0000-000000000002'$q$,'23514','tasks_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.tasks SET created_at='-infinity' WHERE id='a4000000-0000-0000-0000-000000000002'$q$,'23514','tasks_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.tasks SET due_date='infinity' WHERE id='a4000000-0000-0000-0000-000000000002'$q$,'23514','tasks_due_date_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.tasks SET due_date='-infinity' WHERE id='a4000000-0000-0000-0000-000000000002'$q$,'23514','tasks_due_date_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET created_at='infinity' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23514','events_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET created_at='-infinity' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23514','events_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET start_at='infinity' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23514','events_start_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET start_at='-infinity' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23514','events_start_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET end_at='infinity' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23514','events_end_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET end_at='-infinity' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23514','events_end_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.social_links SET created_at='infinity' WHERE id='a6000000-0000-0000-0000-000000000002'$q$,'23514','social_links_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.social_links SET created_at='-infinity' WHERE id='a6000000-0000-0000-0000-000000000002'$q$,'23514','social_links_created_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Past','show',statement_timestamp()-interval '1 day')$q$,'23514','events_start_at_not_past');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET start_at=statement_timestamp()-interval '1 second' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23514','events_start_at_not_past');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET end_at=start_at-interval '1 second' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'23514');
SELECT pg_temp.fi_reject($q$UPDATE public.events SET start_at='not-a-date' WHERE id='a5000000-0000-0000-0000-000000000002'$q$,'22007');

UPDATE public.tasks SET title='Unicode '||chr(128512),due_date=NULL,description=NULL WHERE id='a4000000-0000-0000-0000-000000000002';
UPDATE public.events SET end_at=NULL,location=NULL,description=NULL WHERE id='a5000000-0000-0000-0000-000000000002';
SELECT pg_temp.fi_assert((SELECT due_date IS NULL AND description IS NULL FROM public.tasks WHERE id='a4000000-0000-0000-0000-000000000002'),'optional task NULLs preserved');
SELECT pg_temp.fi_assert((SELECT end_at IS NULL AND location IS NULL AND description IS NULL FROM public.events WHERE id='a5000000-0000-0000-0000-000000000002'),'optional event NULLs preserved');
-- Same instant, different offset: unchanged historical start is not a reschedule.
UPDATE public.events SET start_at='1999-12-31T21:00:00-03',description='Edited historical event' WHERE id='a5000000-0000-0000-0000-000000000001';
UPDATE public.bands SET description='Edited legacy band' WHERE id='a2000000-0000-0000-0000-000000000001';
UPDATE public.tasks SET status='done',description='Edited legacy task' WHERE id='a4000000-0000-0000-0000-000000000001';
UPDATE public.social_links SET is_public=false WHERE id='a6000000-0000-0000-0000-000000000001';
SELECT pg_temp.fi_assert((SELECT slug='.' AND name=chr(160) AND created_at='infinity'::timestamptz FROM public.bands WHERE id='a2000000-0000-0000-0000-000000000001'),'legacy slug/name/timestamp unchanged');
SELECT pg_temp.fi_assert((SELECT title=chr(9) AND due_date='infinity'::timestamptz AND status='done' FROM public.tasks WHERE id='a4000000-0000-0000-0000-000000000001'),'legacy task remains editable');
SELECT pg_temp.fi_assert((SELECT start_at='2000-01-01T00:00:00Z'::timestamptz AND end_at='infinity'::timestamptz AND event_type=chr(9) FROM public.events WHERE id='a5000000-0000-0000-0000-000000000001'),'historical event is not rescheduled or normalized');
SELECT pg_temp.fi_assert((SELECT platform=chr(9) FROM public.social_links WHERE id='a6000000-0000-0000-0000-000000000001'),'legacy platform unchanged');
SELECT pg_temp.fi_reject($q$UPDATE public.tasks SET created_by='a1000000-0000-0000-0000-000000000002' WHERE id='a4000000-0000-0000-0000-000000000002'$q$,'23514','tasks_ownership_immutable');
SELECT pg_temp.fi_reject($q$UPDATE public.social_links SET url='javascript:alert(1)' WHERE id='a6000000-0000-0000-0000-000000000002'$q$,'23514','social_links_external_url_safe');
SELECT pg_temp.fi_reject($q$INSERT INTO public.bands(name,slug,created_at) VALUES('Valid','functional-created','infinity')$q$,'23514','bands_created_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.bands(name,slug,updated_at) VALUES('Valid','functional-updated','infinity')$q$,'23514','bands_updated_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.tasks(band_id,created_by,title,status,priority,updated_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','todo','low','infinity')$q$,'23514','tasks_updated_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.tasks(band_id,created_by,title,status,priority,due_date) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','todo','low','infinity')$q$,'23514','tasks_due_date_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at,updated_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','show',statement_timestamp()+interval '1 day','infinity')$q$,'23514','events_updated_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','show','infinity')$q$,'23514','events_start_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at,end_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','show',statement_timestamp()+interval '1 day','infinity')$q$,'23514','events_end_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.band_members(band_id,user_id,role,created_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','member','infinity')$q$,'23514','band_members_created_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.bands(name,slug,created_at) VALUES('Valid','functional-created','-infinity')$q$,'23514','bands_created_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.bands(name,slug,updated_at) VALUES('Valid','functional-updated','-infinity')$q$,'23514','bands_updated_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.tasks(band_id,created_by,title,status,priority,updated_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','todo','low','-infinity')$q$,'23514','tasks_updated_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.tasks(band_id,created_by,title,status,priority,due_date) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','todo','low','-infinity')$q$,'23514','tasks_due_date_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at,updated_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','show',statement_timestamp()+interval '1 day','-infinity')$q$,'23514','events_updated_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','show','-infinity')$q$,'23514','events_start_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(band_id,created_by,title,event_type,start_at,end_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Valid','show',statement_timestamp()+interval '1 day','-infinity')$q$,'23514','events_end_at_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.band_members(band_id,user_id,role,created_at) VALUES('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','member','-infinity')$q$,'23514','band_members_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.band_members SET created_at='infinity' WHERE band_id='a2000000-0000-0000-0000-000000000002' AND user_id='a1000000-0000-0000-0000-000000000001'$q$,'23514','band_members_created_at_finite');
SELECT pg_temp.fi_reject($q$UPDATE public.tasks SET due_date='infinity' WHERE id='a4000000-0000-0000-0000-000000000002'$q$,'23514','tasks_due_date_finite');
SELECT pg_temp.fi_reject($q$INSERT INTO public.bands(name,slug) VALUES(NULL,'functional-null')$q$,'23502');

-- Existing set_updated_at intentionally replaces supplied updated_at on UPDATE.
UPDATE public.bands SET updated_at='infinity',name='Banda '||chr(233) WHERE id='a2000000-0000-0000-0000-000000000002';
SELECT pg_temp.fi_assert((SELECT isfinite(updated_at) AND name='Banda '||chr(233) FROM public.bands WHERE id='a2000000-0000-0000-0000-000000000002'),'historical audit trigger preserves finite updated_at and Unicode name');
UPDATE public.events SET title='Unicode '||chr(128512),event_type='Custom '||chr(233) WHERE id='a5000000-0000-0000-0000-000000000002';
SELECT pg_temp.fi_assert((SELECT title='Unicode '||chr(128512) FROM public.events WHERE id='a5000000-0000-0000-0000-000000000002'),'Unicode event title accepted');
UPDATE public.social_links SET platform='Unicode '||chr(233) WHERE id='a6000000-0000-0000-0000-000000000002';
UPDATE public.band_members SET role=role WHERE id='a3000000-0000-0000-0000-000000000001';
SELECT pg_temp.fi_assert((SELECT created_at='infinity'::timestamptz FROM public.band_members WHERE id='a3000000-0000-0000-0000-000000000001'),'unchanged legacy membership timestamp preserved');

-- Exact statement-time boundary is permitted; optional dates remain NULL.
INSERT INTO public.events(id,band_id,created_by,title,event_type,start_at,end_at) VALUES
 ('a5000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','At boundary','show',statement_timestamp(),NULL);
SELECT pg_temp.fi_assert((SELECT isfinite(start_at) AND end_at IS NULL FROM public.events WHERE id='a5000000-0000-0000-0000-000000000003'),'statement-time equality is allowed');
UPDATE public.tasks SET title='Repaired legacy title' WHERE id='a4000000-0000-0000-0000-000000000001';
SELECT pg_temp.fi_assert((SELECT title='Repaired legacy title' AND due_date='infinity'::timestamptz FROM public.tasks WHERE id='a4000000-0000-0000-0000-000000000001'),'repair one legacy field without forcing unrelated legacy repair');
SELECT pg_temp.fi_reject($q$UPDATE public.tasks SET title=chr(9) WHERE id='a4000000-0000-0000-0000-000000000001'$q$,'23514','tasks_title_nonblank');
-- An upsert validates its INSERT candidate first. Use UPDATE to edit historical starts.
SELECT pg_temp.fi_reject($q$INSERT INTO public.events(id,band_id,created_by,title,event_type,start_at)
 VALUES('a5000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Valid title','show','2000-01-01T00:00:00Z')
 ON CONFLICT(id) DO UPDATE SET description='upsert historical metadata'$q$,'23514','events_start_at_not_past');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.fi_reject('SELECT title FROM public.tasks','42501');
RESET ROLE;
ROLLBACK;
