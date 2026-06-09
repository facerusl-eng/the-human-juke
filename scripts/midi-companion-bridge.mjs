import { readFileSync } from 'node:fs'
import process from 'node:process'
import midi from 'midi'
import { createClient } from '@supabase/supabase-js'

const TABLE_NAME = 'jamzone_clock'

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback
  }

  return process.argv[index + 1]
}

function hasArg(name) {
  return process.argv.includes(name)
}

function readConfig() {
  const configPath = readArg('--config', 'scripts/midi-companion-config.json')
  const raw = readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  return { configPath, parsed }
}

function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }

  return value.trim()
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function sanitizeSong(song) {
  if (!song || typeof song !== 'object') {
    return null
  }

  const title = typeof song.title === 'string' ? song.title.trim() : ''
  const artist = typeof song.artist === 'string' ? song.artist.trim() : ''
  if (!title || !artist) {
    return null
  }

  const id = typeof song.id === 'string' && song.id.trim().length > 0
    ? song.id.trim()
    : `midi:${artist.toLowerCase().replace(/\s+/g, '-')}:${title.toLowerCase().replace(/\s+/g, '-')}`

  return { id, title, artist }
}

function listMidiPorts() {
  const input = new midi.Input()
  const ports = []
  const count = input.getPortCount()

  for (let index = 0; index < count; index += 1) {
    ports.push(input.getPortName(index))
  }

  return ports
}

function parseTimeSourceMode(value) {
  if (value === 'clock' || value === 'mtc' || value === 'auto') {
    return value
  }

  return 'auto'
}

function getMtcFps(rateBits) {
  if (rateBits === 0) {
    return 24
  }

  if (rateBits === 1) {
    return 25
  }

  if (rateBits === 2) {
    return 29.97
  }

  return 30
}

