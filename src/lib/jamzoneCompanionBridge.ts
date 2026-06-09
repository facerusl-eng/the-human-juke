import { writeJamzoneClockState, type JamzoneClockSong, type JamzoneClockSourceType } from './jamzoneClock'

export type JamzoneSourceReading = {
  currentTimeSeconds: number
  currentSong: JamzoneClockSong | null
  isPlaying: boolean
}

export type JamzoneSourceAdapter = {
  getReading: () => Promise<JamzoneSourceReading> | JamzoneSourceReading
}

export type JamzoneCompanionBridgeOptions = {
  eventId: string
  sourceId: string
  sourceType?: JamzoneClockSourceType
  pollIntervalMs?: number
  staleWriteIntervalMs?: number
}

export class JamzoneCompanionBridge {
  private readonly adapter: JamzoneSourceAdapter

  private readonly options: Required<JamzoneCompanionBridgeOptions>

  private timerId: number | null = null

  private sequenceNumber = 0

  private lastWriteAtMs = 0

  private lastSongId: string | null = null

  private lastTimeSeconds = -1

  constructor(adapter: JamzoneSourceAdapter, options: JamzoneCompanionBridgeOptions) {
    this.adapter = adapter
    this.options = {
      sourceType: options.sourceType ?? 'companion',
      pollIntervalMs: options.pollIntervalMs ?? 250,
      staleWriteIntervalMs: options.staleWriteIntervalMs ?? 1500,
      eventId: options.eventId,
      sourceId: options.sourceId,
    }
  }

  start() {
    if (this.timerId !== null) {
      return
    }

    void this.tick()
    this.timerId = window.setInterval(() => {
      void this.tick()
    }, this.options.pollIntervalMs)
  }

  stop() {
    if (this.timerId === null) {
      return
    }

    window.clearInterval(this.timerId)
    this.timerId = null
  }

  private async tick() {
    const reading = await this.adapter.getReading()
    const currentTimeSeconds = Number.isFinite(reading.currentTimeSeconds)
      ? Math.max(0, Number(reading.currentTimeSeconds))
      : 0

    const currentSongId = reading.currentSong?.id ?? null
    const nowMs = Date.now()
    const hasSongChanged = currentSongId !== this.lastSongId
    const timeDelta = Math.abs(currentTimeSeconds - this.lastTimeSeconds)
    const hasTimeProgressed = timeDelta >= 0.15
    const isStale = nowMs - this.lastWriteAtMs >= this.options.staleWriteIntervalMs

    if (!hasSongChanged && !hasTimeProgressed && !isStale) {
      return
    }

    const writeSucceeded = await writeJamzoneClockState(this.options.eventId, {
      sourceId: this.options.sourceId,
      sourceType: this.options.sourceType,
      currentSongId,
      currentSongTitle: reading.currentSong?.title ?? null,
      currentSongArtist: reading.currentSong?.artist ?? null,
      currentTimeSeconds,
      isPlaying: Boolean(reading.isPlaying),
      sequenceNumber: ++this.sequenceNumber,
    })

    if (!writeSucceeded) {
      return
    }

    this.lastSongId = currentSongId
    this.lastTimeSeconds = currentTimeSeconds
    this.lastWriteAtMs = nowMs
  }
}
