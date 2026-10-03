ALTER TABLE public.events
  ADD CONSTRAINT events_band_id_id_key UNIQUE (band_id, id);

ALTER TABLE public.tasks
  ADD COLUMN event_id UUID,
  ADD CONSTRAINT tasks_event_same_band_fkey
    FOREIGN KEY (band_id, event_id)
    REFERENCES public.events (band_id, id)
    ON DELETE SET NULL (event_id);

CREATE INDEX tasks_band_id_event_id_idx
  ON public.tasks (band_id, event_id);
