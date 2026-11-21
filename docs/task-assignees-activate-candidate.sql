-- Cutover candidate. Review the installed contracts and deploy a compatible
-- frontend before authorizing this transaction. See task-assignees-activation.md.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

LOCK TABLE public.tasks, public.task_assignees IN ACCESS EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_class WHERE oid = 'public.tasks'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT FROM pg_class WHERE oid = 'public.task_assignees'::regclass AND relrowsecurity)
     OR NOT EXISTS (
       SELECT FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass AND convalidated
         AND pg_get_constraintdef(oid) = 'FOREIGN KEY (band_id, event_id) REFERENCES public.events(band_id, id) ON DELETE SET NULL (event_id)'
     )
     OR NOT EXISTS (
       SELECT FROM pg_constraint WHERE conrelid = 'public.task_assignees'::regclass AND convalidated
         AND pg_get_constraintdef(oid) = 'PRIMARY KEY (task_id, user_id)'
     )
     OR NOT EXISTS (
       SELECT FROM pg_constraint WHERE conrelid = 'public.task_assignees'::regclass AND convalidated
         AND pg_get_constraintdef(oid) = 'FOREIGN KEY (band_id, task_id) REFERENCES public.tasks(band_id, id) ON DELETE CASCADE'
     )
     OR NOT EXISTS (
       SELECT FROM pg_constraint WHERE conrelid = 'public.task_assignees'::regclass AND convalidated
         AND pg_get_constraintdef(oid) = 'FOREIGN KEY (band_id, user_id) REFERENCES public.band_members(band_id, user_id) ON DELETE CASCADE'
     ) THEN
    RAISE EXCEPTION 'Unexpected task or assignee contract';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.tasks'::regclass AND tgenabled = 'O'
      AND ((tgname = 'tasks_sync_assignees_legacy' AND tgfoid = 'private.sync_task_assignees_legacy()'::regprocedure)
        OR (tgname = 'tasks_notify_assignment' AND tgfoid = 'private.notify_task_assignment()'::regprocedure))) <> 2
     OR to_regprocedure('private.emit_notification(uuid,uuid,text,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Unexpected legacy assignment or notification triggers';
  END IF;
  IF EXISTS (
    SELECT FROM public.tasks t
    WHERE ARRAY(SELECT a.user_id FROM public.task_assignees a
                WHERE a.band_id = t.band_id AND a.task_id = t.id ORDER BY a.user_id)
      IS DISTINCT FROM CASE WHEN t.assigned_to IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[t.assigned_to] END
  ) THEN
    RAISE EXCEPTION 'Scalar assignees and assignment rows diverge';
  END IF;
END;
$preflight$;

-- Keep the old scalar FK and member cleanup intact. Its historical value can
-- still be cleared on member/account removal, without touching the new links.
COMMENT ON COLUMN public.tasks.assigned_to IS
  'Legacy value retained for transition only. Read current assignees from public.task_assignees.';
DROP TRIGGER tasks_sync_assignees_legacy ON public.tasks;
DROP TRIGGER tasks_notify_assignment ON public.tasks;

ALTER TABLE public.tasks ADD COLUMN task_revision bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS task_assignees_user_band_task_idx
  ON public.task_assignees USING btree (user_id, band_id, task_id);

-- An existing relation with this name is reusable only if it matches the lookup index.
DO $assignee_index$
BEGIN
  IF NOT EXISTS (
    SELECT
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_am am ON am.oid = idx.relam
    WHERE idx.oid = 'public.task_assignees_user_band_task_idx'::regclass
      AND idx.relkind = 'i'
      AND i.indrelid = 'public.task_assignees'::regclass
      AND am.amname = 'btree'
      AND i.indisvalid AND i.indisready AND i.indislive AND NOT i.indisunique
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indnkeyatts = 3 AND i.indnatts = 3
      AND i.indoption::text = '0 0 0'
      AND ARRAY(
        SELECT a.attname::text
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        ORDER BY k.position
      ) = ARRAY['user_id', 'band_id', 'task_id']
      AND NOT EXISTS (
        SELECT FROM unnest(i.indclass) AS k(opclass)
        JOIN pg_opclass c ON c.oid = k.opclass
        WHERE NOT c.opcdefault
      )
  ) THEN
    RAISE EXCEPTION 'Existing public.task_assignees_user_band_task_idx does not match the required index';
  END IF;
END;
$assignee_index$;

-- API writes go through the save RPC. Keep the existing admin-only DELETE
-- policy and add a restrictive guard in case of another permissive policy.
REVOKE INSERT, UPDATE, TRUNCATE, TRIGGER, REFERENCES ON public.tasks FROM PUBLIC, anon, authenticated, service_role;
REVOKE DELETE ON public.tasks FROM PUBLIC, anon, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.task_assignees
  FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY tasks_insert_for_band_members ON public.tasks;
DROP POLICY tasks_update_for_admins_or_involved_members ON public.tasks;
CREATE POLICY tasks_v2_admin_delete_guard ON public.tasks AS RESTRICTIVE FOR DELETE TO authenticated
  USING (private.is_band_member(band_id) AND private.is_band_admin(band_id));
CREATE POLICY task_assignees_v2_read ON public.task_assignees FOR SELECT TO authenticated
  USING (private.is_band_member(band_id));
CREATE POLICY task_assignees_v2_read_guard ON public.task_assignees AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.is_band_member(band_id));
GRANT SELECT (band_id, task_id, user_id) ON public.task_assignees TO authenticated;

