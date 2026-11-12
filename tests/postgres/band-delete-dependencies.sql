-- Test bootstrap extension, based on the DDL and exact definitions supplied by user.
-- Execute only AFTER the local base schema, in a freshly created private cluster.
ALTER TABLE public.tasks ADD CONSTRAINT tasks_band_id_id_key UNIQUE (band_id,id);
CREATE TABLE public.task_assignees (
 task_id uuid NOT NULL, user_id uuid NOT NULL, band_id uuid NOT NULL,
 PRIMARY KEY(task_id,user_id),
 CONSTRAINT task_assignees_member_same_band_fkey FOREIGN KEY(band_id,user_id)
 REFERENCES public.band_members(band_id,user_id) ON DELETE CASCADE,
 CONSTRAINT task_assignees_task_same_band_fkey FOREIGN KEY(band_id,task_id)
 REFERENCES public.tasks(band_id,id) ON DELETE CASCADE
);
CREATE TABLE public.band_join_directory (
 band_id uuid NOT NULL PRIMARY KEY REFERENCES public.bands(id) ON DELETE CASCADE,
 display_name text NOT NULL CHECK(char_length(btrim(display_name)) BETWEEN 1 AND 100),
 summary text NOT NULL DEFAULT '' CHECK(char_length(summary)<=500),
 accepting_requests boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.band_join_requests (
 id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
 band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
 requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 applicant_name text NOT NULL CHECK(char_length(btrim(applicant_name)) BETWEEN 1 AND 80),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
 requested_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz, decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 cancelled_at timestamptz,
 CONSTRAINT band_join_requests_check
 CHECK (
  status = 'pending'::text
  AND decided_at IS NULL
  AND decided_by IS NULL
  AND cancelled_at IS NULL
  OR (
    status = ANY (ARRAY['approved'::text, 'rejected'::text])
    AND decided_at IS NOT NULL
    AND cancelled_at IS NULL
  )
  OR (
    status = 'cancelled'::text
    AND decided_at IS NULL
    AND decided_by IS NULL
    AND cancelled_at IS NOT NULL
  )
 )
);
CREATE OR REPLACE FUNCTION private.sync_task_assignees_legacy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
BEGIN
  IF TG_RELID <> 'public.tasks'::pg_catalog.regclass OR TG_WHEN <> 'AFTER'
    OR TG_LEVEL <> 'ROW' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invalid legacy assignment bridge context';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Legacy forms send assigned_to even for a title/status-only edit.
    IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to
      AND NEW.band_id IS NOT DISTINCT FROM OLD.band_id THEN RETURN NEW; END IF;
    -- Defensive guard: never erase multiple assignments through a scalar client.
    -- Activation must replace this bridge and cover member removal atomically.
    IF (SELECT pg_catalog.count(*) FROM public.task_assignees AS assignment
      WHERE assignment.task_id = OLD.id) > 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Multiple assignees require the reviewed activation flow';
    END IF;
  END IF;
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.band_members AS member
    WHERE member.band_id = NEW.band_id AND member.user_id = NEW.assigned_to
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Assignee must belong to the task band';
  END IF;
  -- Original task UPDATE holds its row lock; all bridge writes share its txn.
  DELETE FROM public.task_assignees AS assignment WHERE assignment.task_id = NEW.id;
  IF NEW.assigned_to IS NOT NULL THEN
    INSERT INTO public.task_assignees (task_id, user_id, band_id)
    VALUES (NEW.id, NEW.assigned_to, NEW.band_id);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER tasks_sync_assignees_legacy
AFTER INSERT OR UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION private.sync_task_assignees_legacy();
-- These tables' production ACL/RLS were not supplied. Keep them inaccessible to
-- API roles; only trusted test snapshot/assertion functions inspect them.
REVOKE ALL ON public.task_assignees, public.band_join_directory, public.band_join_requests
FROM PUBLIC, anon, authenticated, service_role;
