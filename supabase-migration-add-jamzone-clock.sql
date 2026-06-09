-- Durable event-scoped Jamzone clock state.
-- One writer (Jamzone companion bridge), many readers (lyrics pages/board).

CREATE TABLE IF NOT EXISTS public.jamzone_clock (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  source_id text NOT NULL,
  source_type text NOT NULL DEFAULT 'companion',
  current_song_id text,
  current_song_title text,
  current_song_artist text,
  current_time_seconds double precision NOT NULL DEFAULT 0,
  is_playing boolean NOT NULL DEFAULT false,
  sequence_number bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.jamzone_clock
  ADD CONSTRAINT jamzone_clock_source_type_check
  CHECK (source_type IN ('bridge', 'manual', 'companion'));

CREATE INDEX IF NOT EXISTS jamzone_clock_updated_at_idx ON public.jamzone_clock(updated_at DESC);

ALTER TABLE public.jamzone_clock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jamzone_clock_select_policy ON public.jamzone_clock;
CREATE POLICY jamzone_clock_select_policy ON public.jamzone_clock
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = jamzone_clock.event_id
        AND (
          e.is_active = true
          OR e.room_open = true
          OR e.show_in_audience_no_gig = true
          OR e.host_id = auth.uid()
          OR is_host_for_event(jamzone_clock.event_id)
        )
    )
  );

DROP POLICY IF EXISTS jamzone_clock_insert_policy ON public.jamzone_clock;
CREATE POLICY jamzone_clock_insert_policy ON public.jamzone_clock
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = jamzone_clock.event_id
        AND (
          e.host_id = auth.uid()
          OR is_host_for_event(jamzone_clock.event_id)
        )
    )
  );

DROP POLICY IF EXISTS jamzone_clock_update_policy ON public.jamzone_clock;
CREATE POLICY jamzone_clock_update_policy ON public.jamzone_clock
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = jamzone_clock.event_id
        AND (
          e.host_id = auth.uid()
          OR is_host_for_event(jamzone_clock.event_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = jamzone_clock.event_id
        AND (
          e.host_id = auth.uid()
          OR is_host_for_event(jamzone_clock.event_id)
        )
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.jamzone_clock;
