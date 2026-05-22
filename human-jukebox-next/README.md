# Human Jukebox Next

Isolated next-generation frontend project. This app does not modify or run inside the existing `the-human-juke-main` app.

## Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Data Provider Modes

The app uses a pluggable data adapter architecture.

- `mock` (default): local mock data
- `supabase`: live data from Supabase tables

Configuration is done through Vite env vars.

1. Copy `.env.example` to `.env`
2. Choose provider mode via `VITE_APP_DATA_PROVIDER`

Example mock mode:

```env
VITE_APP_DATA_PROVIDER=mock
```

Example Supabase mode:

```env
VITE_APP_DATA_PROVIDER=supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Optional table name overrides:

```env
VITE_SUPABASE_LIBRARY_SONGS_TABLE=library_songs
VITE_SUPABASE_PLAYLISTS_TABLE=playlists
VITE_SUPABASE_PLAYLIST_SONGS_TABLE=playlist_songs
VITE_SUPABASE_EVENTS_TABLE=events
VITE_SUPABASE_PLAYBACK_STATE_TABLE=playback_state
```

## Expected Supabase Tables

When using `supabase` mode, the adapter expects:

### library_songs
- `id` text/uuid
- `title` text
- `artist` text
- `is_explicit` boolean
- `created_at` timestamp

### playlists
- `id` text/uuid
- `name` text
- `description` text
- `playlist_type` text

### playlist_songs
- `playlist_id` uuid
- `song_id` uuid

### events
- `id` uuid
- `is_active` boolean
- `room_open` boolean
- `gig_date` date
- `gig_start_time` time

### playback_state
- `event_id` uuid
- `brb_active` boolean
- `countdown_target_ms` bigint

Note: The adapter maps these schema fields into the app's internal model and applies safe defaults for any missing optional values.
