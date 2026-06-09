# MIDI Lyric Section Listener

This backend module listens for MIDI Note On messages and maps them to lyric section controls.

## Note Mapping

- MIDI note 60: next section
- MIDI note 61: previous section
- MIDI note 62: play/pause

## API

- `registerLyricSections(sections)` registers ordered lyric sections.
- `setLyricSectionActions(actions)` registers the backend functions that actually move sections or toggle play/pause.
- `createMidiLyricSectionListener(options)` starts the continuous MIDI input listener.

## Server Startup

The server entrypoint can start this listener automatically when one of these is set:

- `MIDI_LYRIC_SECTION_LISTENER=1`
- `MIDI_LYRIC_SECTION_INPUT_NAME=...`
- `MIDI_LYRIC_SECTION_INPUT_PORT_INDEX=...`

You can also preload sections on boot with `MIDI_LYRIC_SECTIONS_JSON` containing a JSON array of section objects.

If you also set these Supabase-backed persistence variables, the current section snapshot will be restored and saved across restarts:

- `MIDI_LYRIC_SECTION_EVENT_ID=...`
- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`

## Example

```js
import {
  registerLyricSections,
  setLyricSectionActions,
  createMidiLyricSectionListener,
} from '../server/midiLyricSectionListener.mjs'

registerLyricSections([
  { id: 'verse-1', label: 'Verse 1', startTimeSeconds: 12 },
  { id: 'chorus-1', label: 'Chorus', startTimeSeconds: 48 },
])

setLyricSectionActions({
  nextSection: ({ nextSection }) => {
    if (nextSection) {
      console.log('Jump to:', nextSection.label)
    }
  },
  previousSection: ({ previousSection }) => {
    if (previousSection) {
      console.log('Jump to:', previousSection.label)
    }
  },
  togglePlayPause: ({ isPlaying }) => {
    console.log(isPlaying ? 'Play' : 'Pause')
  },
})

const listener = await createMidiLyricSectionListener({
  inputName: 'Your MIDI Device Name',
})

await listener.start()
```

## Notes

- The listener processes MIDI messages sequentially so rapid bursts stay in order.
- It uses the optional `midi` package, so the backend host must have dependencies installed.
- The server persists the navigator snapshot to `public.midi_lyric_section_state` when Supabase persistence is configured.
- This is backend-only code and does not add any UI.
