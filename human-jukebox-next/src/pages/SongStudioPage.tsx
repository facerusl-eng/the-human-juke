import { useEffect, useMemo, useRef, useState } from 'react'

const STUDIO_PROJECT_KEY = 'hj-next-song-studio-project-v1'

type StudioTrack = {
  id: string
  name: string
  file: File
  objectUrl: string
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
  tracks: PersistedTrack[]
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

function dbToGain(db: number) {
  return Math.pow(10, db / 20)
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
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map())
  const sourceNodesRef = useRef<NodeBundle[]>([])
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
  const [syncOffsetSec, setSyncOffsetSec] = useState(initialSnapshot?.syncOffsetSec ?? 0)
  const [clickTrackEnabled, setClickTrackEnabled] = useState(true)
  const [clickTrackBpm, setClickTrackBpm] = useState(120)
  const [clickTrackBeatsPerBar, setClickTrackBeatsPerBar] = useState(4)
  const [clickTrackPreIntroBars, setClickTrackPreIntroBars] = useState(1)
  const [clickTrackVolume, setClickTrackVolume] = useState(0.45)
  const [preCountBeatsRemaining, setPreCountBeatsRemaining] = useState<number | null>(null)

  const leadTrack = tracks[0] ?? null
  const totalDurationSec = leadTrack?.durationSec ?? 0

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const persistedTracks: PersistedTrack[] = tracks.map((track) => ({
      id: track.id,
      name: track.name,
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
      tracks: persistedTracks,
    }

    window.localStorage.setItem(STUDIO_PROJECT_KEY, JSON.stringify(snapshot))
  }, [
    capo,
    chartLines,
    limiterCeilingDb,
    limiterEnabled,
    limiterPreset,
    masterRoutePreset,
    masterVolume,
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
      file: new File([], `${track.name} (metadata only)`),
      objectUrl: '',
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
    return () => {
      stopPlayback()

      if (audioContextRef.current) {
        void audioContextRef.current.close()
      }

      tracks.forEach((track) => {
        URL.revokeObjectURL(track.objectUrl)
      })
    }
  }, [])

  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      const context = new AudioContext()
      const masterInput = context.createGain()
      const limiter = context.createDynamicsCompressor()
      const masterOutput = context.createGain()

      masterInput.connect(limiter)
      limiter.connect(masterOutput)
      masterOutput.connect(context.destination)

      masterInputGainRef.current = masterInput
      limiterNodeRef.current = limiter
      masterOutputGainRef.current = masterOutput
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

  const onAddTrackFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      return
    }

    const acceptedFiles = Array.from(fileList).filter((file) => /audio\/(mpeg|wav|x-wav|mp3|aac|ogg)/i.test(file.type) || /\.(mp3|wav|aac|m4a|ogg)$/i.test(file.name))

    if (acceptedFiles.length === 0) {
      setStatusText('Only audio files (WAV/MP3/AAC/OGG) are supported.')
      return
    }

    const context = ensureAudioContext()
    const nextTracks: StudioTrack[] = []

    for (const file of acceptedFiles) {
      const buffer = await decodeAudioDuration(context, file)
      const objectUrl = URL.createObjectURL(file)
      const id = createId('track')

      buffersRef.current.set(id, buffer)

      nextTracks.push({
        id,
        name: file.name,
        file,
        objectUrl,
        durationSec: buffer.duration,
        volume: 0.9,
        pan: 0,
        muted: false,
        solo: false,
      })
    }

    setTracks((current) => [...current, ...nextTracks])
    setStatusText(`${nextTracks.length} track(s) loaded. Run auto-generate to build lyric/chord sync.`)
  }

  const onGenerateChart = async () => {
    setIsGenerating(true)

    try {
      const chart = await requestAutoChart(leadTrack)
      setChartLines(chart.lines)
      setCurrentTimeSec(0)
      setStatusText(chart.statusMessage)
    } finally {
      setIsGenerating(false)
    }
  }

  const onApplyManualLyrics = () => {
    if (!leadTrack) {
      setStatusText('Upload a lead track first, then add manual lyrics.')
      return
    }

    const chart = buildChartFromLyrics(manualLyricsInput, leadTrack.durationSec)
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
    if (tracks.length === 0) {
      setStatusText('Upload at least one audio file first.')
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

    const hasSolo = tracks.some((track) => track.solo)

    sourceNodesRef.current = tracks.flatMap((track) => {
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
        <h2>Upload audio, auto-generate chart, and perform with synced lyrics/chords</h2>
        <p>
          WAV/MP3 import, two-line karaoke flow, sync editor, capo + transpose, and stem mixer for backing tracks.
        </p>
      </header>

      <article className="studio-panel">
        <div className="studio-upload-row">
          <label className="studio-upload-btn" htmlFor="studio-audio-upload">Upload Lead/Stem Tracks</label>
          <input
            id="studio-audio-upload"
            type="file"
            accept="audio/*,.mp3,.wav,.aac,.m4a,.ogg"
            multiple
            onChange={(event) => {
              void onAddTrackFiles(event.target.files)
              event.currentTarget.value = ''
            }}
          />
          <button type="button" onClick={() => void onGenerateChart()}>Auto-Generate Lyrics + Chords</button>
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
      </article>

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
        <p className="panel-label">Stem Mixer</p>
        <div className="studio-track-list" role="list" aria-label="Audio tracks">
          {tracks.map((track) => (
            <div key={track.id} className="studio-track-row" role="listitem">
              <p>{track.name}</p>
              <label>
                Vol
                <input type="range" min={0} max={1} step={0.01} value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} />
              </label>
              <label>
                Pan
                <input type="range" min={-1} max={1} step={0.01} value={track.pan} onChange={(event) => updateTrack(track.id, { pan: Number(event.target.value) })} />
              </label>
              <button type="button" onClick={() => updateTrack(track.id, { muted: !track.muted })}>{track.muted ? 'Unmute' : 'Mute'}</button>
              <button type="button" onClick={() => updateTrack(track.id, { solo: !track.solo })}>{track.solo ? 'Unsolo' : 'Solo'}</button>
              <button type="button" onClick={() => removeTrack(track.id)}>Remove</button>
            </div>
          ))}
          {tracks.length === 0 ? <p className="studio-status">No tracks loaded yet.</p> : null}
        </div>
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
