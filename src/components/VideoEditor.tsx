import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { transcodeWebmToMp4 } from '../lib/mp4Export'

type VideoFormatId = 'instagram-story' | 'instagram-feed-square' | 'instagram-feed-portrait' | 'tiktok' | 'reels'
type TemplateId = 'bold-neon' | 'sunset-clean' | 'studio-minimal'
type MusicSourceId = 'none' | 'preset' | 'upload'
type MusicPresetId = 'upbeat-pop' | 'electro-night' | 'cinematic-rise'

type VideoEditorProps = {
  eventId: string
  eventName: string
  eventDate: string
  venue: string
  ctaText: string
  initialImageDataUrls?: string[]
  defaultTheme?: 'sunset' | 'midnight' | 'studio' | 'none'
}

type EditorImage = {
  id: string
  name: string
  src: string
}

type VideoTemplate = {
  id: TemplateId
  name: string
  accent: string
  overlayTop: string
  overlayBottom: string
  titleFont: string
  subtitleFont: string
}

type VideoFormat = {
  id: VideoFormatId
  name: string
  width: number
  height: number
  ratioLabel: string
}

type AiSuggestionPayload = {
  templateId?: TemplateId
  musicStyle?: MusicPresetId
  caption?: string
  script?: string
}

const VIDEO_FORMATS: VideoFormat[] = [
  { id: 'instagram-story', name: 'Instagram Story', width: 1080, height: 1920, ratioLabel: '9:16' },
  { id: 'instagram-feed-square', name: 'Instagram/Facebook Feed Square', width: 1080, height: 1080, ratioLabel: '1:1' },
  { id: 'instagram-feed-portrait', name: 'Instagram/Facebook Feed Portrait', width: 1080, height: 1350, ratioLabel: '4:5' },
  { id: 'tiktok', name: 'TikTok', width: 1080, height: 1920, ratioLabel: '9:16' },
  { id: 'reels', name: 'Reels', width: 1080, height: 1920, ratioLabel: '9:16' },
]

const VIDEO_TEMPLATES: VideoTemplate[] = [
  {
    id: 'bold-neon',
    name: 'Bold Neon',
    accent: '#67e8f9',
    overlayTop: 'rgba(15, 23, 42, 0.25)',
    overlayBottom: 'rgba(8, 47, 73, 0.68)',
    titleFont: '700 78px system-ui, -apple-system, sans-serif',
    subtitleFont: '500 42px system-ui, -apple-system, sans-serif',
  },
  {
    id: 'sunset-clean',
    name: 'Sunset Clean',
    accent: '#fed7aa',
    overlayTop: 'rgba(120, 53, 15, 0.22)',
    overlayBottom: 'rgba(124, 45, 18, 0.64)',
    titleFont: '700 76px Georgia, serif',
    subtitleFont: '500 40px Georgia, serif',
  },
  {
    id: 'studio-minimal',
    name: 'Studio Minimal',
    accent: '#a7f3d0',
    overlayTop: 'rgba(6, 78, 59, 0.20)',
    overlayBottom: 'rgba(6, 95, 70, 0.60)',
    titleFont: '700 76px system-ui, -apple-system, sans-serif',
    subtitleFont: '500 38px system-ui, -apple-system, sans-serif',
  },
]

const MUSIC_PRESETS: Array<{ id: MusicPresetId; name: string; bpm: number; rootHz: number }> = [
  { id: 'upbeat-pop', name: 'Upbeat Pop', bpm: 118, rootHz: 220 },
  { id: 'electro-night', name: 'Electro Night', bpm: 124, rootHz: 164.81 },
  { id: 'cinematic-rise', name: 'Cinematic Rise', bpm: 96, rootHz: 146.83 },
]

const MAX_UPLOAD_IMAGES = 12
const PREVIEW_LOOP_SECONDS = 8

function createImageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function sanitizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'promo-video'
}

function easeInOut(t: number) {
  return t * t * (3 - 2 * t)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function parseAiSuggestion(reply: string): AiSuggestionPayload {
  const jsonMatch = reply.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {}
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as AiSuggestionPayload
    return parsed
  } catch {
    return {}
  }
}

