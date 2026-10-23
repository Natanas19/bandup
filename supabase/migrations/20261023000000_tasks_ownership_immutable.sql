CREATE OR REPLACE FUNCTION private.prevent_task_author_or_band_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.band_id IS DISTINCT FROM OLD.band_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Task band and creator cannot be changed',
      CONSTRAINT = 'tasks_ownership_immutable';
  END IF;

  RETURN NEW;
END;
$function$;