async function main() {
  if (hasArg('--list')) {
    const ports = listMidiPorts()
    if (!ports.length) {
      console.log('No MIDI input ports detected.')
      return
    }

    console.log('Available MIDI input ports:')
    for (const [index, name] of ports.entries()) {
      console.log(`${index}: ${name}`)
    }
    return
  }

  const { configPath, parsed: config } = readConfig()
  const eventId = assertNonEmpty(config.eventId, 'config.eventId')
  const sourceId = assertNonEmpty(config.sourceId ?? 'midi-companion', 'config.sourceId')
  const sourceType = config.sourceType === 'bridge' || config.sourceType === 'manual' ? config.sourceType : 'companion'

  const supabaseUrl = assertNonEmpty(process.env.SUPABASE_URL ?? '', 'SUPABASE_URL')
  const supabaseKey = assertNonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '', 'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)')
  const supabase = createClient(supabaseUrl, supabaseKey)

  const songProgramMap = config.songProgramMap && typeof config.songProgramMap === 'object'
    ? config.songProgramMap
    : {}

  const controls = config.controls && typeof config.controls === 'object' ? config.controls : {}
  const timeSourceMode = parseTimeSourceMode(config.timeSourceMode)
  const mtcTimeoutMs = Number.isFinite(Number(config.mtcTimeoutMs)) ? Number(config.mtcTimeoutMs) : 1400
  const mtcTreatAsPlaying = config.mtcTreatAsPlaying !== false
  const defaultBpm = Number.isFinite(Number(config.defaultBpm)) ? Number(config.defaultBpm) : 120
  const tickResolution = Number.isFinite(Number(config.tickResolution)) ? Number(config.tickResolution) : 24
  const heartbeatMs = Number.isFinite(Number(config.heartbeatMs)) ? Number(config.heartbeatMs) : 1200
  const minWriteIntervalMs = Number.isFinite(Number(config.minWriteIntervalMs)) ? Number(config.minWriteIntervalMs) : 120

  let bpm = defaultBpm
  let isPlaying = false
  let currentTimeSeconds = 0
  let currentSong = null
  let sequenceNumber = 0
  let lastTickAt = Date.now()
  let lastWriteAt = 0
  let lastWriteSignature = ''

  const mtcNibbles = new Array(8).fill(null)
  let lastMtcAt = 0
  let mtcFps = 30

  const shouldUseMtcClock = () => {
    if (timeSourceMode === 'mtc') {
      return true
    }

    if (timeSourceMode === 'clock') {
      return false
    }

    return (Date.now() - lastMtcAt) <= mtcTimeoutMs
  }

  const writeState = async (force = false) => {
    const now = Date.now()
    if (!force && now - lastWriteAt < minWriteIntervalMs) {
      return
    }

    const signature = JSON.stringify({
      isPlaying,
      currentTimeSeconds: Number(currentTimeSeconds.toFixed(3)),
      songId: currentSong?.id ?? null,
      bpm: Number(bpm.toFixed(3)),
      mtcFps,
      timeSourceMode,
      useMtc: shouldUseMtcClock(),
    })

    if (!force && signature === lastWriteSignature) {
      return
    }

    sequenceNumber += 1

    const payload = {
      event_id: eventId,
      source_id: sourceId,
      source_type: sourceType,
      current_song_id: currentSong?.id ?? null,
      current_song_title: currentSong?.title ?? null,
      current_song_artist: currentSong?.artist ?? null,
      current_time_seconds: Number(currentTimeSeconds.toFixed(3)),
      is_playing: isPlaying,
      sequence_number: sequenceNumber,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from(TABLE_NAME)
      .upsert(payload, { onConflict: 'event_id' })

    if (error) {
      console.error(`[midi-companion] write failed: ${error.message}`)
      return
    }

    lastWriteAt = now
    lastWriteSignature = signature
  }

  const input = new midi.Input()
  const availablePorts = listMidiPorts()
  const selectedPortName = typeof config.midiInputName === 'string' ? config.midiInputName.trim() : ''

  if (!selectedPortName) {
    throw new Error(`config.midiInputName is required in ${configPath}`)
  }

  const selectedPortIndex = availablePorts.findIndex((name) => name.toLowerCase() === selectedPortName.toLowerCase())
  if (selectedPortIndex < 0) {
    throw new Error(`MIDI input '${selectedPortName}' not found. Use --list to inspect ports.`)
  }

  input.openPort(selectedPortIndex)
  input.ignoreTypes(false, false, false)

  console.log(`[midi-companion] listening on '${availablePorts[selectedPortIndex]}'`)
  console.log(`[midi-companion] writing to event ${eventId} (${sourceId})`)
  console.log(`[midi-companion] time source mode: ${timeSourceMode}`)

  const seekCc = Number(controls.seekCc)
  const seekMaxSeconds = Number.isFinite(Number(controls.seekMaxSeconds)) ? Number(controls.seekMaxSeconds) : 720
  const tempoCc = Number(controls.tempoCc)
  const tempoMinBpm = Number.isFinite(Number(controls.tempoMinBpm)) ? Number(controls.tempoMinBpm) : 70
  const tempoMaxBpm = Number.isFinite(Number(controls.tempoMaxBpm)) ? Number(controls.tempoMaxBpm) : 190
  const nudgeBackCc = Number(controls.nudgeBackCc)
  const nudgeForwardCc = Number(controls.nudgeForwardCc)
  const nudgeSeconds = Number.isFinite(Number(controls.nudgeSeconds)) ? Number(controls.nudgeSeconds) : 1

  input.on('message', (_deltaTime, message) => {
    const status = message[0] ?? 0
    const data1 = message[1] ?? 0
    const data2 = message[2] ?? 0
    const command = status & 0xf0

    const now = Date.now()

    // MTC quarter frame: use absolute timeline when in mtc mode or auto with active MTC.
    if (status === 0xf1) {
      const type = (data1 >> 4) & 0x07
      const value = data1 & 0x0f
      mtcNibbles[type] = value
      lastMtcAt = now

      if (type === 7) {
        const rateBits = (value >> 1) & 0x03
        mtcFps = getMtcFps(rateBits)

        const frames = ((mtcNibbles[1] ?? 0) << 4) | (mtcNibbles[0] ?? 0)
        const seconds = ((mtcNibbles[3] ?? 0) << 4) | (mtcNibbles[2] ?? 0)
        const minutes = ((mtcNibbles[5] ?? 0) << 4) | (mtcNibbles[4] ?? 0)
        const hours = ((value & 0x01) << 4) | (mtcNibbles[6] ?? 0)

        currentTimeSeconds = Math.max(0, (hours * 3600) + (minutes * 60) + seconds + (frames / mtcFps))
        lastTickAt = now

        if (mtcTreatAsPlaying && (timeSourceMode === 'mtc' || timeSourceMode === 'auto')) {
          isPlaying = true
        }

        if (shouldUseMtcClock()) {
          void writeState(false)
        }
      }
      return
    }

    // MIDI realtime clock tick.
    if (status === 0xf8 && isPlaying && !shouldUseMtcClock()) {
      const secondsPerTick = 60 / (bpm * tickResolution)
      currentTimeSeconds = Math.max(0, currentTimeSeconds + secondsPerTick)
      lastTickAt = now
      void writeState(false)
      return
    }

    // MIDI start.
    if (status === 0xfa) {
      isPlaying = true
      currentTimeSeconds = 0
      lastTickAt = now
      void writeState(true)
      return
    }

    // MIDI continue.
    if (status === 0xfb) {
      isPlaying = true
      lastTickAt = now
      void writeState(true)
      return
    }

    // MIDI stop.
    if (status === 0xfc) {
      isPlaying = false
      void writeState(true)
      return
    }

    // Program Change: select song mapping.
    if (command === 0xc0) {
      const mappedSong = sanitizeSong(songProgramMap[String(data1)])
      if (mappedSong) {
        currentSong = mappedSong
        if (config.resetTimeOnProgramChange !== false) {
          currentTimeSeconds = 0
        }
        void writeState(true)
      }
      return
    }

    // Control Change mappings for seek/tempo/nudge.
    if (command === 0xb0) {
      if (Number.isFinite(seekCc) && data1 === seekCc) {
        const normalized = clamp(data2 / 127, 0, 1)
        currentTimeSeconds = Number((normalized * seekMaxSeconds).toFixed(3))
        lastTickAt = now
        void writeState(true)
        return
      }

      if (Number.isFinite(tempoCc) && data1 === tempoCc) {
        const normalized = clamp(data2 / 127, 0, 1)
        bpm = Number((tempoMinBpm + ((tempoMaxBpm - tempoMinBpm) * normalized)).toFixed(3))
        void writeState(true)
        return
      }

      if (Number.isFinite(nudgeBackCc) && data1 === nudgeBackCc && data2 > 0) {
        currentTimeSeconds = Math.max(0, currentTimeSeconds - nudgeSeconds)
        lastTickAt = now
        void writeState(true)
        return
      }

      if (Number.isFinite(nudgeForwardCc) && data1 === nudgeForwardCc && data2 > 0) {
        currentTimeSeconds = Math.max(0, currentTimeSeconds + nudgeSeconds)
        lastTickAt = now
        void writeState(true)
      }
    }
  })

  const heartbeatTimer = setInterval(() => {
    // Backfill clock when MIDI realtime ticks are sparse and no fresh MTC is present.
    if (isPlaying && !shouldUseMtcClock()) {
      const now = Date.now()
      const elapsed = Math.max(0, (now - lastTickAt) / 1000)
      if (elapsed > 0 && elapsed < 2.5) {
        currentTimeSeconds = Math.max(0, currentTimeSeconds + elapsed)
      }
      lastTickAt = now
    }

    void writeState(true)
  }, heartbeatMs)

  const cleanup = () => {
    clearInterval(heartbeatTimer)
    try {
      input.closePort()
    } catch {
      // no-op
    }
  }

  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error(`[midi-companion] fatal: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