function createPresetMusicEngine(
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  preset: MusicPresetId,
) {
  const presetConfig = MUSIC_PRESETS.find((entry) => entry.id === preset) ?? MUSIC_PRESETS[0]
  const masterGain = audioContext.createGain()
  masterGain.gain.value = 0.07
  masterGain.connect(destination)

  const intervalMs = Math.max(180, Math.round((60 / presetConfig.bpm) * 1000))
  let timerId: number | null = null

  const triggerNote = () => {
    const oscillator = audioContext.createOscillator()
    const noteGain = audioContext.createGain()
    const randomOffset = (Math.random() * 3) - 1
    oscillator.frequency.value = presetConfig.rootHz * (1 + randomOffset * 0.02)
    oscillator.type = preset === 'cinematic-rise' ? 'triangle' : 'sawtooth'

    noteGain.gain.setValueAtTime(0.0001, audioContext.currentTime)
    noteGain.gain.exponentialRampToValueAtTime(0.2, audioContext.currentTime + 0.03)
    noteGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.25)

    oscillator.connect(noteGain)
    noteGain.connect(masterGain)

    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.3)
  }

  return {
    async start() {
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      triggerNote()
      timerId = window.setInterval(triggerNote, intervalMs)
    },
    stop() {
      if (timerId !== null) {
        window.clearInterval(timerId)
        timerId = null
      }

      masterGain.disconnect()
    },
  }
}

async function loadUploadedAudioEngine(
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  fileUrl: string,
) {
  const audio = new Audio(fileUrl)
  audio.loop = true
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'

  const source = audioContext.createMediaElementSource(audio)
  const gain = audioContext.createGain()
  gain.gain.value = 0.32

  source.connect(gain)
  gain.connect(destination)

  return {
    async start() {
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      audio.currentTime = 0
      await audio.play()
    },
    stop() {
      audio.pause()
      audio.currentTime = 0
      source.disconnect()
      gain.disconnect()
    },
  }
}

