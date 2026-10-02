ALTER TABLE public.events
  DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_not_empty_check
    CHECK (length(btrim(event_type)) > 0);
