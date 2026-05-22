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
VITE_SUPABASE_SONGS_TABLE=songs
VITE_SUPABASE_SET_BLOCKS_TABLE=set_blocks
VITE_SUPABASE_LIVE_CONSOLE_TABLE=live_console_snapshots
```

## Expected Supabase Tables

When using `supabase` mode, the adapter expects:

### songs
- `id` text/uuid
- `title` text
- `artist` text
- `length` text
- `energy` text (`Low`, `Medium`, `High`)
- `tags` text[]

### set_blocks
- `id` text/uuid
- `name` text
- `songs` int
- `vibe` text
- `duration` text

### live_console_snapshots
- `state` text (`pre_show`, `live`, `break`)
- `next_transition_in` text
- `sync_latency_ms` int
- `created_at` timestamp (used for latest snapshot ordering)
