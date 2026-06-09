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
- `timeSourceMode` (`clock`, `mtc`, or `auto`)
- `statusPort` (set `0` to disable local HTTP status endpoint)
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
- MTC Quarter Frame (`0xF1`): updates absolute timeline and fps.
- Program Change: selects song from `songProgramMap` and resets time.
- Optional CC controls: seek, tempo, nudge backward, nudge forward.

## 6) Time source modes

- `clock`: use MIDI Start/Stop/Clock timing only.
- `mtc`: use MTC absolute timeline as the primary clock.
- `auto`: prefer MTC while it is active, fall back to clock when MTC is stale.

Recommended for live shows:

- If your source provides stable MTC, use `mtc`.
- If your source may drop MTC briefly, use `auto`.
- Keep `clock` for classic tempo-clock setups.

## 7) Live health monitoring

The companion now publishes health in two ways:

- Console summary every `consoleSummaryIntervalMs`
- Local HTTP JSON endpoint at `/status` when `statusPort > 0`

Example:

```powershell
Invoke-RestMethod http://127.0.0.1:3217/status | ConvertTo-Json -Depth 6
```

Useful status fields:

- `effectiveMode` (`clock` or `mtc`)
- `mtcFps`
- `currentTimeSeconds`
- `isPlaying`
- `currentSong`
- `lastWriteAgeMs`
- `lastMidiMessageAgeMs`
- `totalWriteErrors`

## Notes

- Use this on a stable machine connected to your MIDI source.
- Keep browser clients read-only for timing.
- Use iPad controls as emergency fallback, not primary sync.
