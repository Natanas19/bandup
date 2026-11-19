-- The base scenario verifies the disposable cluster before any SQL changes.
\ir notifications-isolated.sql

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '');
$$;

INSERT INTO auth.users VALUES (:'alice'), (:'bob');
SELECT private.emit_notification(:'alice', NULL, 'task_assigned', :'task', :'occurrence', 'already read');
SELECT private.emit_notification(:'bob', NULL, 'task_assigned', :'task', :'occurrence', 'other recipient');
UPDATE public.notifications SET read_at = statement_timestamp();

\ir ../../docs/notifications-clear-candidate.sql

BEGIN;
CREATE FUNCTION pg_temp.check_that(condition boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Failed: %', description;
  END IF;
END $$;
CREATE FUNCTION pg_temp.expect_error(command text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE command;
  RAISE EXCEPTION 'Expected SQLSTATE %', expected_state;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> expected_state THEN RAISE; END IF;
END $$;

SELECT pg_temp.check_that((SELECT count(*) = 2 AND bool_and(cleared_at IS NULL) FROM public.notifications),
  'incremental install preserves existing rows as active');
SELECT pg_temp.check_that(NOT EXISTS (
  SELECT FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS roles(role_name)
  WHERE has_table_privilege(role_name, 'public.notifications', 'UPDATE,DELETE')
    OR has_column_privilege(role_name, 'public.notifications', 'cleared_at', 'UPDATE')
), 'no direct archive or delete permission');
SELECT pg_temp.check_that(
  has_function_privilege('authenticated', 'public.bandup_clear_read_notifications(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.bandup_clear_read_notifications(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.bandup_clear_read_notifications(timestamptz)', 'EXECUTE'),
  'archive RPC only executable by authenticated API role');

SELECT statement_timestamp() AS cutoff \gset
INSERT INTO public.notifications (recipient_id, kind, content_id, occurrence_id, message, created_at, read_at)
VALUES
  (:'alice', 'unread', :'task', :'occurrence', 'unread before cutoff', :'cutoff', NULL),
  (:'alice', 'late_read', :'task', :'occurrence', 'read after cutoff', :'cutoff', statement_timestamp()),
  (:'alice', 'new', :'task', :'occurrence', 'arrived after cutoff', statement_timestamp(), :'cutoff'),
  (:'alice', 'boundary', :'task', :'occurrence', 'read exactly at cutoff', :'cutoff', :'cutoff');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'alice', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT pg_temp.expect_error('SELECT public.bandup_clear_read_notifications(statement_timestamp())', '42501');
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.expect_error('SELECT public.bandup_clear_read_notifications(statement_timestamp())', '42501');
SELECT set_config('request.jwt.claim.sub', :'alice', true);
SELECT pg_temp.expect_error('SELECT public.bandup_clear_read_notifications(NULL)', '22023');
SELECT pg_temp.expect_error('SELECT public.bandup_clear_read_notifications(''infinity'')', '22023');
SELECT pg_temp.expect_error('SELECT public.bandup_clear_read_notifications(''-infinity'')', '22023');
SELECT pg_temp.expect_error('SELECT public.bandup_clear_read_notifications(statement_timestamp() + interval ''1 day'')', '22023');
SELECT pg_temp.expect_error('UPDATE public.notifications SET cleared_at = statement_timestamp()', '42501');
SELECT pg_temp.expect_error('DELETE FROM public.notifications', '42501');
SELECT pg_temp.check_that(public.bandup_clear_read_notifications(:'cutoff') = 2, 'only eligible own rows archived');
SELECT pg_temp.check_that(public.bandup_clear_read_notifications(:'cutoff') = 0, 'retry is idempotent');
SELECT pg_temp.check_that((SELECT array_agg(kind ORDER BY kind) = ARRAY['late_read', 'new', 'unread']
  FROM public.notifications WHERE cleared_at IS NULL), 'active feed excludes archived, preserves new and unread rows');
SELECT pg_temp.check_that((SELECT count(*) = 1 FROM public.notifications
  WHERE cleared_at IS NULL AND read_at IS NULL), 'unread count uses active filter');
SELECT pg_temp.check_that((SELECT count(*) = 2 AND bool_and(read_at <= :'cutoff'::timestamptz)
  FROM public.notifications WHERE cleared_at IS NOT NULL), 'archived rows and read timestamps retained');

SELECT set_config('request.jwt.claim.sub', :'bob', true);
SELECT pg_temp.check_that((SELECT count(*) = 1 AND bool_and(cleared_at IS NULL)
  FROM public.notifications), 'other recipient unaffected');
RESET ROLE;

SELECT private.emit_notification(:'alice', NULL, 'task_assigned', :'task', :'occurrence', 'duplicate');
SELECT pg_temp.check_that((SELECT count(*) = 1 AND bool_and(cleared_at IS NOT NULL)
  FROM public.notifications WHERE recipient_id = :'alice' AND kind = 'task_assigned'),
  'deduplication still suppresses retries for archived occurrences');
ROLLBACK;
\echo PASS notification archiving, authorization, cutoff, active queries and deduplication
