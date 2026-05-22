import { useEffect, useMemo, useRef, useState } from 'react'

const STUDIO_PROJECT_KEY = 'hj-next-song-studio-project-v1'

type StudioTrack = {
  id: string
  name: string
  file: File
  objectUrl: string
  cacheKey: string
  role: 'song' | 'stem'
  channel: number | null
  durationSec: number
  volume: number
  pan: number
  muted: boolean
  solo: boolean
}

type WordSync = {
  id: string
  text: string
  startSec: number
  endSec: number
}

type ChordSync = {
  id: string
  symbol: string
  timeSec: number
}

type LyricLine = {
  id: string
  startSec: number
  endSec: number
  words: WordSync[]
  chords: ChordSync[]
}

type GeneratedChart = {
  lines: LyricLine[]
  statusMessage: string
}

type NodeBundle = {
  trackId: string
  source: AudioBufferSourceNode
  gain: GainNode
  panner: StereoPannerNode
}

type PersistedTrack = {
  id: string
  name: string
  role: 'song' | 'stem'
  channel: number | null
  durationSec: number
  volume: number
  pan: number
  muted: boolean
  solo: boolean
}

type PersistedProject = {
  chartLines: LyricLine[]
  transposeSemitones: number
  capo: number
  syncOffsetSec: number
  masterVolume: number
  masterRoutePreset: OutputRoutePresetId
  limiterEnabled: boolean
  limiterPreset: LimiterPresetId
  limiterCeilingDb: number
  loopSectionId: string | null
  midiMappings: MidiMappings
  tracks: PersistedTrack[]
}

type MidiMappings = {
  playPause: number
  stop: number
  prevSection: number
  nextSection: number
}

type CachedTrackMeta = {
  key: string
  name: string
  type: string
  size: number
  lastModified: number
  cachedAt: number
}

type RecordingClip = {
  id: string
  name: string
  createdAt: number
  objectUrl: string
}

type TempoEstimate = {
  bpm: number
  confidence: number
}

type LimiterPresetId = 'transparent' | 'liveSafe' | 'hardClamp'

type LimiterPreset = {
  label: string
  threshold: number
  knee: number
  ratio: number
  attack: number
  release: number
}

type OutputRoutePresetId = 'frontPA' | 'monitorMono' | 'streamFeed'

type OutputRoutePreset = {
  label: string
  trimDb: number
  forceMono: boolean
}

type MonitorSection = {
  id: string
  label: string
  startSec: number
  endSec: number
}

const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
}

const LIMITER_PRESETS: Record<LimiterPresetId, LimiterPreset> = {
  transparent: {
    label: 'Transparent guard',
    threshold: -2,
    knee: 1,
    ratio: 12,
    attack: 0.003,
    release: 0.09,
  },
  liveSafe: {
    label: 'Live safe',
    threshold: -6,
    knee: 3,
    ratio: 20,
    attack: 0.002,
    release: 0.12,
  },
  hardClamp: {
    label: 'Hard clamp',
    threshold: -10,
    knee: 0,
    ratio: 30,
    attack: 0.001,
    release: 0.18,
  },
}

const OUTPUT_ROUTE_PRESETS: Record<OutputRoutePresetId, OutputRoutePreset> = {
  frontPA: {
    label: 'Front PA (stereo)',
    trimDb: 0,
    forceMono: false,
  },
  monitorMono: {
    label: 'Stage monitor (mono)',
    trimDb: -3,
    forceMono: true,
  },
  streamFeed: {
    label: 'Broadcast/stream feed',
    trimDb: -6,
    forceMono: false,
  },
}

const AUDIO_CACHE_DB = 'hj_next_audio_cache_v1'
const AUDIO_CACHE_STORE = 'audio_files'
const MAX_STEM_CHANNELS = 10
const DEFAULT_MIDI_MAPPINGS: MidiMappings = {
  playPause: 60,
  stop: 61,
  prevSection: 62,
  nextSection: 63,
}

function dbToGain(db: number) {
  return Math.pow(10, db / 20)
}

async function openAudioCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(AUDIO_CACHE_DB, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(AUDIO_CACHE_STORE)) {
        db.createObjectStore(AUDIO_CACHE_STORE, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open cache database'))
  })
}

function fileToCacheKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function nextAvailableStemChannel(tracks: StudioTrack[]) {
  const used = new Set(tracks.filter((track) => track.role === 'stem' && track.channel !== null).map((track) => track.channel))
  for (let channel = 1; channel <= MAX_STEM_CHANNELS; channel += 1) {
    if (!used.has(channel)) {
      return channel
    }
  }

  return null
}

