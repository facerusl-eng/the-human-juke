# Jamzone Companion Bridge

This project includes a stable clock model for Jamzone-driven lyrics:

- one writer: Jamzone companion process
- many readers: app lyrics page and board
- durable state: `public.jamzone_clock`

## Runtime Contract

Use `HumanJukeboxJamzoneApi` and/or a companion adapter to feed:

- current song id/title/artist
- current playback time (seconds)
- is playing flag

## Core Modules

- `src/lib/jamzoneClock.ts`
- `src/lib/jamzoneCompanionBridge.ts`

## Example

```ts
import { JamzoneCompanionBridge } from '../src/lib/jamzoneCompanionBridge'

const bridge = new JamzoneCompanionBridge(
  {
    getReading: async () => {
      // Replace with real Jamzone host integration.
      return {
        currentTimeSeconds: window.MyJamzoneHost.currentTime,
        isPlaying: window.MyJamzoneHost.isPlaying,
        currentSong: window.MyJamzoneHost.currentSong,
      }
    },
  },
  {
    eventId: 'YOUR_EVENT_ID',
    sourceId: 'jamzone-companion-host-1',
    sourceType: 'companion',
  },
)

bridge.start()
```

## Database

Run migration:

- `supabase-migration-add-jamzone-clock.sql`

This creates `public.jamzone_clock`, RLS policies, and Realtime publication.
