-- Allow QR audience access for room-open gigs even when is_active/profile sync lags
DROP POLICY IF EXISTS events_select_authenticated ON public.events;
CREATE POLICY events_select_authenticated ON public.events
  FOR SELECT TO authenticated
  USING (
    is_active = true
    OR room_open = true
    OR host_id = auth.uid()
  );

DROP POLICY IF EXISTS queue_songs_select_event ON public.queue_songs;
CREATE POLICY queue_songs_select_event ON public.queue_songs
  FOR SELECT TO authenticated
  USING (
    (
      is_removed = false
      AND (
        event_id IN (
          SELECT p.active_event_id
          FROM public.profiles p
          WHERE p.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.events e
          WHERE e.id = queue_songs.event_id
            AND e.room_open = true
        )
      )
    )
    OR is_host_for_event(event_id)
  );

DROP POLICY IF EXISTS queue_songs_insert_guest ON public.queue_songs;
CREATE POLICY queue_songs_insert_guest ON public.queue_songs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = queue_songs.event_id
        AND e.room_open = true
        AND (
          e.explicit_filter_enabled = false
          OR queue_songs.is_explicit = false
        )
    )
  );

DROP POLICY IF EXISTS feed_posts_event_select ON public.feed_posts;
CREATE POLICY feed_posts_event_select ON public.feed_posts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = feed_posts.event_id
        AND (
          e.is_active = true
          OR e.room_open = true
          OR is_host_for_event(e.id)
        )
    )
  );

DROP POLICY IF EXISTS feed_posts_event_insert ON public.feed_posts;
CREATE POLICY feed_posts_event_insert ON public.feed_posts
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = feed_posts.event_id
        AND (
          e.is_active = true
          OR e.room_open = true
          OR is_host_for_event(e.id)
        )
    )
  );
-- Run this in the Supabase SQL Editor
-- Dashboard → SQL Editor → paste and run

-- Add name/venue to events table
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Untitled Gig',
  ADD COLUMN IF NOT EXISTS venue TEXT,
  ADD COLUMN IF NOT EXISTS subtitle TEXT,
  ADD COLUMN IF NOT EXISTS request_instructions TEXT,
  ADD COLUMN IF NOT EXISTS playlist_only_requests BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mirror_photo_spotlight_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_duplicate_requests BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_active_requests_per_user INTEGER;

ALTER TABLE public.events
  ALTER COLUMN host_code_hash DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'events' AND policyname = 'events_insert_host'
  ) THEN
    CREATE POLICY events_insert_host ON public.events
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = host_id);
  END IF;
END $$;

ALTER TABLE public.events
  ALTER COLUMN host_id SET DEFAULT auth.uid();

DROP POLICY IF EXISTS events_insert_host ON public.events;
CREATE POLICY events_insert_host ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND host_id = auth.uid());

-- Add host settings columns to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url TEXT,
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS paypal_url TEXT,
  ADD COLUMN IF NOT EXISTS mobilpay_url TEXT,
  ADD COLUMN IF NOT EXISTS buymeacoffee_url TEXT,
  ADD COLUMN IF NOT EXISTS kofi_url TEXT,
  ADD COLUMN IF NOT EXISTS default_gig_name TEXT,
  ADD COLUMN IF NOT EXISTS default_venue TEXT;

-- Add host_id to events and cover/library metadata to queue songs
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS host_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.queue_songs
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS library_song_id UUID REFERENCES public.library_songs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audience_sings BOOLEAN NOT NULL DEFAULT false;

-- Add playlist and song-library tables
CREATE TABLE IF NOT EXISTS public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.library_songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  cover_url TEXT,
  is_explicit BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.playlist_songs (
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES public.library_songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (playlist_id, song_id)
);

CREATE TABLE IF NOT EXISTS public.feed_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  image_data_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT feed_posts_message_or_image_check CHECK (
    btrim(message) <> '' OR image_data_url IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.event_playlists (
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, playlist_id)
);