export default function VideoEditor({
  eventId,
  eventName,
  eventDate,
  venue,
  ctaText,
  initialImageDataUrls = [],
  defaultTheme = 'sunset',
}: VideoEditorProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderClockRef = useRef<number | null>(null)
  const uploadMusicObjectUrlRef = useRef<string | null>(null)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())

  const [videoFormatId, setVideoFormatId] = useState<VideoFormatId>('instagram-story')
  const [durationSeconds, setDurationSeconds] = useState(15)
  const [transitionSeconds, setTransitionSeconds] = useState(0.6)
  const [templateId, setTemplateId] = useState<TemplateId>(() => (
    defaultTheme === 'studio' ? 'studio-minimal' : defaultTheme === 'midnight' ? 'bold-neon' : 'sunset-clean'
  ))
  const [musicSource, setMusicSource] = useState<MusicSourceId>('none')
  const [musicPresetId, setMusicPresetId] = useState<MusicPresetId>('upbeat-pop')
  const [musicUploadName, setMusicUploadName] = useState('')
  const [musicUploadUrl, setMusicUploadUrl] = useState<string | null>(null)
  const [images, setImages] = useState<EditorImage[]>(() => initialImageDataUrls.map((src, index) => ({
    id: createImageId(),
    name: `Image ${index + 1}`,
    src,
  })))
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [eventNameOverlay, setEventNameOverlay] = useState(eventName)
  const [eventDateOverlay, setEventDateOverlay] = useState(eventDate)
  const [venueOverlay, setVenueOverlay] = useState(venue)
  const [ctaOverlay, setCtaOverlay] = useState(ctaText)
  const [caption, setCaption] = useState('')
  const [script, setScript] = useState('')
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const activeFormat = useMemo(
    () => VIDEO_FORMATS.find((format) => format.id === videoFormatId) ?? VIDEO_FORMATS[0],
    [videoFormatId],
  )

  const activeTemplate = useMemo(
    () => VIDEO_TEMPLATES.find((template) => template.id === templateId) ?? VIDEO_TEMPLATES[0],
    [templateId],
  )

  const hasMusic = musicSource === 'preset' || (musicSource === 'upload' && Boolean(musicUploadUrl))

  const appendImageFiles = useCallback((fileList: FileList | File[]) => {
    const imageFiles = Array.from(fileList)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, MAX_UPLOAD_IMAGES)

    if (imageFiles.length === 0) {
      return
    }

    const readers = imageFiles.map((file) => new Promise<EditorImage>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        resolve({
          id: createImageId(),
          name: file.name,
          src: typeof reader.result === 'string' ? reader.result : '',
        })
      }
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
      reader.readAsDataURL(file)
    }))

    void Promise.all(readers)
      .then((loadedImages) => {
        const clean = loadedImages.filter((entry) => Boolean(entry.src))
        setImages((current) => [...current, ...clean].slice(0, MAX_UPLOAD_IMAGES))
      })
      .catch(() => {
        setExportError('Some images could not be loaded. Try another file.')
      })
  }, [])

  const handleImageInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) {
      return
    }

    appendImageFiles(event.target.files)
    event.target.value = ''
  }, [appendImageFiles])

  const handleMusicUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    if (!nextFile) {
      return
    }

    if (uploadMusicObjectUrlRef.current) {
      URL.revokeObjectURL(uploadMusicObjectUrlRef.current)
      uploadMusicObjectUrlRef.current = null
    }

    const nextUrl = URL.createObjectURL(nextFile)
    uploadMusicObjectUrlRef.current = nextUrl
    setMusicUploadUrl(nextUrl)
    setMusicUploadName(nextFile.name)
    setMusicSource('upload')
    event.target.value = ''
  }, [])

  const drawFrame = useCallback((ctx: CanvasRenderingContext2D, currentSecond: number) => {
    const W = activeFormat.width
    const H = activeFormat.height
    const PAD = Math.round(W * 0.06)

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, W, H)

    if (images.length > 0) {
      const clipDuration = durationSeconds / images.length
      const baseIndex = Math.min(images.length - 1, Math.floor(currentSecond / Math.max(clipDuration, 0.001)))
      const nextIndex = (baseIndex + 1) % images.length
      const localT = (currentSecond % Math.max(clipDuration, 0.001)) / Math.max(clipDuration, 0.001)
      const transitionBlend = localT > (1 - transitionSeconds / Math.max(clipDuration, 0.001))
        ? clamp((localT - (1 - transitionSeconds / Math.max(clipDuration, 0.001))) / Math.max(transitionSeconds / Math.max(clipDuration, 0.001), 0.001), 0, 1)
        : 0

      const drawCoverImage = (source: string, alpha: number, animationAmount: number) => {
        const image = imageCacheRef.current.get(source)
        if (!image || !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
          return
        }

        const scale = 1.02 + animationAmount * 0.04
        const drawW = W * scale
        const drawH = H * scale
        const dx = (W - drawW) / 2
        const dy = (H - drawH) / 2

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.drawImage(image, dx, dy, drawW, drawH)
        ctx.restore()
      }

      const movement = easeInOut(localT)
      drawCoverImage(images[baseIndex].src, 1, movement)
      if (transitionBlend > 0 && images[nextIndex]) {
        drawCoverImage(images[nextIndex].src, transitionBlend, 1 - movement)
      }
    }

    const topGradient = ctx.createLinearGradient(0, 0, 0, H * 0.6)
    topGradient.addColorStop(0, activeTemplate.overlayTop)
    topGradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = topGradient
    ctx.fillRect(0, 0, W, H)

    const bottomGradient = ctx.createLinearGradient(0, H * 0.4, 0, H)
    bottomGradient.addColorStop(0, 'rgba(0,0,0,0)')
    bottomGradient.addColorStop(1, activeTemplate.overlayBottom)
    ctx.fillStyle = bottomGradient
    ctx.fillRect(0, 0, W, H)

    const titleAppear = clamp(currentSecond / Math.max(durationSeconds * 0.2, 0.001), 0, 1)
    const bodyAppear = clamp((currentSecond - durationSeconds * 0.12) / Math.max(durationSeconds * 0.2, 0.001), 0, 1)

    ctx.save()
    ctx.globalAlpha = titleAppear
    ctx.font = activeTemplate.titleFont
    ctx.fillStyle = '#f8fafc'
    ctx.textBaseline = 'top'
    const titleY = Math.round(H * 0.14 + (1 - titleAppear) * 40)
    ctx.fillText(eventNameOverlay || eventName, PAD, titleY, W - PAD * 2)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = bodyAppear
    ctx.font = activeTemplate.subtitleFont
    ctx.fillStyle = '#e2e8f0'
    ctx.textBaseline = 'top'
    const infoY = Math.round(H * 0.70 + (1 - bodyAppear) * 20)
    ctx.fillText(eventDateOverlay || eventDate, PAD, infoY, W - PAD * 2)
    ctx.fillText(venueOverlay || venue, PAD, infoY + 52, W - PAD * 2)

    const ctaBoxY = infoY + 124
    const ctaTextValue = ctaOverlay || ctaText
    ctx.fillStyle = activeTemplate.accent
    ctx.fillRect(PAD, ctaBoxY, W - PAD * 2, 72)
    ctx.fillStyle = '#0f172a'
    ctx.font = '700 34px system-ui, -apple-system, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText(ctaTextValue, PAD + 22, ctaBoxY + 36, W - PAD * 2 - 44)
    ctx.restore()
  }, [
    activeFormat.height,
    activeFormat.width,
    activeTemplate,
    ctaOverlay,
    ctaText,
    durationSeconds,
    eventDate,
    eventDateOverlay,
    eventName,
    eventNameOverlay,
    images,
    transitionSeconds,
    venue,
    venueOverlay,
  ])

  useEffect(() => {
    const cache = imageCacheRef.current
    const activeSources = new Set(images.map((entry) => entry.src))

    images.forEach((entry) => {
      if (cache.has(entry.src)) {
        return
      }

      const image = new Image()
      image.src = entry.src
      cache.set(entry.src, image)
    })

    Array.from(cache.keys()).forEach((source) => {
      if (!activeSources.has(source)) {
        cache.delete(source)
      }
    })
  }, [images])

  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas) {
      return
    }

    canvas.width = activeFormat.width
    canvas.height = activeFormat.height

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const startMs = performance.now()
    const renderLoop = (now: number) => {
      const elapsedSeconds = ((now - startMs) / 1000) % PREVIEW_LOOP_SECONDS
      drawFrame(ctx, (elapsedSeconds / PREVIEW_LOOP_SECONDS) * durationSeconds)
      renderClockRef.current = window.requestAnimationFrame(renderLoop)
    }

    renderClockRef.current = window.requestAnimationFrame(renderLoop)

    return () => {
      if (renderClockRef.current !== null) {
        window.cancelAnimationFrame(renderClockRef.current)
        renderClockRef.current = null
      }
    }
  }, [activeFormat.height, activeFormat.width, drawFrame, durationSeconds])

  useEffect(() => {
    return () => {
      if (uploadMusicObjectUrlRef.current) {
        URL.revokeObjectURL(uploadMusicObjectUrlRef.current)
        uploadMusicObjectUrlRef.current = null
      }
    }
  }, [])

  const runAiAssist = useCallback(async (autoAssemble: boolean) => {
    if (aiLoading) {
      return
    }

    setAiLoading(true)
    setAiError(null)

    const eventTypeHint = /wedding|bryllup/i.test(eventName)
      ? 'wedding'
      : /corporate|firma|business/i.test(eventName)
      ? 'corporate'
      : /karaoke|sing/i.test(eventName)
      ? 'karaoke'
      : 'live music event'

    const prompt = `Return strict JSON with keys templateId, musicStyle, caption, script.\n\nContext:\n- Event type: ${eventTypeHint}\n- Event: ${eventName}\n- Venue: ${venue}\n- Date: ${eventDate}\n- CTA: ${ctaText}\n\nAllowed templateId values: ${VIDEO_TEMPLATES.map((template) => template.id).join(', ')}\nAllowed musicStyle values: ${MUSIC_PRESETS.map((preset) => preset.id).join(', ')}\nCaption max 180 chars. Script max 3 short lines.`

    try {
      const response = await fetch('/api/ai-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managerId: 'brian',
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      const payload = await response.json() as { reply?: string; error?: string }

      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || 'AI assistant unavailable right now.')
      }

      const suggestion = parseAiSuggestion(payload.reply)

      if (suggestion.templateId && VIDEO_TEMPLATES.some((template) => template.id === suggestion.templateId)) {
        setTemplateId(suggestion.templateId)
      }

      if (suggestion.musicStyle && MUSIC_PRESETS.some((entry) => entry.id === suggestion.musicStyle)) {
        setMusicPresetId(suggestion.musicStyle)
        if (autoAssemble) {
          setMusicSource('preset')
        }
      }

      if (suggestion.caption) {
        setCaption(suggestion.caption)
      }

      if (suggestion.script) {
        setScript(suggestion.script)
      }

      if (autoAssemble) {
        if (!eventNameOverlay.trim()) {
          setEventNameOverlay(eventName)
        }
        if (!eventDateOverlay.trim()) {
          setEventDateOverlay(eventDate)
        }
        if (!venueOverlay.trim()) {
          setVenueOverlay(venue)
        }
        if (!ctaOverlay.trim()) {
          setCtaOverlay(ctaText)
        }
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI suggestions failed.')
    } finally {
      setAiLoading(false)
    }
  }, [
    aiLoading,
    ctaOverlay,
    ctaText,
    eventDate,
    eventDateOverlay,
    eventName,
    eventNameOverlay,
    venue,
    venueOverlay,
  ])

  const exportVideo = useCallback(async () => {
    if (exporting) {
      return
    }

    const canvas = previewCanvasRef.current
    if (!canvas) {
      setExportError('Preview surface is unavailable.')
      return
    }

    if (images.length === 0) {
      setExportError('Please add at least one image before exporting.')
      return
    }

    setExporting(true)
    setExportError(null)
    setExportStatus('Preparing recording...')

    let audioContext: AudioContext | null = null
    let audioEngine: { start: () => Promise<void> | void; stop: () => void } | null = null

    try {
      const fps = 24
      const stream = canvas.captureStream(fps)
      const mediaTracks: MediaStreamTrack[] = [...stream.getVideoTracks()]

      if (hasMusic) {
        audioContext = new AudioContext()
        const destination = audioContext.createMediaStreamDestination()

        if (musicSource === 'preset') {
          audioEngine = createPresetMusicEngine(audioContext, destination, musicPresetId)
        } else if (musicSource === 'upload' && musicUploadUrl) {
          audioEngine = await loadUploadedAudioEngine(audioContext, destination, musicUploadUrl)
        }

        if (audioEngine) {
          await audioEngine.start()
          mediaTracks.push(...destination.stream.getAudioTracks())
        }
      }

      const outputStream = new MediaStream(mediaTracks)

      const mimeCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
      const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? 'video/webm'

      const recorder = new MediaRecorder(outputStream, { mimeType })
      const chunks: BlobPart[] = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      const recordDone = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve()
        recorder.onerror = (event) => reject(event.error ?? new Error('Media recorder failed.'))
      })

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Canvas context unavailable.')
      }

      recorder.start(1000)
      setExportStatus('Recording video track...')

      const startMs = performance.now()
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          const elapsed = (now - startMs) / 1000
          if (elapsed >= durationSeconds) {
            drawFrame(ctx, durationSeconds)
            resolve()
            return
          }

          drawFrame(ctx, elapsed)
          window.requestAnimationFrame(tick)
        }

        window.requestAnimationFrame(tick)
      })

      recorder.stop()
      await recordDone
      outputStream.getTracks().forEach((track) => track.stop())

      const webmBlob = new Blob(chunks, { type: mimeType })
      if (!webmBlob.size) {
        throw new Error('Recording failed and produced an empty file.')
      }

      setExportStatus('Converting to MP4 (optimized for social)...')

      const mp4Blob = await transcodeWebmToMp4(webmBlob, {
        hasAudio: hasMusic,
        onStatus: (status) => {
          if (/Error|failed/i.test(status)) {
            return
          }

          setExportStatus(`Converting to MP4... ${status}`)
        },
      })

      const fileName = `${sanitizeSlug(eventName)}-${activeFormat.ratioLabel.replace(':', 'x')}-${durationSeconds}s.mp4`
      const fileUrl = URL.createObjectURL(mp4Blob)

      try {
        const link = document.createElement('a')
        link.href = fileUrl
        link.download = fileName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(fileUrl), 30_000)
      }

      setExportStatus('MP4 export completed. Check your downloads.')
      window.setTimeout(() => setExportStatus(null), 6000)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Video export failed.')
      setExportStatus(null)
    } finally {
      if (audioEngine) {
        audioEngine.stop()
      }

      if (audioContext) {
        void audioContext.close()
      }

      setExporting(false)
    }
  }, [
    activeFormat.ratioLabel,
    ctaText,
    drawFrame,
    durationSeconds,
    eventName,
    exporting,
    hasMusic,
    images.length,
    musicPresetId,
    musicSource,
    musicUploadUrl,
  ])

  const removeImage = useCallback((id: string) => {
    setImages((current) => {
      const next = current.filter((entry) => entry.id !== id)
      setActiveImageIndex((index) => clamp(index, 0, Math.max(0, next.length - 1)))
      return next
    })
  }, [])

  const onDropImages = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingFiles(false)
    if (!event.dataTransfer.files?.length) {
      return
    }

    appendImageFiles(event.dataTransfer.files)
  }, [appendImageFiles])

  return (
    <section className="video-editor-shell" aria-label="Promo video editor">
      <div className="video-editor-head">
        <h3>Create Promo Video</h3>
        <span className="meta-badge">Built-In Editor</span>
      </div>
      <p className="subcopy">
        Design a short social promo with images, animated overlays, optional music, AI-assisted templates, and MP4 export.
      </p>

      <div className="video-editor-layout">
        <div className="video-editor-controls">
          <label className="promote-field">
            <span>Output</span>
            <select value={videoFormatId} onChange={(event) => setVideoFormatId(event.target.value as VideoFormatId)}>
              {VIDEO_FORMATS.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name} ({entry.ratioLabel})</option>
              ))}
            </select>
          </label>

          <label className="promote-field">
            <span>Duration ({durationSeconds}s)</span>
            <input
              type="range"
              min="8"
              max="30"
              step="1"
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number.parseInt(event.target.value, 10))}
            />
          </label>

          <label className="promote-field">
            <span>Transition ({transitionSeconds.toFixed(1)}s fade)</span>
            <input
              type="range"
              min="0.2"
              max="1.4"
              step="0.1"
              value={transitionSeconds}
              onChange={(event) => setTransitionSeconds(Number.parseFloat(event.target.value))}
            />
          </label>

          <label className="promote-field">
            <span>Template</span>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value as TemplateId)}>
              {VIDEO_TEMPLATES.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.name}</option>
              ))}
            </select>
          </label>

          <div className="video-editor-ai-row">
            <button type="button" className="secondary-button" onClick={() => void runAiAssist(false)} disabled={aiLoading}>
              {aiLoading ? 'Thinking...' : 'AI Suggest Template + Caption'}
            </button>
            <button type="button" className="secondary-button" onClick={() => void runAiAssist(true)} disabled={aiLoading}>
              {aiLoading ? 'Thinking...' : 'AI Auto-Assemble Draft'}
            </button>
          </div>
          {aiError ? <p className="error-text no-margin-bottom">{aiError}</p> : null}

          <div className="video-editor-dropzone-wrap">
            <span className="video-editor-section-title">Event Images (drag & drop)</span>
            <div
              className={`video-editor-dropzone ${isDraggingFiles ? 'video-editor-dropzone-active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDraggingFiles(true)
              }}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDrop={onDropImages}
            >
              <p>Drop images here or choose files.</p>
              <input type="file" accept="image/*" multiple onChange={handleImageInput} />
            </div>
            <div className="video-editor-image-list">
              {images.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`video-editor-thumb ${index === activeImageIndex ? 'video-editor-thumb-active' : ''}`}
                  onClick={() => setActiveImageIndex(index)}
                >
                  <img src={entry.src} alt={entry.name} />
                  <span>{entry.name}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="video-editor-thumb-remove"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeImage(entry.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        removeImage(entry.id)
                      }
                    }}
                  >
                    Remove
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="video-editor-text-fields">
            <label className="promote-field promote-field-wide">
              <span>Event Name Overlay</span>
              <input value={eventNameOverlay} onChange={(event) => setEventNameOverlay(event.target.value)} />
            </label>
            <label className="promote-field">
              <span>Date Overlay</span>
              <input value={eventDateOverlay} onChange={(event) => setEventDateOverlay(event.target.value)} />
            </label>
            <label className="promote-field">
              <span>Venue Overlay</span>
              <input value={venueOverlay} onChange={(event) => setVenueOverlay(event.target.value)} />
            </label>
            <label className="promote-field promote-field-wide">
              <span>CTA Overlay</span>
              <input value={ctaOverlay} onChange={(event) => setCtaOverlay(event.target.value)} />
            </label>
            <label className="promote-field promote-field-wide">
              <span>Caption (AI or manual)</span>
              <textarea value={caption} rows={3} onChange={(event) => setCaption(event.target.value)} />
            </label>
            <label className="promote-field promote-field-wide">
              <span>Short Script (voiceover guide)</span>
              <textarea value={script} rows={3} onChange={(event) => setScript(event.target.value)} />
            </label>
          </div>

          <div className="video-editor-music-panel">
            <span className="video-editor-section-title">Background Music</span>
            <label className="promote-field">
              <span>Music Source</span>
              <select value={musicSource} onChange={(event) => setMusicSource(event.target.value as MusicSourceId)}>
                <option value="none">No music</option>
                <option value="preset">Preset library</option>
                <option value="upload">Upload local file</option>
              </select>
            </label>

            {musicSource === 'preset' ? (
              <label className="promote-field">
                <span>Preset Style</span>
                <select value={musicPresetId} onChange={(event) => setMusicPresetId(event.target.value as MusicPresetId)}>
                  {MUSIC_PRESETS.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {musicSource === 'upload' ? (
              <label className="promote-field">
                <span>Upload Music File</span>
                <input type="file" accept="audio/*" onChange={handleMusicUpload} />
                {musicUploadName ? <p className="field-hint">Loaded: {musicUploadName}</p> : null}
              </label>
            ) : null}
          </div>

          <div className="video-editor-export-row">
            <button type="button" className="primary-button" onClick={() => void exportVideo()} disabled={exporting}>
              {exporting ? 'Exporting MP4...' : 'Export MP4'}
            </button>
            <span className="field-hint">Optimized for social media uploads.</span>
          </div>
          {exportStatus ? <p className="promote-export-status">{exportStatus}</p> : null}
          {exportError ? <p className="error-text no-margin-bottom">{exportError}</p> : null}
        </div>

        <div className="video-editor-preview-pane">
          <div className="video-editor-preview-header">
            <p>Preview</p>
            <span>{activeFormat.width}x{activeFormat.height} • {activeFormat.ratioLabel}</span>
          </div>
          <div className="video-editor-preview-frame">
            <canvas ref={previewCanvasRef} className="video-editor-preview-canvas" />
          </div>
          <p className="field-hint">Tip: Use 9:16 for Stories, Reels, and TikTok. Use 1:1 or 4:5 for feed posts.</p>
          <p className="field-hint">Event ID: {eventId}</p>
        </div>
      </div>
    </section>
  )
}
