-- Run with notifications-isolated.cjs against its disposable cluster.
SELECT current_database() = 'postgres'
  AND current_user = 'postgres'
  AND inet_server_addr() = '127.0.0.1'::inet
  AND inet_server_port() = :'test_port'::int
  AND lower(replace(current_setting('data_directory'), chr(92), '/')) = lower(:'test_data')
  AS isolated \gset
\if :isolated
\else
DO $$ BEGIN RAISE EXCEPTION 'Unexpected test cluster'; END $$;
\endif

CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
-- Deliberately broad defaults exercise the explicit revokes.
GRANT USAGE ON SCHEMA auth, private TO PUBLIC;
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE public.bands (id uuid PRIMARY KEY);
CREATE TABLE public.tasks (id uuid PRIMARY KEY);

\ir ../../docs/notifications-backend-candidate.sql

BEGIN;
CREATE FUNCTION pg_temp.check_that(condition boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Failed: %', description;
  END IF;
END $$;
CREATE FUNCTION pg_temp.denied(command text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE command;
  RAISE EXCEPTION 'Expected insufficient_privilege: %', command;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN;
END $$;

\set alice 10000000-0000-0000-0000-000000000001
\set bob 10000000-0000-0000-0000-000000000002
\set band 20000000-0000-0000-0000-000000000001
\set task 30000000-0000-0000-0000-000000000001
\set occurrence 40000000-0000-0000-0000-000000000001
\set reassignment 40000000-0000-0000-0000-000000000002
INSERT INTO auth.users VALUES (:'alice'), (:'bob');
INSERT INTO public.bands VALUES (:'band');
INSERT INTO public.tasks VALUES (:'task');
SELECT private.emit_notification(:'alice', :'band', 'task_assigned', :'task', :'occurrence', 'Assigned');
SELECT private.emit_notification(:'alice', :'band', 'task_assigned', :'task', :'occurrence', 'Retry');
SELECT private.emit_notification(:'alice', :'band', 'task_assigned', :'task', :'reassignment', 'Reassigned');
SELECT private.emit_notification(:'bob', :'band', 'task_assigned', :'task', :'occurrence', 'Assigned');
SELECT private.emit_notification(:'alice', NULL, 'personal', :'task', :'occurrence', 'Personal');
SELECT id AS alice_id FROM public.notifications WHERE recipient_id = :'alice' AND message = 'Assigned' \gset
SELECT id AS bob_id FROM public.notifications WHERE recipient_id = :'bob' \gset

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'alice', true);
SELECT pg_temp.check_that((SELECT count(*) = 3 AND bool_and(recipient_id = :'alice')
  AND count(*) FILTER (WHERE message = 'Retry') = 0 FROM public.notifications),
  'own feed, distinct occurrences, duplicate ignored');
SELECT pg_temp.denied('INSERT INTO public.notifications DEFAULT VALUES');
SELECT pg_temp.denied('UPDATE public.notifications SET read_at = now()');
SELECT pg_temp.denied('DELETE FROM public.notifications');
SELECT pg_temp.denied(pg_catalog.format(
  'SELECT private.emit_notification(%L,NULL,%L,%L,%L,%L)',
  :'bob', 'forged', :'task', :'occurrence', 'Forged'));
SELECT pg_temp.check_that(NOT public.bandup_mark_notification_read(:'bob_id'), 'foreign mark is ignored');
SELECT pg_temp.check_that(public.bandup_mark_notification_read(:'alice_id'), 'own single mark');
SELECT read_at AS first_read FROM public.notifications WHERE id = :'alice_id' \gset
SELECT pg_temp.check_that(NOT public.bandup_mark_notification_read(:'alice_id'), 'repeat single mark');
SELECT pg_temp.check_that(public.bandup_mark_all_notifications_read() = 2, 'mark all own rows');
SELECT pg_temp.check_that(public.bandup_mark_all_notifications_read() = 0, 'repeat bulk mark');
SELECT pg_temp.check_that((SELECT bool_and(read_at IS NOT NULL) FROM public.notifications)
  AND (SELECT read_at = :'first_read'::timestamptz FROM public.notifications WHERE id = :'alice_id'),
  'all read and first timestamp preserved');
SELECT set_config('request.jwt.claim.sub', :'bob', true);
SELECT pg_temp.check_that((SELECT count(*) = 1 AND bool_and(id = :'bob_id' AND read_at IS NULL)
  FROM public.notifications), 'other recipient kept unread');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM public.notifications), 'missing identity sees nothing');
SELECT pg_temp.check_that(NOT public.bandup_mark_notification_read(:'bob_id'), 'missing identity cannot mark one');
SELECT pg_temp.check_that(public.bandup_mark_all_notifications_read() = 0, 'missing identity cannot bulk mark');
RESET ROLE;

SELECT pg_temp.check_that(NOT EXISTS (
  SELECT FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS roles(role_name)
  WHERE has_table_privilege(role_name, 'public.notifications', 'INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_function_privilege(role_name, 'private.emit_notification(uuid,uuid,text,uuid,uuid,text)', 'EXECUTE')
), 'no API role can write or emit');
SELECT pg_temp.check_that(NOT EXISTS (
  SELECT FROM unnest(ARRAY['anon', 'service_role']) AS roles(role_name)
  WHERE has_table_privilege(role_name, 'public.notifications', 'SELECT')
    OR has_function_privilege(role_name, 'public.bandup_mark_notification_read(uuid)', 'EXECUTE')
    OR has_function_privilege(role_name, 'public.bandup_mark_all_notifications_read()', 'EXECUTE')
), 'only authenticated can read or call mark RPCs');

DELETE FROM public.tasks WHERE id = :'task';
SELECT pg_temp.check_that((SELECT count(*) = 4 FROM public.notifications WHERE content_id = :'task'),
  'deleted target can leave a notification');
DELETE FROM public.bands WHERE id = :'band';
SELECT pg_temp.check_that((SELECT count(*) = 1 AND bool_and(band_id IS NULL) FROM public.notifications),
  'band cascade preserves personal notifications');
DELETE FROM auth.users WHERE id = :'alice';
SELECT pg_temp.check_that((SELECT count(*) = 0 FROM public.notifications), 'account cascade');
ROLLBACK;
\echo PASS notifications isolation, permissions, marking, deduplication and cascades