CREATE INDEX IF NOT EXISTS playlists_user_id_created_at_idx
  ON public.playlists (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS library_songs_user_id_created_at_idx
  ON public.library_songs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS playlist_songs_playlist_id_position_idx
  ON public.playlist_songs (playlist_id, position, created_at);

CREATE INDEX IF NOT EXISTS queue_songs_event_id_active_idx
  ON public.queue_songs (event_id, created_at)
  WHERE is_removed = false;

CREATE INDEX IF NOT EXISTS feed_posts_event_id_created_at_idx
  ON public.feed_posts (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS feed_posts_user_id_created_at_idx
  ON public.feed_posts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_playlists_playlist_id_idx
  ON public.event_playlists (playlist_id);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feed_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_playlists ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlists' AND policyname = 'playlists_owner_select'
  ) THEN
    CREATE POLICY playlists_owner_select ON public.playlists FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlists' AND policyname = 'playlists_event_visible_select'
  ) THEN
    CREATE POLICY playlists_event_visible_select ON public.playlists
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.event_playlists event_playlists
          JOIN public.events events ON events.id = event_playlists.event_id
          WHERE event_playlists.playlist_id = playlists.id
            AND (events.is_active = true OR is_host_for_event(events.id))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlists' AND policyname = 'playlists_owner_insert'
  ) THEN
    CREATE POLICY playlists_owner_insert ON public.playlists FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlists' AND policyname = 'playlists_owner_update'
  ) THEN
    CREATE POLICY playlists_owner_update ON public.playlists FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlists' AND policyname = 'playlists_owner_delete'
  ) THEN
    CREATE POLICY playlists_owner_delete ON public.playlists FOR DELETE USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'library_songs' AND policyname = 'library_songs_owner_select'
  ) THEN
    CREATE POLICY library_songs_owner_select ON public.library_songs FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'library_songs' AND policyname = 'library_songs_event_visible_select'
  ) THEN
    CREATE POLICY library_songs_event_visible_select ON public.library_songs
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.playlist_songs playlist_songs
          JOIN public.event_playlists event_playlists ON event_playlists.playlist_id = playlist_songs.playlist_id
          JOIN public.events events ON events.id = event_playlists.event_id
          WHERE playlist_songs.song_id = library_songs.id
            AND (events.is_active = true OR is_host_for_event(events.id))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'library_songs' AND policyname = 'library_songs_owner_insert'
  ) THEN
    CREATE POLICY library_songs_owner_insert ON public.library_songs FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'library_songs' AND policyname = 'library_songs_owner_update'
  ) THEN
    CREATE POLICY library_songs_owner_update ON public.library_songs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'library_songs' AND policyname = 'library_songs_owner_delete'
  ) THEN
    CREATE POLICY library_songs_owner_delete ON public.library_songs FOR DELETE USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlist_songs' AND policyname = 'playlist_songs_owner_select'
  ) THEN
    CREATE POLICY playlist_songs_owner_select ON public.playlist_songs
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.playlists playlists
          WHERE playlists.id = playlist_songs.playlist_id
            AND playlists.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlist_songs' AND policyname = 'playlist_songs_event_visible_select'
  ) THEN
    CREATE POLICY playlist_songs_event_visible_select ON public.playlist_songs
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.event_playlists event_playlists
          JOIN public.events events ON events.id = event_playlists.event_id
          WHERE event_playlists.playlist_id = playlist_songs.playlist_id
            AND (events.is_active = true OR is_host_for_event(events.id))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlist_songs' AND policyname = 'playlist_songs_owner_insert'
  ) THEN
    CREATE POLICY playlist_songs_owner_insert ON public.playlist_songs
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.playlists playlists
          WHERE playlists.id = playlist_songs.playlist_id
            AND playlists.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlist_songs' AND policyname = 'playlist_songs_owner_update'
  ) THEN
    CREATE POLICY playlist_songs_owner_update ON public.playlist_songs
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM public.playlists playlists
          WHERE playlists.id = playlist_songs.playlist_id
            AND playlists.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.playlists playlists
          WHERE playlists.id = playlist_songs.playlist_id
            AND playlists.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'playlist_songs' AND policyname = 'playlist_songs_owner_delete'
  ) THEN
    CREATE POLICY playlist_songs_owner_delete ON public.playlist_songs
      FOR DELETE USING (
        EXISTS (
          SELECT 1 FROM public.playlists playlists
          WHERE playlists.id = playlist_songs.playlist_id
            AND playlists.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feed_posts' AND policyname = 'feed_posts_event_select'
  ) THEN
    CREATE POLICY feed_posts_event_select ON public.feed_posts
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.events events
          WHERE events.id = feed_posts.event_id
            AND (events.is_active = true OR is_host_for_event(events.id))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feed_posts' AND policyname = 'feed_posts_event_insert'
  ) THEN
    CREATE POLICY feed_posts_event_insert ON public.feed_posts
      FOR INSERT TO authenticated
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1
          FROM public.events events
          WHERE events.id = feed_posts.event_id
            AND (events.is_active = true OR is_host_for_event(events.id))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'feed_posts' AND policyname = 'feed_posts_owner_or_host_delete'
  ) THEN
    CREATE POLICY feed_posts_owner_or_host_delete ON public.feed_posts
      FOR DELETE TO authenticated
      USING (auth.uid() = user_id OR is_host_for_event(event_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_playlists' AND policyname = 'event_playlists_select_visible'
  ) THEN
    CREATE POLICY event_playlists_select_visible ON public.event_playlists
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.events events
          WHERE events.id = event_playlists.event_id
            AND (events.is_active = true OR is_host_for_event(events.id))
        )
      );
  END IF;

  DROP POLICY IF EXISTS event_playlists_host_insert ON public.event_playlists;
  CREATE POLICY event_playlists_host_insert ON public.event_playlists
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.events events
        WHERE events.id = event_playlists.event_id
          AND events.host_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.playlists playlists
        WHERE playlists.id = event_playlists.playlist_id
          AND playlists.user_id = auth.uid()
      )
    );

  DROP POLICY IF EXISTS event_playlists_host_delete ON public.event_playlists;
  CREATE POLICY event_playlists_host_delete ON public.event_playlists
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.events events
        WHERE events.id = event_playlists.event_id
          AND events.host_id = auth.uid()
      )
    );
END $$;

-- Allow hosts to delete gigs safely and clear host profile pointers when a gig is removed
DROP POLICY IF EXISTS events_delete_host ON public.events;
CREATE POLICY events_delete_host ON public.events
  FOR DELETE TO authenticated
  USING (host_id = auth.uid());

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_active_event_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_active_event_id_fkey
  FOREIGN KEY (active_event_id)
  REFERENCES public.events(id)
  ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_playlist_owner(target_playlist_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.playlists playlists
    WHERE playlists.id = target_playlist_id
      AND playlists.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_playlist_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_playlist_owner(UUID) TO authenticated;

DROP POLICY IF EXISTS event_playlists_host_insert ON public.event_playlists;
CREATE POLICY event_playlists_host_insert ON public.event_playlists
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events events
      WHERE events.id = event_playlists.event_id
        AND events.host_id = auth.uid()
    )
    AND public.is_playlist_owner(event_playlists.playlist_id)
  );