function estimateTempoFromBuffer(buffer: AudioBuffer): TempoEstimate | null {
  const channelData = buffer.getChannelData(0)
  if (!channelData || channelData.length < 2048) {
    return null
  }

  const sampleRate = buffer.sampleRate
  const targetSeconds = Math.min(120, buffer.duration)
  const targetLength = Math.max(1, Math.floor(targetSeconds * sampleRate))
  const slice = channelData.subarray(0, Math.min(channelData.length, targetLength))

  const windowSize = 1024
  const hopSize = 512
  const envelope: number[] = []

  for (let index = 0; index + windowSize < slice.length; index += hopSize) {
    let sum = 0
    for (let j = 0; j < windowSize; j += 1) {
      const value = slice[index + j]
      sum += value * value
    }
    envelope.push(Math.sqrt(sum / windowSize))
  }

  if (envelope.length < 64) {
    return null
  }

  const mean = envelope.reduce((acc, value) => acc + value, 0) / envelope.length
  const centered = envelope.map((value) => value - mean)
  const energy = centered.reduce((acc, value) => acc + value * value, 0)
  if (energy <= 0.00001) {
    return null
  }

  const envRate = sampleRate / hopSize
  const minBpm = 60
  const maxBpm = 200
  const minLag = Math.floor((60 * envRate) / maxBpm)
  const maxLag = Math.floor((60 * envRate) / minBpm)

  let bestLag = 0
  let bestCorr = -Infinity

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0
    for (let i = 0; i + lag < centered.length; i += 1) {
      corr += centered[i] * centered[i + lag]
    }

    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }

  if (bestLag <= 0) {
    return null
  }

  let bpm = (60 * envRate) / bestLag
  while (bpm < 75) {
    bpm *= 2
  }
  while (bpm > 180) {
    bpm /= 2
  }

  const confidence = Math.max(0, Math.min(1, bestCorr / energy))

  return {
    bpm: Math.round(bpm),
    confidence,
  }
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`
}

function buildMonitorSections(chartLines: LyricLine[], durationSec: number): MonitorSection[] {
  const sectionNames = ['Intro', 'Verse', 'Pre', 'Chorus', 'Bridge', 'Solo', 'Outro']

  if (chartLines.length > 0) {
    const chunkSize = Math.max(1, Math.floor(chartLines.length / 6) || 1)
    const sections: MonitorSection[] = []

    for (let index = 0; index < chartLines.length; index += chunkSize) {
      const startLine = chartLines[index]
      const endLine = chartLines[Math.min(chartLines.length - 1, index + chunkSize - 1)]
      sections.push({
        id: `section_${index}`,
        label: sectionNames[sections.length % sectionNames.length],
        startSec: startLine.startSec,
        endSec: Math.max(startLine.startSec + 1, endLine.endSec),
      })
    }

    return sections
  }

  const safeDuration = Math.max(30, Math.floor(durationSec) || 120)
  const sectionCount = 6
  const sectionLength = safeDuration / sectionCount

  return Array.from({ length: sectionCount }, (_, index) => ({
    id: `section_fallback_${index}`,
    label: sectionNames[index % sectionNames.length],
    startSec: Number((index * sectionLength).toFixed(2)),
    endSec: Number(((index + 1) * sectionLength).toFixed(2)),
  }))
}

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeNote(note: string) {
  if (note in FLAT_TO_SHARP) {
    return FLAT_TO_SHARP[note]
  }

  return note
}

function transposeChord(symbol: string, semitones: number) {
  const trimmed = symbol.trim()
  if (!trimmed) {
    return symbol
  }

  const match = trimmed.match(/^([A-G](?:#|b)?)(.*)$/)
  if (!match) {
    return symbol
  }

  const [, root, suffix] = match
  const normalizedRoot = normalizeNote(root)
  const index = SHARP_NOTES.indexOf(normalizedRoot)

  if (index === -1) {
    return symbol
  }

  const shifted = (index + semitones + SHARP_NOTES.length * 4) % SHARP_NOTES.length
  return `${SHARP_NOTES[shifted]}${suffix}`
}

function buildFallbackChart(durationSec: number): GeneratedChart {
  const safeDuration = Math.max(40, Math.floor(durationSec) || 120)
  const lineLength = 8
  const lineCount = Math.max(4, Math.ceil(safeDuration / lineLength))

  const lines: LyricLine[] = Array.from({ length: lineCount }, (_, lineIndex) => {
    const startSec = lineIndex * lineLength
    const endSec = startSec + lineLength
    const rawWords = ['This', 'is', 'an', 'auto', 'generated', 'lyric', 'line', `${lineIndex + 1}`]
    const words = rawWords.map((word, wordIndex) => {
      const wordStart = startSec + (wordIndex / rawWords.length) * lineLength
      const nextStart = startSec + ((wordIndex + 1) / rawWords.length) * lineLength

      return {
        id: createId('word'),
        text: word,
        startSec: Number(wordStart.toFixed(2)),
        endSec: Number(Math.max(wordStart + 0.25, nextStart - 0.04).toFixed(2)),
      }
    })

    const chordPool = ['C', 'Am', 'F', 'G', 'Dm', 'Em']
    const chords: ChordSync[] = [0, 2, 4, 6].map((offset, idx) => ({
      id: createId('chord'),
      symbol: chordPool[(lineIndex + idx) % chordPool.length],
      timeSec: Number((startSec + offset).toFixed(2)),
    }))

    return {
      id: createId('line'),
      startSec,
      endSec,
      words,
      chords,
    }
  })

  return {
    lines,
    statusMessage: 'Auto-generated fallback chart ready. For production-grade results, connect a transcription/chord service endpoint.',
  }
}

function splitLyricsIntoLines(rawLyrics: string) {
  const cleaned = rawLyrics
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u0000/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (cleaned.length > 0) {
    return cleaned
  }

  return rawLyrics
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function buildChartFromLyrics(rawLyrics: string, durationSec: number): GeneratedChart {
  const lyricLines = splitLyricsIntoLines(rawLyrics)

  if (lyricLines.length === 0) {
    return buildFallbackChart(durationSec)
  }

  const safeDuration = Math.max(30, Math.floor(durationSec) || lyricLines.length * 6)
  const lineDuration = Math.max(2.5, safeDuration / lyricLines.length)

  const lines = lyricLines.map((lineText, lineIndex) => {
    const startSec = Number((lineIndex * lineDuration).toFixed(2))
    const endSec = Number((startSec + lineDuration).toFixed(2))
    const wordsRaw = lineText.split(/\s+/).filter(Boolean)
    const words = wordsRaw.map((word, wordIndex) => {
      const wordStart = startSec + (wordIndex / wordsRaw.length) * lineDuration
      const nextStart = startSec + ((wordIndex + 1) / wordsRaw.length) * lineDuration

      return {
        id: createId('word'),
        text: word,
        startSec: Number(wordStart.toFixed(2)),
        endSec: Number(Math.max(wordStart + 0.18, nextStart - 0.04).toFixed(2)),
      }
    })

    const chordPool = ['C', 'Am', 'F', 'G', 'Dm', 'Em']
    const chords: ChordSync[] = [0, 2.2, 4.2, 6.1]
      .filter((offset) => offset < lineDuration)
      .map((offset, idx) => ({
        id: createId('chord'),
        symbol: chordPool[(lineIndex + idx) % chordPool.length],
        timeSec: Number((startSec + offset).toFixed(2)),
      }))

    return {
      id: createId('line'),
      startSec,
      endSec,
      words,
      chords,
    }
  })

  return {
    lines,
    statusMessage: `Auto lyrics extracted (${lyricLines.length} lines). Review sync and chords in Edit Mode.`,
  }
}

function readSynchsafeInt(bytes: Uint8Array, start: number) {
  return ((bytes[start] & 0x7f) << 21)
    | ((bytes[start + 1] & 0x7f) << 14)
    | ((bytes[start + 2] & 0x7f) << 7)
    | (bytes[start + 3] & 0x7f)
}

function decodeId3Text(data: Uint8Array) {
  if (data.length === 0) {
    return ''
  }

  const encoding = data[0]
  const body = data.slice(1)

  if (encoding === 1 || encoding === 2) {
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
    const codePoints: number[] = []

    for (let i = 0; i + 1 < view.byteLength; i += 2) {
      const value = view.getUint16(i, false)
      if (value === 0) {
        continue
      }
      codePoints.push(value)
    }

    return String.fromCharCode(...codePoints)
  }

  return new TextDecoder('latin1').decode(body)
}

async function extractEmbeddedLyrics(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null
  }

  const tagSize = readSynchsafeInt(bytes, 6)
  let cursor = 10
  const end = Math.min(bytes.length, 10 + tagSize)

  while (cursor + 10 <= end) {
    const frameId = String.fromCharCode(bytes[cursor], bytes[cursor + 1], bytes[cursor + 2], bytes[cursor + 3])

    if (!/^[A-Z0-9]{4}$/.test(frameId)) {
      break
    }

    const frameSize = (bytes[cursor + 4] << 24)
      | (bytes[cursor + 5] << 16)
      | (bytes[cursor + 6] << 8)
      | bytes[cursor + 7]

    if (!Number.isFinite(frameSize) || frameSize <= 0) {
      break
    }

    const payloadStart = cursor + 10
    const payloadEnd = payloadStart + frameSize

    if (payloadEnd > end) {
      break
    }

    if (frameId === 'USLT' || frameId === 'SYLT') {
      const payload = bytes.slice(payloadStart, payloadEnd)
      const text = decodeId3Text(payload)
      const cleaned = text.replace(/[\u0000\u0001]+/g, ' ').trim()

      if (cleaned.length > 0) {
        return cleaned
      }
    }

    cursor = payloadEnd
  }

  return null
}

async function decodeAudioDuration(audioContext: AudioContext, file: File) {
  const bytes = await file.arrayBuffer()
  return audioContext.decodeAudioData(bytes.slice(0))
}

function readProjectSnapshot(): PersistedProject | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(STUDIO_PROJECT_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as PersistedProject

    if (!Array.isArray(parsed.chartLines) || !Array.isArray(parsed.tracks)) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

async function requestAutoChart(primaryTrack: StudioTrack | null): Promise<GeneratedChart> {
  if (!primaryTrack) {
    return {
      lines: [],
      statusMessage: 'Upload a song first.',
    }
  }

  try {
    const response = await fetch('/api/autogen-chart', {
      method: 'POST',
      body: primaryTrack.file,
      headers: {
        'Content-Type': primaryTrack.file.type || 'audio/mpeg',
        'X-File-Name': encodeURIComponent(primaryTrack.name),
      },
    })

    if (response.ok) {
      const payload = (await response.json()) as { lines?: LyricLine[] }

      if (Array.isArray(payload.lines) && payload.lines.length > 0) {
        return {
          lines: payload.lines,
          statusMessage: 'Chart generated by connected AI service.',
        }
      }
    }
  } catch {
    // Ignore network failure and fallback.
  }

  try {
    const embeddedLyrics = await extractEmbeddedLyrics(primaryTrack.file)

    if (embeddedLyrics) {
      const chart = buildChartFromLyrics(embeddedLyrics, primaryTrack.durationSec)
      return {
        ...chart,
        statusMessage: 'Auto lyrics extracted from embedded song metadata. Refine timings in Edit Mode if needed.',
      }
    }
  } catch {
    // Ignore metadata parse failures and continue.
  }

  return buildFallbackChart(primaryTrack.durationSec)
}

function SongStudioPage() {
  const audioContextRef = useRef<AudioContext | null>(null)
  const masterInputGainRef = useRef<GainNode | null>(null)
  const limiterNodeRef = useRef<DynamicsCompressorNode | null>(null)
  const masterOutputGainRef = useRef<GainNode | null>(null)
  const recordDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map())
  const sourceNodesRef = useRef<NodeBundle[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const recordingUrlsRef = useRef<string[]>([])
  const midiAccessRef = useRef<MIDIAccess | null>(null)
  const rafRef = useRef<number | null>(null)
  const clickTimerRef = useRef<number | null>(null)
  const nextClickTimeRef = useRef(0)
  const clickBeatIndexRef = useRef(0)
  const playStartedAtRef = useRef(0)
  const playOffsetRef = useRef(0)

  const initialSnapshot = useMemo(() => readProjectSnapshot(), [])
  const [tracks, setTracks] = useState<StudioTrack[]>([])
  const [chartLines, setChartLines] = useState<LyricLine[]>(initialSnapshot?.chartLines ?? [])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeSec, setCurrentTimeSec] = useState(0)
  const [statusText, setStatusText] = useState('Upload a lead track and optional stems to start.')
  const [isGenerating, setIsGenerating] = useState(false)
  const [manualLyricsInput, setManualLyricsInput] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [transposeSemitones, setTransposeSemitones] = useState(initialSnapshot?.transposeSemitones ?? 0)
  const [capo, setCapo] = useState(initialSnapshot?.capo ?? 0)
  const [masterVolume, setMasterVolume] = useState(initialSnapshot?.masterVolume ?? 1)
  const [masterRoutePreset, setMasterRoutePreset] = useState<OutputRoutePresetId>(initialSnapshot?.masterRoutePreset ?? 'frontPA')
  const [limiterEnabled, setLimiterEnabled] = useState(initialSnapshot?.limiterEnabled ?? true)
  const [limiterPreset, setLimiterPreset] = useState<LimiterPresetId>(initialSnapshot?.limiterPreset ?? 'liveSafe')
  const [limiterCeilingDb, setLimiterCeilingDb] = useState(initialSnapshot?.limiterCeilingDb ?? -1)
  const [loopSectionId, setLoopSectionId] = useState<string | null>(initialSnapshot?.loopSectionId ?? null)
  const [syncOffsetSec, setSyncOffsetSec] = useState(initialSnapshot?.syncOffsetSec ?? 0)
  const [clickTrackEnabled, setClickTrackEnabled] = useState(true)
  const [clickTrackBpm, setClickTrackBpm] = useState(120)
  const [clickTrackBeatsPerBar, setClickTrackBeatsPerBar] = useState(4)
  const [clickTrackPreIntroBars, setClickTrackPreIntroBars] = useState(1)
  const [clickTrackVolume, setClickTrackVolume] = useState(0.45)
  const [isDetectingBeat, setIsDetectingBeat] = useState(false)
  const [preCountBeatsRemaining, setPreCountBeatsRemaining] = useState<number | null>(null)
  const [extractionSourceTrackId, setExtractionSourceTrackId] = useState<string | null>(null)
  const [performerMonitorEnabled, setPerformerMonitorEnabled] = useState(false)
  const [midiMappings, setMidiMappings] = useState<MidiMappings>(initialSnapshot?.midiMappings ?? DEFAULT_MIDI_MAPPINGS)
  const [midiConnected, setMidiConnected] = useState(false)
  const [midiStatusText, setMidiStatusText] = useState('MIDI not connected.')
  const [cachedTracks, setCachedTracks] = useState<CachedTrackMeta[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [recordings, setRecordings] = useState<RecordingClip[]>([])

  const songTrack = tracks.find((track) => track.role === 'song') ?? null
  const stemTracks = tracks.filter((track) => track.role === 'stem')
  const playbackTracks = tracks
  const extractionSourceTrack = tracks.find((track) => track.id === extractionSourceTrackId) ?? songTrack
  const totalDurationSec = songTrack?.durationSec ?? 0

  const currentLineIndex = useMemo(() => {
    if (chartLines.length === 0) {
      return -1
    }

    return chartLines.findIndex((line) => currentTimeSec >= line.startSec && currentTimeSec < line.endSec)
  }, [chartLines, currentTimeSec])

  const currentLine = currentLineIndex >= 0 ? chartLines[currentLineIndex] : null
  const nextLine = currentLineIndex >= 0 ? chartLines[currentLineIndex + 1] ?? null : chartLines[0] ?? null

  const displayedTranspose = transposeSemitones - capo
  const syncedTime = Math.max(0, currentTimeSec + syncOffsetSec)
  const monitorSections = useMemo(() => buildMonitorSections(chartLines, totalDurationSec), [chartLines, totalDurationSec])

  const activeMonitorSectionIndex = useMemo(
    () => monitorSections.findIndex((section) => syncedTime >= section.startSec && syncedTime < section.endSec),
    [monitorSections, syncedTime],
  )

  const activeMonitorSection = activeMonitorSectionIndex >= 0 ? monitorSections[activeMonitorSectionIndex] : monitorSections[0] ?? null
  const nextMonitorSection = activeMonitorSectionIndex >= 0
    ? monitorSections[activeMonitorSectionIndex + 1] ?? null
    : monitorSections[1] ?? null
  const loopSection = monitorSections.find((section) => section.id === loopSectionId) ?? null

  const activeSectionProgress = activeMonitorSection
    ? Math.min(
      1,
      Math.max(
        0,
        (syncedTime - activeMonitorSection.startSec) / Math.max(0.01, activeMonitorSection.endSec - activeMonitorSection.startSec),
      ),
    )
    : 0

  const visibleChords = useMemo(() => {
    if (!currentLine) {
      return []
    }

    return currentLine.chords.map((chord) => ({
      ...chord,
      symbol: transposeChord(chord.symbol, displayedTranspose),
      isActive: syncedTime >= chord.timeSec && syncedTime < chord.timeSec + 1.2,
    }))
  }, [currentLine, syncedTime, displayedTranspose])

  const currentChordHighlight = useMemo(() => {
    const active = visibleChords.find((chord) => chord.isActive)
    if (active) {
      return active.symbol
    }

    return visibleChords[0]?.symbol ?? '--'
  }, [visibleChords])

  const nextChordHighlight = useMemo(() => {
    const chord = nextLine?.chords?.[0]
    if (!chord) {
      return '--'
    }

    return transposeChord(chord.symbol, displayedTranspose)
  }, [displayedTranspose, nextLine])

  const remainingSongClock = formatClock(Math.max(0, totalDurationSec - syncedTime))

  const healthChecks = useMemo(() => {
    const entries = [
      { id: 'audio', label: 'Audio engine ready', pass: Boolean(audioContextRef.current) },
      { id: 'track', label: 'Song loaded for extraction', pass: Boolean(songTrack) },
      { id: 'chart', label: 'Lyric/chord chart', pass: chartLines.length > 0 },
      { id: 'sections', label: 'Section markers', pass: monitorSections.length > 1 },
      { id: 'offline', label: 'Offline cache', pass: cachedTracks.length > 0 },
      {
        id: 'x18',
        label: `X18 stem channels (max ${MAX_STEM_CHANNELS})`,
        pass: stemTracks.length <= MAX_STEM_CHANNELS,
      },
      { id: 'midi', label: 'MIDI control', pass: midiConnected },
      { id: 'record', label: 'Recording ready', pass: typeof window !== 'undefined' && 'MediaRecorder' in window },
    ]

    const passed = entries.filter((entry) => entry.pass).length
    return {
      entries,
      passed,
      total: entries.length,
      summary: `${passed}/${entries.length} checks passed`,
    }
  }, [cachedTracks.length, chartLines.length, midiConnected, monitorSections.length, songTrack, stemTracks.length])

  useEffect(() => {
    if (!loopSectionId) {
      return
    }

    const exists = monitorSections.some((section) => section.id === loopSectionId)
    if (!exists) {
      setLoopSectionId(null)
    }
  }, [loopSectionId, monitorSections])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const persistedTracks: PersistedTrack[] = tracks.map((track) => ({
      id: track.id,
      name: track.name,
      role: track.role,
      channel: track.channel,
      durationSec: track.durationSec,
      volume: track.volume,
      pan: track.pan,
      muted: track.muted,
      solo: track.solo,
    }))

    const snapshot: PersistedProject = {
      chartLines,
      transposeSemitones,
      capo,
      syncOffsetSec,
      masterVolume,
      masterRoutePreset,
      limiterEnabled,
      limiterPreset,
      limiterCeilingDb,
      loopSectionId,
      midiMappings,
      tracks: persistedTracks,
    }

    window.localStorage.setItem(STUDIO_PROJECT_KEY, JSON.stringify(snapshot))
  }, [
    capo,
    chartLines,
    limiterCeilingDb,
    limiterEnabled,
    limiterPreset,
    loopSectionId,
    masterRoutePreset,
    masterVolume,
    midiMappings,
    syncOffsetSec,
    tracks,
    transposeSemitones,
  ])

  useEffect(() => {
    if (tracks.length > 0 || !initialSnapshot?.tracks?.length) {
      return
    }

    const restoredTracks: StudioTrack[] = initialSnapshot.tracks.map((track) => ({
      ...track,
      role: track.role === 'song' ? 'song' : 'stem',
      channel: typeof track.channel === 'number' ? track.channel : null,
      file: new File([], `${track.name} (metadata only)`),
      objectUrl: '',
      cacheKey: '',
    }))

    setTracks(restoredTracks)
    setStatusText('Project metadata restored. Re-upload audio files to play stems.')
  }, [initialSnapshot?.tracks, tracks.length])

  useEffect(() => {
    if (!isPlaying || sourceNodesRef.current.length === 0) {
      return
    }

    const routePreset = OUTPUT_ROUTE_PRESETS[masterRoutePreset]
    const hasSolo = tracks.some((track) => track.solo)

    sourceNodesRef.current.forEach((bundle) => {
      const track = tracks.find((entry) => entry.id === bundle.trackId)

      if (!track) {
        return
      }

      const trackAudible = hasSolo ? track.solo : !track.muted
      bundle.gain.gain.value = trackAudible ? track.volume * masterVolume : 0
      bundle.panner.pan.value = routePreset.forceMono ? 0 : track.pan
    })
  }, [isPlaying, masterRoutePreset, masterVolume, tracks])

  useEffect(() => {
    const limiterNode = limiterNodeRef.current
    if (!limiterNode) {
      return
    }

    const preset = LIMITER_PRESETS[limiterPreset]
    limiterNode.threshold.value = preset.threshold
    limiterNode.knee.value = preset.knee
    limiterNode.ratio.value = limiterEnabled ? preset.ratio : 1
    limiterNode.attack.value = preset.attack
    limiterNode.release.value = preset.release
  }, [limiterEnabled, limiterPreset])

  useEffect(() => {
    const outputNode = masterOutputGainRef.current
    if (!outputNode) {
      return
    }

    const routePreset = OUTPUT_ROUTE_PRESETS[masterRoutePreset]
    const routeGain = dbToGain(routePreset.trimDb)
    const ceilingGain = dbToGain(Math.min(0, limiterCeilingDb))
    outputNode.gain.value = masterVolume * routeGain * ceilingGain
  }, [limiterCeilingDb, masterRoutePreset, masterVolume])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT' || (event.target as HTMLElement | null)?.tagName === 'TEXTAREA') {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        if (isPlaying) {
          onPausePlayback()
        } else {
          void startPlayback()
        }
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault()
        onSeek(currentTimeSec + 2)
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        onSeek(currentTimeSec - 2)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [currentTimeSec, isPlaying])

  useEffect(() => {
    void refreshCachedTracks()
  }, [])

  useEffect(() => {
    const access = midiAccessRef.current
    if (!access) {
      return
    }

    const handleMidiMessage = (event: MIDIMessageEvent) => {
      const data = event.data
      if (!data || data.length < 3) {
        return
      }

      const status = data[0]
      const note = data[1]
      const velocity = data[2]
      if ((status & 0xf0) !== 0x90 || velocity === 0) {
        return
      }

      if (note === midiMappings.playPause) {
        if (isPlaying) {
          onPausePlayback()
        } else {
          void startPlayback()
        }
      }

      if (note === midiMappings.stop) {
        onSeek(0)
      }

      if (note === midiMappings.prevSection) {
        onSeek(Math.max(0, (activeMonitorSection?.startSec ?? 0) - 0.01))
      }

      if (note === midiMappings.nextSection) {
        onSeek(nextMonitorSection?.startSec ?? 0)
      }
    }

    access.inputs.forEach((input) => {
      input.onmidimessage = handleMidiMessage
    })

    access.onstatechange = () => {
      const connected = Array.from(access.inputs.values()).some((input) => input.state === 'connected')
      setMidiConnected(connected)

      access.inputs.forEach((input) => {
        input.onmidimessage = handleMidiMessage
      })
    }

    return () => {
      access.inputs.forEach((input) => {
        input.onmidimessage = null
      })
      access.onstatechange = null
    }
  }, [activeMonitorSection?.startSec, isPlaying, midiMappings, nextMonitorSection?.startSec])

  const stopPlayback = () => {
    sourceNodesRef.current.forEach((bundle) => {
      try {
        bundle.source.stop()
      } catch {
        // Ignore stop races.
      }

      bundle.source.disconnect()
      bundle.gain.disconnect()
      bundle.panner.disconnect()
    })

    sourceNodesRef.current = []

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (clickTimerRef.current !== null) {
      window.clearInterval(clickTimerRef.current)
      clickTimerRef.current = null
    }

    setPreCountBeatsRemaining(null)

    setIsPlaying(false)
  }

  useEffect(() => {
    recordingUrlsRef.current = recordings.map((clip) => clip.objectUrl)
  }, [recordings])

  useEffect(() => {
    return () => {
      stopPlayback()

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }

      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }

      tracks.forEach((track) => {
        URL.revokeObjectURL(track.objectUrl)
      })

      recordingUrlsRef.current.forEach((url) => {
        URL.revokeObjectURL(url)
      })
    }
  }, [])

  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      const context = new AudioContext()
      const masterInput = context.createGain()
      const limiter = context.createDynamicsCompressor()
      const masterOutput = context.createGain()
      const recordDestination = context.createMediaStreamDestination()

      masterInput.connect(limiter)
      limiter.connect(masterOutput)
      masterOutput.connect(context.destination)
      masterOutput.connect(recordDestination)

      masterInputGainRef.current = masterInput
      limiterNodeRef.current = limiter
      masterOutputGainRef.current = masterOutput
      recordDestinationRef.current = recordDestination
      audioContextRef.current = context
    }

    const limiterNode = limiterNodeRef.current
    const outputNode = masterOutputGainRef.current
    const limiterSettings = LIMITER_PRESETS[limiterPreset]
    const routePreset = OUTPUT_ROUTE_PRESETS[masterRoutePreset]

    if (limiterNode) {
      limiterNode.threshold.value = limiterSettings.threshold
      limiterNode.knee.value = limiterSettings.knee
      limiterNode.ratio.value = limiterEnabled ? limiterSettings.ratio : 1
      limiterNode.attack.value = limiterSettings.attack
      limiterNode.release.value = limiterSettings.release
    }

    if (outputNode) {
      const routeGain = dbToGain(routePreset.trimDb)
      const ceilingGain = dbToGain(Math.min(0, limiterCeilingDb))
      outputNode.gain.value = masterVolume * routeGain * ceilingGain
    }

    return audioContextRef.current
  }

  const refreshCachedTracks = async () => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return
    }

    try {
      const db = await openAudioCacheDb()
      const transaction = db.transaction(AUDIO_CACHE_STORE, 'readonly')
      const store = transaction.objectStore(AUDIO_CACHE_STORE)
      const request = store.getAll()

      const rows = await new Promise<CachedTrackMeta[]>((resolve, reject) => {
        request.onsuccess = () => resolve((request.result as CachedTrackMeta[]) ?? [])
        request.onerror = () => reject(request.error)
      })

      setCachedTracks(rows.sort((a, b) => b.cachedAt - a.cachedAt))
    } catch {
      setCachedTracks([])
    }
  }

  const cacheTrackFile = async (file: File) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return
    }

    try {
      const db = await openAudioCacheDb()
      const transaction = db.transaction(AUDIO_CACHE_STORE, 'readwrite')
      const store = transaction.objectStore(AUDIO_CACHE_STORE)
      store.put({
        key: fileToCacheKey(file),
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        cachedAt: Date.now(),
        blob: file,
      })

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } catch {
      // Ignore cache write failures.
    }
  }

  const addTracksFromFiles = async (acceptedFiles: File[], role: 'song' | 'stem') => {
    if (acceptedFiles.length === 0) {
      return
    }

    if (role === 'stem') {
      const availableSlots = Math.max(0, MAX_STEM_CHANNELS - stemTracks.length)
      if (availableSlots <= 0) {
        setStatusText(`Mixer supports up to ${MAX_STEM_CHANNELS} stem channels plus master.`)
        return
      }

      if (acceptedFiles.length > availableSlots) {
        acceptedFiles = acceptedFiles.slice(0, availableSlots)
      }
    }

    const context = ensureAudioContext()
    const nextTracks: StudioTrack[] = []
    let workingTracks = tracks

    for (const file of acceptedFiles) {
      const buffer = await decodeAudioDuration(context, file)
      const objectUrl = URL.createObjectURL(file)
      const id = createId('track')
      const channel = role === 'stem' ? nextAvailableStemChannel([...workingTracks, ...nextTracks]) : null

      if (role === 'stem' && channel === null) {
        break
      }

      buffersRef.current.set(id, buffer)

      nextTracks.push({
        id,
        name: file.name,
        file,
        objectUrl,
        cacheKey: fileToCacheKey(file),
        role,
        channel,
        durationSec: buffer.duration,
        volume: 0.9,
        pan: 0,
        muted: false,
        solo: false,
      })

      void cacheTrackFile(file)
    }

    setTracks((current) => {
      if (role === 'song') {
        const existingSong = current.find((track) => track.role === 'song')
        if (existingSong?.objectUrl) {
          URL.revokeObjectURL(existingSong.objectUrl)
        }
        if (existingSong) {
          buffersRef.current.delete(existingSong.id)
        }

        const withoutSong = current.filter((track) => track.role !== 'song')
        const replacementSong = nextTracks[0]
        if (replacementSong) {
          setExtractionSourceTrackId(replacementSong.id)
          return [replacementSong, ...withoutSong]
        }

        return withoutSong
      }

      const merged = [...current, ...nextTracks]
      return merged
    })

    let beatDetectionMessage = ''
    const autoTrack = role === 'song' ? nextTracks[0] : null
    if (autoTrack) {
      const buffer = buffersRef.current.get(autoTrack.id)
      if (buffer) {
        setIsDetectingBeat(true)
        const result = estimateTempoFromBuffer(buffer)
        if (result) {
          setClickTrackBpm(result.bpm)
          beatDetectionMessage = result.confidence < 0.12
            ? ` Auto-beat estimated ${result.bpm} BPM (low confidence).`
            : ` Auto-beat detected ${result.bpm} BPM.`
        }
        setIsDetectingBeat(false)
      }
    }

    await refreshCachedTracks()
    if (role === 'song') {
      setStatusText(`Song loaded for lyric/chord extraction.${beatDetectionMessage}`)
    } else {
      setStatusText(`${nextTracks.length} stem track(s) added to mixer (${Math.min(MAX_STEM_CHANNELS, stemTracks.length + nextTracks.length)}/${MAX_STEM_CHANNELS}).`)
    }
  }

  const restoreCachedTracks = async () => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      setStatusText('Offline cache is not supported in this browser.')
      return
    }

    try {
      const db = await openAudioCacheDb()
      const transaction = db.transaction(AUDIO_CACHE_STORE, 'readonly')
      const store = transaction.objectStore(AUDIO_CACHE_STORE)
      const request = store.getAll()

      const rows = await new Promise<Array<CachedTrackMeta & { blob: Blob }>>((resolve, reject) => {
        request.onsuccess = () => resolve((request.result as Array<CachedTrackMeta & { blob: Blob }>) ?? [])
        request.onerror = () => reject(request.error)
      })

      const files = rows.map((row) => new File([row.blob], row.name, { type: row.type, lastModified: row.lastModified }))
      if (files.length === 0) {
        setStatusText('No cached tracks found yet.')
        return
      }

      const songFiles = songTrack ? [] : files.slice(0, 1)
      const stemFiles = songTrack ? files : files.slice(1)

      if (songFiles.length > 0) {
        await addTracksFromFiles(songFiles, 'song')
      }

      if (stemFiles.length > 0) {
        await addTracksFromFiles(stemFiles, 'stem')
      }

      setStatusText(`Restored ${files.length} cached track(s) for offline mode.`)
    } catch {
      setStatusText('Could not restore cached tracks.')
    }
  }

  const connectMidi = async () => {
    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      setMidiStatusText('MIDI is not supported on this device/browser.')
      return
    }

    try {
      const access = await (navigator as Navigator & { requestMIDIAccess: () => Promise<MIDIAccess> }).requestMIDIAccess()
      midiAccessRef.current = access
      setMidiConnected(access.inputs.size > 0)
      setMidiStatusText(access.inputs.size > 0 ? 'MIDI connected.' : 'MIDI granted. Connect a controller to receive events.')
    } catch {
      setMidiConnected(false)
      setMidiStatusText('Could not connect MIDI controller.')
    }
  }

  const startRecording = async () => {
    if (typeof window === 'undefined' || !('MediaRecorder' in window)) {
      setStatusText('Recording is not supported in this browser.')
      return
    }

    const context = ensureAudioContext()
    await context.resume()

    const destination = recordDestinationRef.current
    if (!destination) {
      setStatusText('Recording bus is not available.')
      return
    }

    const recorder = new MediaRecorder(destination.stream)
    recordingChunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data)
      }
    }

    recorder.onstop = () => {
      const mimeType = recordingChunksRef.current[0]?.type || 'audio/webm'
      const clipBlob = new Blob(recordingChunksRef.current, { type: mimeType })
      const objectUrl = URL.createObjectURL(clipBlob)
      setRecordings((current) => [{
        id: createId('rec'),
        name: `Recording ${new Date().toLocaleTimeString()}`,
        createdAt: Date.now(),
        objectUrl,
      }, ...current])
      setIsRecording(false)
      setStatusText('Recording saved.')
    }

    recorder.start()
    mediaRecorderRef.current = recorder
    setIsRecording(true)
    setStatusText('Recording started.')
  }

  const detectBeatFromSong = async () => {
    const track = extractionSourceTrack ?? songTrack
    if (!track) {
      setStatusText('Load a song first, then detect beat.')
      return
    }

    const buffer = buffersRef.current.get(track.id)
    if (!buffer) {
      setStatusText('Audio buffer unavailable. Re-upload track and try again.')
      return
    }

    setIsDetectingBeat(true)
    try {
      const result = estimateTempoFromBuffer(buffer)
      if (!result) {
        setStatusText('Could not confidently detect beat. Set BPM manually.')
        return
      }

      setClickTrackBpm(result.bpm)
      if (result.confidence < 0.12) {
        setStatusText(`Estimated BPM ${result.bpm} (low confidence). Please verify by ear.`)
      } else {
        setStatusText(`Detected BPM ${result.bpm}. Click track updated.`)
      }
    } finally {
      setIsDetectingBeat(false)
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      return
    }

    recorder.stop()
  }

  const onAddSongFile = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return
    }

    const acceptedFiles = Array.from(fileList)
      .filter((file) => /audio\/(mpeg|wav|x-wav|mp3|aac|ogg)/i.test(file.type) || /\.(mp3|wav|aac|m4a|ogg)$/i.test(file.name))
      .slice(0, 1)

    if (acceptedFiles.length === 0) {
      setStatusText('Only audio files (WAV/MP3/AAC/OGG) are supported.')
      return
    }

    await addTracksFromFiles(acceptedFiles, 'song')
  }

  const onAddStemFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return
    }

    if (!songTrack) {
      setStatusText('Upload a song first for extraction, then add mixer stems.')
      return
    }

    const acceptedFiles = Array.from(fileList)
      .filter((file) => /audio\/(mpeg|wav|x-wav|mp3|aac|ogg)/i.test(file.type) || /\.(mp3|wav|aac|m4a|ogg)$/i.test(file.name))

    if (acceptedFiles.length === 0) {
      setStatusText('Only audio files (WAV/MP3/AAC/OGG) are supported.')
      return
    }

    await addTracksFromFiles(acceptedFiles, 'stem')
  }

  const onGenerateChart = async () => {
    setIsGenerating(true)

    try {
      const chart = await requestAutoChart(extractionSourceTrack)
      setChartLines(chart.lines)
      setCurrentTimeSec(0)
      setStatusText(chart.statusMessage)
    } finally {
      setIsGenerating(false)
    }
  }

  const onApplyManualLyrics = () => {
    if (!extractionSourceTrack) {
      setStatusText('Upload a song track first, then add manual lyrics.')
      return
    }

    const chart = buildChartFromLyrics(manualLyricsInput, extractionSourceTrack.durationSec)
    setChartLines(chart.lines)
    setCurrentTimeSec(0)
    setStatusText('Manual lyrics added. Use Edit Mode to polish exact sync and chord placement.')
  }

  const syncTick = () => {
    const context = audioContextRef.current

    if (!context) {
      return
    }

    const elapsed = context.currentTime - playStartedAtRef.current

    if (elapsed < 0) {
      setCurrentTimeSec(playOffsetRef.current)
      rafRef.current = window.requestAnimationFrame(syncTick)
      return
    }

    const nextTime = Math.min(totalDurationSec || elapsed + playOffsetRef.current, playOffsetRef.current + elapsed)

    if (loopSection && isPlaying && nextTime >= loopSection.endSec) {
      playOffsetRef.current = loopSection.startSec
      setCurrentTimeSec(loopSection.startSec)
      void startPlayback()
      return
    }

    setCurrentTimeSec(nextTime)

    if (totalDurationSec > 0 && nextTime >= totalDurationSec) {
      playOffsetRef.current = 0
      setCurrentTimeSec(totalDurationSec)
      stopPlayback()
      return
    }

    rafRef.current = window.requestAnimationFrame(syncTick)
  }

  const scheduleClick = (context: AudioContext, atSec: number, isDownbeat: boolean) => {
    const osc = context.createOscillator()
    const gain = context.createGain()
    const masterInput = masterInputGainRef.current

    osc.type = 'square'
    osc.frequency.value = isDownbeat ? 1800 : 1100
    gain.gain.setValueAtTime(0.0001, atSec)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, clickTrackVolume), atSec + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, atSec + 0.055)

    osc.connect(gain)
    if (masterInput) {
      gain.connect(masterInput)
    } else {
      gain.connect(context.destination)
    }
    osc.start(atSec)
    osc.stop(atSec + 0.065)
  }

  const startClickScheduler = (context: AudioContext, preRollBeats: number) => {
    if (!clickTrackEnabled) {
      return
    }

    const beatDurationSec = 60 / Math.max(30, clickTrackBpm)
    nextClickTimeRef.current = context.currentTime
    clickBeatIndexRef.current = 0

    const lookAheadSec = 0.1
    const intervalMs = 25

    const tick = () => {
      while (nextClickTimeRef.current < context.currentTime + lookAheadSec) {
        const beatIndex = clickBeatIndexRef.current
        const isDownbeat = beatIndex % Math.max(1, clickTrackBeatsPerBar) === 0
        scheduleClick(context, nextClickTimeRef.current, isDownbeat)

        if (preRollBeats > 0 && beatIndex < preRollBeats) {
          const remaining = preRollBeats - beatIndex - 1
          setPreCountBeatsRemaining(remaining)
        } else {
          setPreCountBeatsRemaining(null)
        }

        clickBeatIndexRef.current += 1
        nextClickTimeRef.current += beatDurationSec
      }
    }

    tick()
    clickTimerRef.current = window.setInterval(tick, intervalMs)
  }

  const startPlayback = async () => {
    if (!songTrack) {
      setStatusText('Upload a song first, then run playback.')
      return
    }

    const context = ensureAudioContext()
    await context.resume()

    stopPlayback()

    const shouldUsePreIntro = clickTrackEnabled && clickTrackPreIntroBars > 0 && playOffsetRef.current <= 0.001
    const preRollBeats = shouldUsePreIntro ? clickTrackPreIntroBars * Math.max(1, clickTrackBeatsPerBar) : 0
    const preRollDelaySec = shouldUsePreIntro ? preRollBeats * (60 / Math.max(30, clickTrackBpm)) : 0
    const routePreset = OUTPUT_ROUTE_PRESETS[masterRoutePreset]
    const masterInput = masterInputGainRef.current

    const hasSolo = playbackTracks.some((track) => track.solo)

    sourceNodesRef.current = playbackTracks.flatMap((track) => {
      const buffer = buffersRef.current.get(track.id)
      if (!buffer) {
        return []
      }

      const source = context.createBufferSource()
      source.buffer = buffer
      const gain = context.createGain()
      const panner = context.createStereoPanner()

      const trackAudible = hasSolo ? track.solo : !track.muted
      gain.gain.value = trackAudible ? track.volume * masterVolume : 0
      panner.pan.value = routePreset.forceMono ? 0 : track.pan

      source.connect(gain)
      gain.connect(panner)
      if (masterInput) {
        panner.connect(masterInput)
      } else {
        panner.connect(context.destination)
      }

      source.start(context.currentTime + preRollDelaySec, playOffsetRef.current)

      return [{ trackId: track.id, source, gain, panner }]
    })

    playStartedAtRef.current = context.currentTime + preRollDelaySec
    startClickScheduler(context, preRollBeats)
    setIsPlaying(true)
    rafRef.current = window.requestAnimationFrame(syncTick)

    if (shouldUsePreIntro) {
      setStatusText(`Pre-intro count: ${clickTrackPreIntroBars} bar(s). Playback starts after count-in.`)
    } else {
      setStatusText(`Playback routed to ${routePreset.label}.`)
    }
  }

  const removeTrack = (trackId: string) => {
    sourceNodesRef.current = sourceNodesRef.current.filter((bundle) => {
      if (bundle.trackId !== trackId) {
        return true
      }

      try {
        bundle.source.stop()
      } catch {
        // Ignore race when node already stopped.
      }

      bundle.source.disconnect()
      bundle.gain.disconnect()
      bundle.panner.disconnect()
      return false
    })

    setTracks((current) => {
      const target = current.find((track) => track.id === trackId)

      if (target?.objectUrl) {
        URL.revokeObjectURL(target.objectUrl)
      }

      buffersRef.current.delete(trackId)

      return current.filter((track) => track.id !== trackId)
    })

    if (extractionSourceTrackId === trackId) {
      setExtractionSourceTrackId(null)
    }
  }

  const exportChart = () => {
    const payload = {
      chartLines,
      transposeSemitones,
      capo,
      syncOffsetSec,
      masterRoutePreset,
      limiterEnabled,
      limiterPreset,
      limiterCeilingDb,
      loopSectionId,
      midiMappings,
      exportedAt: new Date().toISOString(),
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `song-studio-chart-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importChart = async (file: File | null) => {
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Partial<PersistedProject>

      if (!Array.isArray(parsed.chartLines)) {
        throw new Error('Invalid chart file')
      }

      setChartLines(parsed.chartLines)
      setTransposeSemitones(typeof parsed.transposeSemitones === 'number' ? parsed.transposeSemitones : 0)
      setCapo(typeof parsed.capo === 'number' ? parsed.capo : 0)
      setSyncOffsetSec(typeof parsed.syncOffsetSec === 'number' ? parsed.syncOffsetSec : 0)
      setMasterRoutePreset(
        parsed.masterRoutePreset === 'frontPA' || parsed.masterRoutePreset === 'monitorMono' || parsed.masterRoutePreset === 'streamFeed'
          ? parsed.masterRoutePreset
          : 'frontPA',
      )
      setLimiterEnabled(typeof parsed.limiterEnabled === 'boolean' ? parsed.limiterEnabled : true)
      setLimiterPreset(
        parsed.limiterPreset === 'transparent' || parsed.limiterPreset === 'liveSafe' || parsed.limiterPreset === 'hardClamp'
          ? parsed.limiterPreset
          : 'liveSafe',
      )
      setLimiterCeilingDb(typeof parsed.limiterCeilingDb === 'number' ? parsed.limiterCeilingDb : -1)
      setLoopSectionId(typeof parsed.loopSectionId === 'string' || parsed.loopSectionId === null ? parsed.loopSectionId : null)
      if (parsed.midiMappings && typeof parsed.midiMappings === 'object') {
        const incoming = parsed.midiMappings as Partial<MidiMappings>
        setMidiMappings({
          playPause: typeof incoming.playPause === 'number' ? incoming.playPause : DEFAULT_MIDI_MAPPINGS.playPause,
          stop: typeof incoming.stop === 'number' ? incoming.stop : DEFAULT_MIDI_MAPPINGS.stop,
          prevSection: typeof incoming.prevSection === 'number' ? incoming.prevSection : DEFAULT_MIDI_MAPPINGS.prevSection,
          nextSection: typeof incoming.nextSection === 'number' ? incoming.nextSection : DEFAULT_MIDI_MAPPINGS.nextSection,
        })
      }
      setStatusText('Chart imported successfully.')
    } catch {
      setStatusText('Could not import chart file.')
    }
  }

  const onPausePlayback = () => {
    const context = audioContextRef.current
    if (!context) {
      return
    }

    const elapsed = context.currentTime - playStartedAtRef.current
    playOffsetRef.current = Math.min(totalDurationSec || elapsed + playOffsetRef.current, playOffsetRef.current + elapsed)
    stopPlayback()
  }

  const onSeek = (nextTimeSec: number) => {
    const bounded = Math.max(0, Math.min(totalDurationSec || 0, nextTimeSec))
    setCurrentTimeSec(bounded)
    playOffsetRef.current = bounded

    if (isPlaying) {
      void startPlayback()
    }
  }

  const updateTrack = (trackId: string, update: Partial<StudioTrack>) => {
    setTracks((current) => current.map((track) => (track.id === trackId ? { ...track, ...update } : track)))
  }

  const updateWordTiming = (lineId: string, wordId: string, patch: Partial<WordSync>) => {
    setChartLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) {
          return line
        }

        return {
          ...line,
          words: line.words.map((word) => (word.id === wordId ? { ...word, ...patch } : word)),
        }
      }),
    )
  }

  const nudgeLine = (lineId: string, deltaSec: number) => {
    setChartLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) {
          return line
        }

        return {
          ...line,
          startSec: Number((line.startSec + deltaSec).toFixed(2)),
          endSec: Number((line.endSec + deltaSec).toFixed(2)),
          words: line.words.map((word) => ({
            ...word,
            startSec: Number((word.startSec + deltaSec).toFixed(2)),
            endSec: Number((word.endSec + deltaSec).toFixed(2)),
          })),
          chords: line.chords.map((chord) => ({
            ...chord,
            timeSec: Number((chord.timeSec + deltaSec).toFixed(2)),
          })),
        }
      }),
    )
  }

  return (
    <section className="surface-card page-shell" aria-label="Song studio page">
      <header className="page-header">
        <p className="section-kicker">Song Studio</p>
        <h2>Extract lyrics/chords from your song and perform with synced monitor controls</h2>
        <p>
          Upload one clean song track for extraction, then optionally add stems for live mixing.
        </p>
      </header>

      <article className="studio-panel">
        <div className="studio-upload-row">
          <label className="studio-upload-btn" htmlFor="studio-song-upload">1) Upload Song For Extraction</label>
          <input
            id="studio-song-upload"
            type="file"
            accept="audio/*,.mp3,.wav,.aac,.m4a,.ogg"
            onChange={(event) => {
              void onAddSongFile(event.target.files)
              event.currentTarget.value = ''
            }}
          />
          <label className="studio-upload-btn" htmlFor="studio-stem-upload">2) Add Stems To Mixer (max 10)</label>
          <input
            id="studio-stem-upload"
            type="file"
            accept="audio/*,.mp3,.wav,.aac,.m4a,.ogg"
            multiple
            onChange={(event) => {
              void onAddStemFiles(event.target.files)
              event.currentTarget.value = ''
            }}
          />
          <button type="button" onClick={() => void onGenerateChart()}>Auto-Generate Lyrics + Chords</button>
          <button type="button" onClick={() => void restoreCachedTracks()}>Restore Offline Tracks</button>
          {isGenerating ? <p className="studio-status">Extracting lyrics and chart...</p> : null}
          <button type="button" onClick={() => setEditMode((current) => !current)}>{editMode ? 'Exit Edit Mode' : 'Edit Sync'}</button>
          <button type="button" onClick={exportChart}>Export Chart</button>
          <label className="studio-upload-btn" htmlFor="studio-chart-import">Import Chart JSON</label>
          <input
            id="studio-chart-import"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void importChart(event.target.files?.[0] ?? null)
              event.currentTarget.value = ''
            }}
          />
        </div>
        <p className="studio-status">{statusText}</p>

        <label>
          Extraction source track
          <input type="text" value={songTrack?.name ?? 'No song loaded yet'} readOnly />
        </label>
        <p className="studio-status">
          Workflow: upload one clean song first, extract lyrics/chords, then add up to 10 stem channels for X18 routing.
        </p>
        <p className="studio-status">Offline cache: {cachedTracks.length} track(s) available. Stems: {stemTracks.length}/{MAX_STEM_CHANNELS} + master.</p>

        <div className="studio-manual-lyrics">
          <label htmlFor="manual-lyrics-input">Add Lyrics (manual fallback)</label>
          <textarea
            id="manual-lyrics-input"
            value={manualLyricsInput}
            onChange={(event) => setManualLyricsInput(event.target.value)}
            placeholder="Paste lyrics here (one line per phrase)."
          />
          <button type="button" onClick={onApplyManualLyrics}>Apply Manual Lyrics</button>
        </div>
      </article>

      <article className="studio-panel studio-transport">
        <div className="studio-transport-row">
          <button type="button" onClick={() => void startPlayback()} disabled={isPlaying}>Play</button>
          <button type="button" onClick={onPausePlayback} disabled={!isPlaying}>Pause</button>
          <button type="button" onClick={() => onSeek(0)}>Stop</button>
          <label>
            Capo
            <input type="number" min={0} max={12} value={capo} onChange={(event) => setCapo(Number(event.target.value) || 0)} />
          </label>
          <label>
            Transpose
            <input type="number" min={-6} max={6} value={transposeSemitones} onChange={(event) => setTransposeSemitones(Number(event.target.value) || 0)} />
          </label>
          <label>
            Sync offset (sec)
            <input type="number" min={-2} max={2} step={0.01} value={syncOffsetSec} onChange={(event) => setSyncOffsetSec(Number(event.target.value) || 0)} />
          </label>
          <label>
            Master
            <input type="range" min={0} max={1} step={0.01} value={masterVolume} onChange={(event) => setMasterVolume(Number(event.target.value))} />
          </label>
          <label>
            Route out
            <select value={masterRoutePreset} onChange={(event) => setMasterRoutePreset(event.target.value as OutputRoutePresetId)}>
              {Object.entries(OUTPUT_ROUTE_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label>
            Limiter on
            <input type="checkbox" checked={limiterEnabled} onChange={(event) => setLimiterEnabled(event.target.checked)} />
          </label>
          <label>
            Limiter preset
            <select value={limiterPreset} onChange={(event) => setLimiterPreset(event.target.value as LimiterPresetId)}>
              {Object.entries(LIMITER_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label>
            Ceiling (dB)
            <input
              type="number"
              min={-12}
              max={0}
              step={0.5}
              value={limiterCeilingDb}
              onChange={(event) => setLimiterCeilingDb(Number(event.target.value) || -1)}
            />
          </label>
          <label>
            Click BPM
            <input type="number" min={40} max={240} value={clickTrackBpm} onChange={(event) => setClickTrackBpm(Number(event.target.value) || 120)} />
          </label>
          <button type="button" onClick={() => void detectBeatFromSong()} disabled={isDetectingBeat}>
            {isDetectingBeat ? 'Detecting Beat...' : 'Detect Beat From Song'}
          </button>
          <label>
            Beats/bar
            <input type="number" min={1} max={12} value={clickTrackBeatsPerBar} onChange={(event) => setClickTrackBeatsPerBar(Number(event.target.value) || 4)} />
          </label>
          <label>
            Pre-intro bars
            <input type="number" min={0} max={8} value={clickTrackPreIntroBars} onChange={(event) => setClickTrackPreIntroBars(Number(event.target.value) || 0)} />
          </label>
          <label>
            Click vol
            <input type="range" min={0} max={1} step={0.01} value={clickTrackVolume} onChange={(event) => setClickTrackVolume(Number(event.target.value))} />
          </label>
          <label>
            Click on
            <input type="checkbox" checked={clickTrackEnabled} onChange={(event) => setClickTrackEnabled(event.target.checked)} />
          </label>
          <label>
            Loop section
            <select value={loopSectionId ?? ''} onChange={(event) => setLoopSectionId(event.target.value || null)}>
              <option value="">Off</option>
              {monitorSections.map((section) => (
                <option key={section.id} value={section.id}>{section.label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => onSeek(Math.max(0, (activeMonitorSection?.startSec ?? 0) - 0.01))}>Prev Section</button>
          <button type="button" onClick={() => onSeek(nextMonitorSection?.startSec ?? 0)}>Next Section</button>
          <button type="button" onClick={() => void connectMidi()}>{midiConnected ? 'MIDI Connected' : 'Connect MIDI'}</button>
          <button type="button" onClick={() => void startRecording()} disabled={isRecording}>Record</button>
          <button type="button" onClick={stopRecording} disabled={!isRecording}>Stop Rec</button>
          <button type="button" onClick={() => setPerformerMonitorEnabled((current) => !current)}>
            {performerMonitorEnabled ? 'Hide Performer Monitor' : 'Performer Monitor'}
          </button>
        </div>
        <label className="studio-seek">
          <span>{currentTimeSec.toFixed(2)}s / {totalDurationSec.toFixed(2)}s</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, totalDurationSec)}
            step={0.01}
            value={Math.min(currentTimeSec, Math.max(1, totalDurationSec))}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
        </label>
        {preCountBeatsRemaining !== null ? (
          <p className="studio-status">Count-in: {preCountBeatsRemaining + 1} beat(s) remaining</p>
        ) : null}
        <p className="studio-status">MIDI: {midiStatusText}</p>
        {loopSection ? <p className="studio-status">Loop active: {loopSection.label}</p> : null}
        {isRecording ? <p className="studio-status">Recording in progress...</p> : null}
      </article>

      <article className="studio-panel">
        <p className="panel-label">Pre-Gig Health Check</p>
        <p className="studio-status">{healthChecks.summary}</p>
        <div className="studio-health-grid" role="list" aria-label="Pre gig health checks">
          {healthChecks.entries.map((entry) => (
            <p key={entry.id} role="listitem" className={entry.pass ? 'studio-health-ok' : 'studio-health-warn'}>
              {entry.pass ? 'PASS' : 'CHECK'} {entry.label}
            </p>
          ))}
        </div>
      </article>

      <article className="studio-panel">
        <p className="panel-label">MIDI Foot Mapping</p>
        <div className="studio-midi-grid">
          <label>
            Play/Pause note
            <input
              type="number"
              min={0}
              max={127}
              value={midiMappings.playPause}
              onChange={(event) => setMidiMappings((current) => ({ ...current, playPause: Number(event.target.value) || 0 }))}
            />
          </label>
          <label>
            Stop note
            <input
              type="number"
              min={0}
              max={127}
              value={midiMappings.stop}
              onChange={(event) => setMidiMappings((current) => ({ ...current, stop: Number(event.target.value) || 0 }))}
            />
          </label>
          <label>
            Prev section note
            <input
              type="number"
              min={0}
              max={127}
              value={midiMappings.prevSection}
              onChange={(event) => setMidiMappings((current) => ({ ...current, prevSection: Number(event.target.value) || 0 }))}
            />
          </label>
          <label>
            Next section note
            <input
              type="number"
              min={0}
              max={127}
              value={midiMappings.nextSection}
              onChange={(event) => setMidiMappings((current) => ({ ...current, nextSection: Number(event.target.value) || 0 }))}
            />
          </label>
        </div>
      </article>

      {recordings.length > 0 ? (
        <article className="studio-panel">
          <p className="panel-label">Recordings</p>
          <div className="studio-recording-list" role="list" aria-label="Recordings">
            {recordings.map((clip) => (
              <div key={clip.id} className="studio-recording-row" role="listitem">
                <p>{clip.name}</p>
                <audio controls src={clip.objectUrl} />
                <a href={clip.objectUrl} download={`${clip.name}.webm`}>Download</a>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {performerMonitorEnabled ? (
        <article className="studio-panel performer-monitor" aria-label="Performer monitor">
          <div className="performer-monitor-head">
            <p>{songTrack?.name ?? 'No song loaded'}</p>
            <p>{totalDurationSec > 0 ? `-${remainingSongClock}` : '--:--'}</p>
          </div>

          <div className="performer-monitor-sections" role="tablist" aria-label="Song sections">
            {monitorSections.map((section, index) => {
              const isActive = index === activeMonitorSectionIndex
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={isActive ? 'monitor-section-tab monitor-section-active' : 'monitor-section-tab'}
                  onClick={() => onSeek(section.startSec)}
                >
                  <span>{section.label}</span>
                  {isActive ? (
                    <span className="monitor-section-progress" style={{ width: `${Math.round(activeSectionProgress * 100)}%` }} />
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="performer-wave-grid">
            <div className="performer-wave-lane performer-wave-lane-active">
              <p>{currentChordHighlight}</p>
              <div className="performer-wave-track" aria-hidden="true" />
              <small>{activeMonitorSection?.label ?? 'Current'}</small>
            </div>
            <div className="performer-wave-lane">
              <p>{nextChordHighlight}</p>
              <div className="performer-wave-track" aria-hidden="true" />
              <small>{nextMonitorSection?.label ?? 'Next'}</small>
            </div>
          </div>

          <div className="performer-monitor-controls">
            <div>
              <span>Key</span>
              <div>
                <button type="button" onClick={() => setTransposeSemitones((value) => value - 1)}>-</button>
                <p>{currentChordHighlight}</p>
                <button type="button" onClick={() => setTransposeSemitones((value) => value + 1)}>+</button>
              </div>
            </div>

            <div>
              <span>Section</span>
              <div>
                <button
                  type="button"
                  onClick={() => onSeek(Math.max(0, (activeMonitorSection?.startSec ?? 0) - 0.01))}
                >
                  Back
                </button>
                <p>{activeMonitorSection?.label ?? '--'}</p>
                <button type="button" onClick={() => onSeek(nextMonitorSection?.startSec ?? 0)}>Next</button>
              </div>
            </div>

            <div>
              <span>BPM</span>
              <div>
                <button type="button" onClick={() => setClickTrackBpm((value) => Math.max(40, value - 1))}>-</button>
                <p>{clickTrackBpm}</p>
                <button type="button" onClick={() => setClickTrackBpm((value) => Math.min(240, value + 1))}>+</button>
              </div>
            </div>
          </div>
        </article>
      ) : null}

      <article className="studio-panel studio-karaoke">
        <p className="panel-label">Live Lyric + Chord View</p>
        <div className="studio-chord-row" role="list" aria-label="Current line chords">
          {visibleChords.map((chord) => (
            <p key={chord.id} role="listitem" className={chord.isActive ? 'studio-chord-active' : ''}>{chord.symbol}</p>
          ))}
        </div>

        <div className="studio-current-line" aria-label="Current lyric line">
          {(currentLine?.words ?? []).map((word) => {
            const active = syncedTime >= word.startSec && syncedTime < word.endSec
            return (
              <span key={word.id} className={active ? 'studio-word-active' : ''}>{word.text}</span>
            )
          })}
          {!currentLine ? <span className="studio-placeholder">Current line will appear during playback.</span> : null}
        </div>

        <div className="studio-next-line" aria-label="Next lyric line">
          {(nextLine?.words ?? []).map((word) => (
            <span key={word.id}>{word.text}</span>
          ))}
          {!nextLine ? <span className="studio-placeholder">Next line preview appears here.</span> : null}
        </div>
      </article>

      <article className="studio-panel">
        <p className="panel-label">Stem Mixer (X18 Routing)</p>
        <div className="studio-track-list" role="list" aria-label="Audio tracks">
          {stemTracks.map((track) => (
            <div key={track.id} className="studio-track-row" role="listitem">
              <p>{track.name} · CH {track.channel ?? '-'}</p>
              <label>
                Vol
                <input type="range" min={0} max={1} step={0.01} value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} />
              </label>
              <label>
                Pan
                <input type="range" min={-1} max={1} step={0.01} value={track.pan} onChange={(event) => updateTrack(track.id, { pan: Number(event.target.value) })} />
              </label>
              <label>
                X18 channel
                <select
                  value={track.channel ?? ''}
                  onChange={(event) => updateTrack(track.id, { channel: Number(event.target.value) || null })}
                >
                  {Array.from({ length: MAX_STEM_CHANNELS }, (_, index) => index + 1).map((channel) => (
                    <option key={channel} value={channel}>CH {channel}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? 'Unmute' : 'Mute'}</button>
              <button type="button" onClick={() => updateTrack(track.id, { solo: !track.solo })}>{track.solo ? 'Unsolo' : 'Solo'}</button>
              <button type="button" onClick={() => removeTrack(track.id)}>Remove</button>
            </div>
          ))}
          {stemTracks.length === 0 ? <p className="studio-status">No stem tracks loaded yet.</p> : null}
        </div>
        <p className="studio-status">Master output is controlled in transport and sent as the +1 master path.</p>
      </article>

      {editMode ? (
        <article className="studio-panel">
          <p className="panel-label">Sync Edit Mode</p>
          <div className="studio-edit-list" role="list" aria-label="Sync lines">
            {chartLines.map((line) => (
              <div key={line.id} role="listitem" className="studio-edit-line">
                <div className="studio-edit-line-head">
                  <p>{line.words.map((word) => word.text).join(' ')}</p>
                  <div>
                    <button type="button" onClick={() => nudgeLine(line.id, -0.1)}>Nudge -0.1s</button>
                    <button type="button" onClick={() => nudgeLine(line.id, 0.1)}>Nudge +0.1s</button>
                  </div>
                </div>
                <div className="studio-edit-word-grid">
                  {line.words.map((word) => (
                    <label key={word.id}>
                      {word.text}
                      <div>
                        <input
                          type="number"
                          step={0.01}
                          value={word.startSec}
                          onChange={(event) => updateWordTiming(line.id, word.id, { startSec: Number(event.target.value) })}
                        />
                        <input
                          type="number"
                          step={0.01}
                          value={word.endSec}
                          onChange={(event) => updateWordTiming(line.id, word.id, { endSec: Number(event.target.value) })}
                        />
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {chartLines.length === 0 ? <p className="studio-status">Generate a chart to edit sync.</p> : null}
          </div>
        </article>
      ) : null}
    </section>
  )
}

export default SongStudioPage
