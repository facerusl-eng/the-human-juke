# MIDI Companion Bridge Setup

This is the recommended production sync path.

Architecture:

1. One writer (Node MIDI companion) writes `public.jamzone_clock`.
2. Readers (`/lyrics`, `/lyrics-board`) subscribe to durable clock state.
3. iPad/manual broadcast remains fallback only.

## 1) Install dependencies

```bash
npm install
```

The MIDI companion uses the `midi` package and may require build tools depending on your system.

## 2) Create your config

Copy:

- `scripts/midi-companion-config.example.json`

To:

- `scripts/midi-companion-config.json`

Set:

- `eventId`
- `sourceId`
- `midiInputName` (must match `--list` output)
- `songProgramMap`
- optional CC mappings

## 3) List MIDI ports

```bash
node scripts/midi-companion-bridge.mjs --list
```

## 4) Run companion

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run midi:bridge
```

On PowerShell:

```powershell
$env:SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE"
npm run midi:bridge
```

## 5) MIDI mapping behavior

- Start (`0xFA`): play true, time reset to zero.
- Continue (`0xFB`): play true.
- Stop (`0xFC`): play false.
- Clock tick (`0xF8`): advances time via BPM and resolution.
- Program Change: selects song from `songProgramMap` and resets time.
- Optional CC controls: seek, tempo, nudge backward, nudge forward.

## Notes

- Use this on a stable machine connected to your MIDI source.
- Keep browser clients read-only for timing.
- Use iPad controls as emergency fallback, not primary sync.
