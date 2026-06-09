-- Persist host-entered fallback lyrics directly on the song record.
ALTER TABLE public.library_songs
  ADD COLUMN IF NOT EXISTS manual_lyrics TEXT;
