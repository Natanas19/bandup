-- node tests/postgres/notifications-isolated.cjs --entry-requests
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

\ir band-invitations-fixture.sql
\ir ../../docs/notifications-backend-candidate.sql

-- Synthetic request writer, solely to exercise authenticated RPC -> trigger.
-- Deployment RPC validation and quotas belong to the unchanged source RPC.
CREATE FUNCTION public.bandup_request_entry(p_band_id uuid, p_applicant_name text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.band_join_requests(band_id, requester_id, applicant_name)
  VALUES (p_band_id, auth.uid(), p_applicant_name)
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.bandup_request_entry(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bandup_request_entry(uuid,text) TO authenticated;

-- Reproduce the supplied decision/cancellation contracts. Return types and
-- error codes here are fixture conventions; the original SQL was not supplied.
CREATE OR REPLACE FUNCTION public.bandup_decide_entry(p_request_id uuid, p_decision text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE
  actor uuid := auth.uid();
  target uuid;
  request public.band_join_requests%ROWTYPE;
BEGIN
  SELECT band_id INTO target FROM public.band_join_requests WHERE id = p_request_id;
  PERFORM 1 FROM public.band_members
    WHERE band_id = target AND user_id = actor AND role = 'admin' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501'; END IF;

  PERFORM 1 FROM public.bands WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000'; END IF;
  SELECT * INTO request FROM public.band_join_requests
    WHERE id = p_request_id AND band_id = target FOR UPDATE;
  IF NOT FOUND OR request.status <> 'pending' THEN RAISE EXCEPTION USING ERRCODE = '55000'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'approved' THEN
    INSERT INTO public.band_members(band_id, user_id, role)
    VALUES (target, request.requester_id, 'member');
  END IF;
  UPDATE public.band_join_requests
    SET status = p_decision, decided_at = clock_timestamp(), decided_by = actor
    WHERE id = p_request_id;
END $$;

CREATE FUNCTION public.bandup_cancel_entry(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE
  actor uuid := auth.uid();
  target uuid;
  request_status text;
BEGIN
  SELECT band_id INTO target FROM public.band_join_requests
    WHERE id = p_request_id AND requester_id = actor;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501'; END IF;

  PERFORM 1 FROM public.bands WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000'; END IF;
  SELECT status INTO request_status FROM public.band_join_requests
    WHERE id = p_request_id AND band_id = target AND requester_id = actor FOR UPDATE;
  IF NOT FOUND OR request_status <> 'pending' THEN RAISE EXCEPTION USING ERRCODE = '55000'; END IF;

  UPDATE public.band_join_requests SET status = 'cancelled', cancelled_at = clock_timestamp()
    WHERE id = p_request_id;
END $$;

ALTER FUNCTION public.bandup_decide_entry(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.bandup_cancel_entry(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.bandup_decide_entry(uuid,text), public.bandup_cancel_entry(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_decide_entry(uuid,text), public.bandup_cancel_entry(uuid)
  TO authenticated;
\ir ../../docs/notifications-entry-requests-candidate.sql

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
  RAISE EXCEPTION 'Expected error: %', expected_state;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> expected_state THEN RAISE; END IF;
END $$;

\set admin aaaaaaaa-aaaa-4aaa-8aaa-000000000001
\set second_admin aaaaaaaa-aaaa-4aaa-8aaa-000000000002
\set member aaaaaaaa-aaaa-4aaa-8aaa-000000000003
\set applicant aaaaaaaa-aaaa-4aaa-8aaa-000000000004
\set other_admin aaaaaaaa-aaaa-4aaa-8aaa-000000000005
\set band bbbbbbbb-bbbb-4bbb-8bbb-000000000001
\set other_band bbbbbbbb-bbbb-4bbb-8bbb-000000000002
INSERT INTO auth.users(id) VALUES (:'admin'), (:'second_admin'), (:'member'), (:'applicant'), (:'other_admin');
INSERT INTO public.bands VALUES (:'band', 'Target band'), (:'other_band', 'Other band');
INSERT INTO public.band_members(band_id,user_id,role) VALUES
  (:'band', :'admin', 'admin'), (:'band', :'second_admin', 'admin'),
  (:'band', :'member', 'member'), (:'other_band', :'other_admin', 'admin');

SET ROLE authenticated;
SET request.jwt.claim.sub TO :'applicant';
SELECT public.bandup_request_entry(:'band', 'Applicant') AS cancelled \gset
SELECT pg_temp.expect_error(format('SELECT public.bandup_request_entry(%L,%L)', :'band', 'Retry'), '23505');
SELECT pg_temp.expect_error('UPDATE public.band_join_requests SET status = ''approved''', '42501');
SET request.jwt.claim.sub TO :'admin';
SELECT pg_temp.expect_error(format('SELECT public.bandup_cancel_entry(%L)', :'cancelled'), '42501');
SET request.jwt.claim.sub TO :'applicant';
SELECT public.bandup_cancel_entry(:'cancelled');
SELECT pg_temp.expect_error(format('SELECT public.bandup_cancel_entry(%L)', :'cancelled'), '55000');

SELECT public.bandup_request_entry(:'band', 'Applicant') AS rejected \gset
SELECT pg_temp.expect_error(format('SELECT public.bandup_decide_entry(%L,%L)', :'rejected', 'approved'), '42501');
SET request.jwt.claim.sub TO :'admin';
SELECT public.bandup_decide_entry(:'rejected', 'rejected');
SET request.jwt.claim.sub TO :'second_admin';
SELECT pg_temp.expect_error(format('SELECT public.bandup_decide_entry(%L,%L)', :'rejected', 'approved'), '55000');
SET request.jwt.claim.sub TO :'applicant';
SELECT public.bandup_request_entry(:'band', 'Applicant') AS approved \gset

BEGIN;
SET LOCAL request.jwt.claim.sub TO :'admin';
SELECT public.bandup_decide_entry(:'approved', 'approved');
ROLLBACK;
RESET ROLE;

SELECT pg_temp.check_that(
  (SELECT status = 'pending' FROM public.band_join_requests WHERE id = :'approved')
  AND NOT EXISTS (SELECT FROM public.band_members WHERE band_id = :'band' AND user_id = :'applicant')
  AND NOT EXISTS (SELECT FROM public.notifications WHERE content_id = :'approved' AND kind = 'entry_request_decided'),
  'rollback restored the pending request and removed membership and the decision notification');
SET ROLE authenticated;
SET request.jwt.claim.sub TO :'admin';
SELECT public.bandup_decide_entry(:'approved', 'approved');
RESET ROLE;

SELECT pg_temp.check_that(
  (SELECT count(*) = 6
    AND count(*) FILTER (WHERE recipient_id = :'admin') = 3
    AND count(*) FILTER (WHERE recipient_id = :'second_admin') = 3
    AND count(DISTINCT content_id) = 3
    FROM public.notifications WHERE kind = 'entry_request_created'),
  'one notification per target administrator per distinct request');
SELECT pg_temp.check_that(
  (SELECT count(*) = 2 AND bool_and(recipient_id = :'applicant')
    AND count(*) FILTER (WHERE content_id = :'rejected' AND message LIKE '%recusada.%') = 1
    AND count(*) FILTER (WHERE content_id = :'approved' AND message LIKE '%aprovada.%') = 1
    FROM public.notifications WHERE kind = 'entry_request_decided'),
  'decision goes only to the applicant and cancellation emits nothing');
SELECT pg_temp.check_that(
  (SELECT status = 'cancelled' AND cancelled_at IS NOT NULL FROM public.band_join_requests WHERE id = :'cancelled')
  AND EXISTS (SELECT FROM public.band_members WHERE band_id = :'band' AND user_id = :'applicant' AND role = 'member'),
  'the requester cancelled, and approval created membership without expanding notification recipients');
SELECT pg_temp.check_that(
  (SELECT bool_and(band_id = :'band' AND occurrence_id = content_id) FROM public.notifications),
  'notifications link to the right band and request');
SELECT pg_temp.check_that(
  NOT has_function_privilege('authenticated', 'private.notify_band_entry_request()', 'EXECUTE'),
  'callback is private');
\echo PASS entry request notifications, recipients, retries and rollback

-- Two real sessions, both using the contract fixture. Hold approval
-- open and wait for the conflicting rejection to block before committing.
CREATE EXTENSION dblink;
SELECT format('host=127.0.0.1 port=%s dbname=postgres user=postgres connect_timeout=5', :'test_port')
  AS connection \gset
SELECT dblink_connect('winner', :'connection');
SELECT dblink_connect('challenger', :'connection');
SELECT dblink_exec('winner', format('SET request.jwt.claim.sub TO %L', :'admin'));
SELECT dblink_exec('challenger', format('SET request.jwt.claim.sub TO %L', :'second_admin'));
SELECT dblink_exec('winner', 'SET ROLE authenticated');
SELECT dblink_exec('challenger', 'SET ROLE authenticated');
SELECT dblink_exec('challenger', 'SET statement_timeout TO ''10s''');
SELECT pid AS challenger_pid
FROM dblink('challenger', 'SELECT pg_backend_pid()') AS remote(pid integer) \gset

-- The applicant already joined the first band. Start a separate request in
-- the other band and give the same two test administrators access there.
INSERT INTO public.band_members(band_id, user_id, role)
VALUES (:'other_band', :'admin', 'admin'), (:'other_band', :'second_admin', 'admin');
SET ROLE authenticated;
SET request.jwt.claim.sub TO :'applicant';
SELECT public.bandup_request_entry(:'other_band', 'Contested applicant') AS contested \gset
RESET ROLE;

SELECT dblink_exec('winner', 'BEGIN');
SELECT result FROM dblink('winner', format(
  'SELECT public.bandup_decide_entry(%L, %L)::text', :'contested', 'approved'
)) AS remote(result text);
SELECT pg_temp.check_that(
  NOT EXISTS (SELECT FROM public.notifications WHERE content_id = :'contested' AND kind = 'entry_request_decided'),
  'uncommitted approval is invisible');
SELECT pg_temp.check_that(dblink_send_query('challenger', format(
  'SELECT public.bandup_decide_entry(%L, %L)::text', :'contested', 'rejected'
)) = 1, 'challenger sent a conflicting decision');
SELECT set_config('bandup_test.challenger_pid', :'challenger_pid', false);
DO $wait_for_lock$
DECLARE deadline timestamptz := clock_timestamp() + interval '5 seconds';
BEGIN
  WHILE cardinality(pg_blocking_pids(current_setting('bandup_test.challenger_pid')::int)) = 0 LOOP
    IF clock_timestamp() >= deadline THEN RAISE EXCEPTION 'Challenger did not block'; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
END
$wait_for_lock$;
SELECT dblink_exec('winner', 'COMMIT');
SELECT pg_temp.expect_error(
  'SELECT result FROM dblink_get_result(''challenger'') AS remote(result text)', '55000');
SELECT pg_temp.check_that(
  (SELECT status = 'approved' FROM public.band_join_requests WHERE id = :'contested')
  AND (SELECT count(*) = 1 AND bool_and(recipient_id = :'applicant' AND message LIKE '%aprovada.%')
       FROM public.notifications WHERE content_id = :'contested' AND kind = 'entry_request_decided'),
  'only the committed decision emitted');
SELECT dblink_disconnect('challenger');
SELECT dblink_disconnect('winner');
\echo PASS concurrent decision yielded one notification
