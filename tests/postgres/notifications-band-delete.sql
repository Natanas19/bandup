-- node tests/postgres/notifications-isolated.cjs --band-delete
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

\ir band-delete-bootstrap.sql
\ir ../../supabase/migrations/20261001000000_initial_bandup_schema.sql
\ir ../../supabase/migrations/20261002200000_tasks_optional_event_link.sql
\ir band-delete-dependencies.sql
\ir ../../supabase/migrations/20261112180000_band_delete.sql
\if :{?notifications_bundle}
\ir notifications-install-demo-setup.sql
\else
\ir ../../docs/notifications-backend-candidate.sql
\endif

\set admin aaaaaaaa-aaaa-4aaa-8aaa-000000000001
\set member aaaaaaaa-aaaa-4aaa-8aaa-000000000002
\set deleted_band bbbbbbbb-bbbb-4bbb-8bbb-000000000001
\set other_band bbbbbbbb-bbbb-4bbb-8bbb-000000000002
\set operation dddddddd-dddd-4ddd-8ddd-000000000001

INSERT INTO auth.users VALUES (:'admin'), (:'member');
SET request.jwt.claim.sub TO :'admin';
SET request.jwt.claim.role TO 'authenticated';
INSERT INTO public.bands(id, name, slug) VALUES
  (:'deleted_band', 'Band to delete', 'band-to-delete'),
  (:'other_band', 'Other band', 'other-band');
INSERT INTO public.band_members(band_id, user_id, role)
SELECT id, :'member', 'member' FROM public.bands;
-- These tasks only provide references for the explicit seeds below.
RESET request.jwt.claim.sub;
INSERT INTO public.tasks(band_id, created_by, title, status, priority, assigned_to)
SELECT id, :'admin', 'Assigned task', 'todo', 'medium', :'member' FROM public.bands;
SET request.jwt.claim.sub TO :'admin';

SELECT private.emit_notification(recipient, t.band_id, 'task_assigned', t.id, t.id, 'Assigned')
FROM public.tasks t CROSS JOIN unnest(ARRAY[:'admin'::uuid, :'member'::uuid]) AS recipients(recipient);
SELECT private.emit_notification(recipient, NULL, 'personal', recipient, recipient, 'Personal')
FROM unnest(ARRAY[:'admin'::uuid, :'member'::uuid]) AS recipients(recipient);

SELECT count(*) = 2 AS target_seeded FROM public.notifications WHERE band_id = :'deleted_band' \gset
CREATE TEMP TABLE expected_survivors AS
  SELECT * FROM public.notifications WHERE band_id IS DISTINCT FROM :'deleted_band'::uuid;

SET ROLE authenticated;
SELECT public.bandup_delete_band(:'deleted_band', 'Band to delete', :'operation')
  ->> 'status' = 'deleted' AS rpc_deleted \gset
RESET ROLE;

SELECT :'target_seeded'::boolean AND :'rpc_deleted'::boolean
  AND NOT EXISTS (SELECT FROM public.bands WHERE id = :'deleted_band')
  AND EXISTS (SELECT FROM public.bands WHERE id = :'other_band')
  AND (SELECT count(*) = 4 FROM expected_survivors)
  AND NOT EXISTS (
    (SELECT * FROM public.notifications EXCEPT SELECT * FROM expected_survivors)
    UNION ALL
    (SELECT * FROM expected_survivors EXCEPT SELECT * FROM public.notifications)
  ) AS compatible \gset
\if :compatible
\echo PASS deletion RPC removed only notifications of the deleted band
\else
DO $$ BEGIN RAISE EXCEPTION 'Band deletion notification compatibility failed'; END $$;
\endif

\if :{?notifications_bundle}
-- Smoke-test the three installed emitters under the same consolidated install.
\set applicant aaaaaaaa-aaaa-4aaa-8aaa-000000000003
INSERT INTO auth.users VALUES (:'applicant');
SET ROLE authenticated;
INSERT INTO public.tasks(band_id, created_by, title, status, priority, assigned_to)
VALUES (:'other_band', :'admin', 'Bundle check', 'todo', 'medium', :'member')
RETURNING id AS bundle_task \gset
INSERT INTO public.events(band_id, created_by, title, event_type, start_at)
VALUES (:'other_band', :'admin', 'Bundle check', 'show', now())
RETURNING id AS bundle_event \gset
SET request.jwt.claim.sub TO :'applicant';
SELECT public.bandup_request_entry(:'other_band', 'Bundle check') AS bundle_request \gset
SET request.jwt.claim.sub TO :'member';
SELECT count(*) = 2 AS member_visible FROM public.notifications
WHERE content_id IN (:'bundle_task', :'bundle_event') AND recipient_id = :'member' \gset
SELECT public.bandup_mark_notification_read(id) AS marked
FROM public.notifications WHERE content_id = :'bundle_task' \gset
SET request.jwt.claim.sub TO :'admin';
SELECT public.bandup_decide_entry(:'bundle_request', 'rejected');
RESET ROLE;

SELECT :'member_visible'::boolean AND :'marked'::boolean
  AND (SELECT count(*) = 4 FROM public.notifications
       WHERE content_id IN (:'bundle_task', :'bundle_event', :'bundle_request'))
  AND EXISTS (SELECT FROM public.notifications WHERE content_id = :'bundle_request'
    AND kind = 'entry_request_created' AND recipient_id = :'admin')
  AND EXISTS (SELECT FROM public.notifications WHERE content_id = :'bundle_request'
    AND kind = 'entry_request_decided' AND recipient_id = :'applicant')
  AS bundle_smoke \gset
\if :bundle_smoke
\echo PASS consolidated installation emitted all notification flows
\else
DO $$ BEGIN RAISE EXCEPTION 'Consolidated installation smoke test failed'; END $$;
\endif
\endif