CREATE FUNCTION private.bump_task_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.assigned_to IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Use task assignee links';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.task_revision := OLD.task_revision + 1;
  ELSE
    NEW.task_revision := 0;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.bump_task_revision() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER tasks_bump_revision BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.bump_task_revision();

-- A NULL revision means create. A client-generated task ID makes ambiguous
-- create retries discoverable. NULL assignee list preserves existing links.
CREATE FUNCTION public.bandup_save_task_v2(
  p_band_id uuid, p_task_id uuid, p_expected_revision bigint,
  p_title text, p_description text, p_status text, p_priority text,
  p_due_date timestamptz, p_event_id uuid, p_assignee_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off SET lock_timeout = '3s'
AS $function$
DECLARE
  actor uuid := auth.uid();
  actor_role text;
  task public.tasks%ROWTYPE;
  assignees uuid[];
  recipient uuid;
BEGIN
  IF actor IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR NOT EXISTS (
    SELECT FROM public.band_members m WHERE m.band_id = p_band_id AND m.user_id = actor
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Task unavailable';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '25001', MESSAGE = 'READ COMMITTED required';
  END IF;
  IF p_task_id IS NULL OR p_expected_revision < 0 OR p_title IS NULL OR pg_catalog.btrim(p_title) = ''
     OR pg_catalog.array_position(p_assignee_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid task data';
  END IF;
  assignees := ARRAY(SELECT DISTINCT id FROM pg_catalog.unnest(p_assignee_ids) AS ids(id));

  -- The known leave and band deletion RPCs lock the band before membership.
  PERFORM 1 FROM public.bands b WHERE b.id = p_band_id FOR SHARE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Task unavailable'; END IF;
  PERFORM 1 FROM public.band_members m
    WHERE m.band_id = p_band_id AND (m.user_id = actor OR m.user_id = ANY(assignees))
    ORDER BY m.id FOR SHARE NOWAIT;
  SELECT m.role INTO actor_role FROM public.band_members m
    WHERE m.band_id = p_band_id AND m.user_id = actor FOR SHARE NOWAIT;
  IF actor_role IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Task unavailable'; END IF;

  SELECT t.* INTO task FROM public.tasks t WHERE t.band_id = p_band_id AND t.id = p_task_id FOR UPDATE NOWAIT;
  IF p_expected_revision IS NULL THEN
    IF FOUND THEN
      IF task.created_by IS DISTINCT FROM actor THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Task unavailable';
      END IF;
      RETURN pg_catalog.jsonb_build_object('id', task.id, 'revision', task.task_revision, 'status', 'already_exists');
    END IF;
  ELSE
    IF NOT FOUND OR (actor_role <> 'admin' AND task.created_by <> actor AND NOT EXISTS (
      SELECT FROM public.task_assignees a WHERE a.band_id = p_band_id AND a.task_id = p_task_id AND a.user_id = actor
    )) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Task unavailable';
    END IF;
    IF p_assignee_ids IS NOT NULL AND actor_role <> 'admin' AND task.created_by <> actor THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only the task author or a band admin may change assignees';
    END IF;
    IF task.task_revision <> p_expected_revision THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task changed; reload before saving';
    END IF;
  END IF;
  IF EXISTS (
    SELECT FROM pg_catalog.unnest(assignees) AS ids(id)
    WHERE NOT EXISTS (SELECT FROM public.band_members m WHERE m.band_id = p_band_id AND m.user_id = ids.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'An assignee no longer belongs to the band';
  END IF;

  IF p_expected_revision IS NULL THEN
    INSERT INTO public.tasks(id, band_id, created_by, title, description, status, priority, due_date, event_id)
    VALUES (p_task_id, p_band_id, actor, p_title, p_description, p_status, p_priority, p_due_date, p_event_id)
    ON CONFLICT (id) DO NOTHING RETURNING * INTO task;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Task creation conflict; reload before retrying';
    END IF;
  ELSE
    UPDATE public.tasks t SET title = p_title, description = p_description, status = p_status,
      priority = p_priority, due_date = p_due_date, event_id = p_event_id
      WHERE t.band_id = p_band_id AND t.id = p_task_id RETURNING * INTO task;
  END IF;

  IF p_assignee_ids IS NOT NULL THEN
    DELETE FROM public.task_assignees a WHERE a.band_id = p_band_id AND a.task_id = p_task_id
      AND NOT (a.user_id = ANY(assignees));
    FOR recipient IN
      INSERT INTO public.task_assignees(band_id, task_id, user_id)
      SELECT p_band_id, p_task_id, id FROM pg_catalog.unnest(assignees) AS ids(id)
      ON CONFLICT (task_id, user_id) DO NOTHING RETURNING user_id
    LOOP
      IF recipient <> actor THEN
        PERFORM private.emit_notification(recipient, p_band_id, 'task_assigned', p_task_id,
          pg_catalog.gen_random_uuid(), 'Uma tarefa foi atribuída a você.');
      END IF;
    END LOOP;
  END IF;
  RETURN pg_catalog.jsonb_build_object('id', task.id, 'revision', task.task_revision, 'status', 'saved');
END;
$function$;

REVOKE ALL ON FUNCTION public.bandup_save_task_v2(uuid,uuid,bigint,text,text,text,text,timestamptz,uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bandup_save_task_v2(uuid,uuid,bigint,text,text,text,text,timestamptz,uuid,uuid[])
  TO authenticated;

DO $privileges$
DECLARE
  target regclass;
  columns text;
BEGIN
  -- Table-level REVOKE does not remove separate column REFERENCES grants.
  FOREACH target IN ARRAY ARRAY['public.tasks'::regclass, 'public.task_assignees'::regclass]
  LOOP
    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum) INTO columns
      FROM pg_attribute WHERE attrelid = target AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE REFERENCES (%s) ON TABLE %s FROM PUBLIC, anon, authenticated, service_role',
      columns, target);
  END LOOP;

  -- Refuse cutover if role membership or other grants leave effective access.
  IF EXISTS (
    SELECT FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS roles(name)
    WHERE has_any_column_privilege(name, 'public.tasks', 'INSERT,UPDATE,REFERENCES')
       OR has_table_privilege(name, 'public.tasks', 'TRUNCATE,TRIGGER')
       OR (name <> 'authenticated' AND has_table_privilege(name, 'public.tasks', 'DELETE'))
       OR has_any_column_privilege(name, 'public.task_assignees', 'INSERT,UPDATE,REFERENCES')
       OR has_table_privilege(name, 'public.task_assignees', 'DELETE,TRUNCATE,TRIGGER')
  ) THEN
    RAISE EXCEPTION 'Unexpected effective task write or DDL privileges';
  END IF;
END;
$privileges$;

COMMIT;
