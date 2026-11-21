-- Incremental candidate for a database without tasks.event_id.
-- Apply once, after reviewing the target catalog and obtaining authorization.
-- Submit as one transaction as the trusted owner of public.tasks and public.events.
-- This script does not update the Supabase migration history.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

DO $preflight$
DECLARE
  event_band_attnum smallint;
  event_id_attnum smallint;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'Column-specific ON DELETE SET NULL requires PostgreSQL 15 or later';
  END IF;

  SELECT attnum INTO event_band_attnum FROM pg_attribute
   WHERE attrelid = 'public.events'::regclass AND attname = 'band_id'
     AND atttypid = 'uuid'::regtype AND attnotnull AND NOT attisdropped;
  SELECT attnum INTO event_id_attnum FROM pg_attribute
   WHERE attrelid = 'public.events'::regclass AND attname = 'id'
     AND atttypid = 'uuid'::regtype AND attnotnull AND NOT attisdropped;
  IF event_band_attnum IS NULL OR event_id_attnum IS NULL OR NOT EXISTS (
    SELECT FROM pg_attribute WHERE attrelid = 'public.tasks'::regclass
      AND attname = 'band_id' AND atttypid = 'uuid'::regtype AND attnotnull AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Unexpected task/event identifiers; review the target contract';
  END IF;

  IF EXISTS (
    SELECT FROM pg_attribute WHERE attrelid = 'public.tasks'::regclass
      AND attname = 'event_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'tasks.event_id already exists; review the installed definition';
  END IF;

  -- A unique events.id alone cannot serve as the key for this composite FK.
  IF NOT EXISTS (
    SELECT FROM pg_index WHERE indrelid = 'public.events'::regclass
      AND indisunique AND indimmediate AND indisvalid AND indisready
      AND indpred IS NULL AND indexprs IS NULL AND indnkeyatts = 2
      AND ((indkey[0] = event_band_attnum AND indkey[1] = event_id_attnum)
        OR (indkey[0] = event_id_attnum AND indkey[1] = event_band_attnum))
  ) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_band_id_id_key UNIQUE (band_id, id);
  END IF;
END;
$preflight$;

ALTER TABLE public.tasks
  ADD COLUMN event_id uuid,
  ADD CONSTRAINT tasks_event_same_band_fkey
    FOREIGN KEY (band_id, event_id)
    REFERENCES public.events (band_id, id)
    ON DELETE SET NULL (event_id);

CREATE INDEX tasks_band_id_event_id_idx ON public.tasks (band_id, event_id);

COMMIT;
