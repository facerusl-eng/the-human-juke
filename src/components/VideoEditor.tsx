import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent } from 'react'
import { transcodeWebmToMp4 } from '../lib/mp4Export'

type VideoFormatId = 'instagram-story' | 'instagram-feed-square' | 'instagram-feed-portrait' | 'tiktok' | 'reels'
type TemplateId = 'bold-neon' | 'sunset-clean' | 'studio-minimal'
type MusicSourceId = 'none' | 'preset' | 'upload'
type MusicPresetId = 'upbeat-pop' | 'electro-night' | 'cinematic-rise'
type OverlayKey = 'title' | 'info'

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

type TimelineSegment = {
  image: EditorImage
  start: number
  end: number
  duration: number
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
const OVERLAY_SNAP_THRESHOLD = 0.02
const OVERLAY_SNAP_POINTS = [0.12, 0.2, 1 / 3, 0.5, 2 / 3, 0.72, 0.82]

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

function snapToGuide(value: number, points: number[], threshold = OVERLAY_SNAP_THRESHOLD) {
  let snappedValue = value
  let bestDistance = threshold

  for (const point of points) {
    const distance = Math.abs(value - point)
    if (distance <= bestDistance) {
      snappedValue = point
      bestDistance = distance
    }
  }

  return snappedValue
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

function copyTextToClipboard(text: string) {
  if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return Promise.reject(new Error('Clipboard is not available on this device.'))
  }

  return navigator.clipboard.writeText(text)
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
  const draggingOverlayRef = useRef<OverlayKey | null>(null)

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
  const [imageWeights, setImageWeights] = useState<Record<string, number>>({})
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [eventNameOverlay, setEventNameOverlay] = useState(eventName)
  const [eventDateOverlay, setEventDateOverlay] = useState(eventDate)
  const [venueOverlay, setVenueOverlay] = useState(venue)
  const [ctaOverlay, setCtaOverlay] = useState(ctaText)
  const [overlayAnchors, setOverlayAnchors] = useState({ titleY: 0.14, infoY: 0.7 })
  const [snapToGridEnabled, setSnapToGridEnabled] = useState(true)
  const [activeOverlayHandle, setActiveOverlayHandle] = useState<OverlayKey | null>(null)
  const [caption, setCaption] = useState('')
  const [script, setScript] = useState('')
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [lastExportedFile, setLastExportedFile] = useState<File | null>(null)

  const activeFormat = useMemo(
    () => VIDEO_FORMATS.find((format) => format.id === videoFormatId) ?? VIDEO_FORMATS[0],
    [videoFormatId],
  )

  const activeTemplate = useMemo(
    () => VIDEO_TEMPLATES.find((template) => template.id === templateId) ?? VIDEO_TEMPLATES[0],
    [templateId],
  )

  const hasMusic = musicSource === 'preset' || (musicSource === 'upload' && Boolean(musicUploadUrl))

  useEffect(() => {
    setImageWeights((current) => {
      const next: Record<string, number> = {}
      images.forEach((image) => {
        next[image.id] = current[image.id] && current[image.id] > 0 ? current[image.id] : 1
      })
      return next
    })
  }, [images])

  const timelineSegments = useMemo<TimelineSegment[]>(() => {
    if (images.length === 0) {
      return []
    }

    const safeWeights = images.map((image) => Math.max(0.25, imageWeights[image.id] ?? 1))
    const totalWeight = safeWeights.reduce((sum, value) => sum + value, 0)
    let cursor = 0

    return images.map((image, index) => {
      const duration = durationSeconds * (safeWeights[index] / Math.max(totalWeight, 0.0001))
      const start = cursor
      const end = start + duration
      cursor = end
      return { image, start, end, duration }
    })
  }, [durationSeconds, imageWeights, images])

  const timelineTotal = useMemo(
    () => timelineSegments.reduce((sum, segment) => sum + segment.duration, 0),
    [timelineSegments],
  )

  const appendImageFiles = useCallback((fileList: FileList | File[]) => {
    const availableSlots = Math.max(0, MAX_UPLOAD_IMAGES - images.length)
    if (availableSlots === 0) {
      setExportError(`Maximum ${MAX_UPLOAD_IMAGES} images reached.`)
      return
    }

    const imageFiles = Array.from(fileList)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, availableSlots)

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
        if (clean.length === 0) {
          return
        }

        setImages((current) => [...current, ...clean])
      })
      .catch(() => {
        setExportError('Some images could not be loaded. Try another file.')
      })
  }, [images.length])

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

  const drawFrame = useCallback((ctx: CanvasRenderingContext2D, currentSecond: number, showGuides = false) => {
    const W = activeFormat.width
    const H = activeFormat.height
    const PAD = Math.round(W * 0.06)
    const totalDuration = Math.max(timelineTotal, 0.0001)

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, W, H)

    if (timelineSegments.length > 0) {
      const normalizedSecond = ((currentSecond % totalDuration) + totalDuration) % totalDuration
      const currentSegment = timelineSegments.find((segment) => normalizedSecond >= segment.start && normalizedSecond < segment.end)
        ?? timelineSegments[timelineSegments.length - 1]
      const currentIndex = timelineSegments.findIndex((segment) => segment.image.id === currentSegment.image.id)
      const nextSegment = timelineSegments[(currentIndex + 1) % timelineSegments.length]
      const localSecond = normalizedSecond - currentSegment.start
      const localT = localSecond / Math.max(currentSegment.duration, 0.0001)
      const transitionStart = clamp(1 - transitionSeconds / Math.max(currentSegment.duration, 0.0001), 0, 1)
      const blend = localT > transitionStart
        ? clamp((localT - transitionStart) / Math.max(1 - transitionStart, 0.0001), 0, 1)
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

      const motion = easeInOut(localT)
      drawCoverImage(currentSegment.image.src, 1, motion)
      if (blend > 0) {
        drawCoverImage(nextSegment.image.src, blend, 1 - motion)
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

    const titleAppear = clamp(currentSecond / Math.max(totalDuration * 0.2, 0.001), 0, 1)
    const bodyAppear = clamp((currentSecond - totalDuration * 0.12) / Math.max(totalDuration * 0.2, 0.001), 0, 1)

    const titleY = Math.round(H * overlayAnchors.titleY + (1 - titleAppear) * 40)
    const infoY = Math.round(H * overlayAnchors.infoY + (1 - bodyAppear) * 20)

    ctx.save()
    ctx.globalAlpha = titleAppear
    ctx.font = activeTemplate.titleFont
    ctx.fillStyle = '#f8fafc'
    ctx.textBaseline = 'top'
    ctx.fillText(eventNameOverlay || eventName, PAD, titleY, W - PAD * 2)
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = bodyAppear
    ctx.font = activeTemplate.subtitleFont
    ctx.fillStyle = '#e2e8f0'
    ctx.textBaseline = 'top'
    ctx.fillText(eventDateOverlay || eventDate, PAD, infoY, W - PAD * 2)
    ctx.fillText(venueOverlay || venue, PAD, infoY + 52, W - PAD * 2)

    const ctaBoxY = Math.min(H - 96, infoY + 124)
    const ctaTextValue = ctaOverlay || ctaText
    ctx.fillStyle = activeTemplate.accent
    ctx.fillRect(PAD, ctaBoxY, W - PAD * 2, 72)
    ctx.fillStyle = '#0f172a'
    ctx.font = '700 34px system-ui, -apple-system, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText(ctaTextValue, PAD + 22, ctaBoxY + 36, W - PAD * 2 - 44)
    ctx.restore()

    if (showGuides) {
      const drawSnapGrid = () => {
        ctx.save()
        ctx.lineWidth = 1
        ctx.setLineDash([5, 7])
        OVERLAY_SNAP_POINTS.forEach((point) => {
          const y = Math.round(H * point)
          ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)'
          ctx.beginPath()
          ctx.moveTo(PAD * 0.35, y)
          ctx.lineTo(W - PAD * 0.35, y)
          ctx.stroke()
        })
        ctx.restore()
      }

      const drawGuide = (yRatio: number, key: OverlayKey, label: string) => {
        const y = Math.round(H * yRatio)
        ctx.save()
        ctx.strokeStyle = activeOverlayHandle === key ? '#67e8f9' : 'rgba(148, 163, 184, 0.9)'
        ctx.lineWidth = 2
        ctx.setLineDash([8, 6])
        ctx.beginPath()
        ctx.moveTo(PAD * 0.6, y)
        ctx.lineTo(W - PAD * 0.6, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = activeOverlayHandle === key ? '#67e8f9' : 'rgba(226, 232, 240, 0.95)'
        ctx.beginPath()
        ctx.arc(W - PAD * 0.6, y, 8, 0, Math.PI * 2)
        ctx.fill()
        ctx.font = '600 20px system-ui, -apple-system, sans-serif'
        ctx.fillText(label, PAD * 0.6, y - 26)
        ctx.restore()
      }

      if (snapToGridEnabled) {
        drawSnapGrid()
      }

      drawGuide(overlayAnchors.titleY, 'title', 'Title')
      drawGuide(overlayAnchors.infoY, 'info', 'Info + CTA')
    }
  }, [
    activeFormat.height,
    activeFormat.width,
    activeOverlayHandle,
    activeTemplate,
    ctaOverlay,
    ctaText,
    eventDate,
    eventDateOverlay,
    eventName,
    eventNameOverlay,
    snapToGridEnabled,
    overlayAnchors.infoY,
    overlayAnchors.titleY,
    timelineSegments,
    timelineTotal,
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
      drawFrame(ctx, (elapsedSeconds / PREVIEW_LOOP_SECONDS) * Math.max(timelineTotal, durationSeconds), true)
      renderClockRef.current = window.requestAnimationFrame(renderLoop)
    }

    renderClockRef.current = window.requestAnimationFrame(renderLoop)

    return () => {
      if (renderClockRef.current !== null) {
        window.cancelAnimationFrame(renderClockRef.current)
        renderClockRef.current = null
      }
    }
  }, [activeFormat.height, activeFormat.width, drawFrame, durationSeconds, timelineTotal])

  useEffect(() => {
    return () => {
      if (uploadMusicObjectUrlRef.current) {
        URL.revokeObjectURL(uploadMusicObjectUrlRef.current)
        uploadMusicObjectUrlRef.current = null
      }
    }
  }, [])

  const updateOverlayFromPointer = useCallback((pointerEvent: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current
    const target = draggingOverlayRef.current

    if (!canvas || !target) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    if (rect.height <= 0) {
      return
    }

    const yRatio = clamp((pointerEvent.clientY - rect.top) / rect.height, 0.08, 0.9)
    const nextY = snapToGridEnabled ? snapToGuide(yRatio, OVERLAY_SNAP_POINTS) : yRatio

    setOverlayAnchors((current) => {
      if (target === 'title') {
        const titleY = clamp(nextY, 0.08, current.infoY - 0.2)
        return { ...current, titleY }
      }

      const infoY = clamp(nextY, current.titleY + 0.2, 0.86)
      return { ...current, infoY }
    })
  }, [snapToGridEnabled])

  const handlePreviewPointerDown = useCallback((pointerEvent: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current
    if (!canvas) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const yRatio = clamp((pointerEvent.clientY - rect.top) / Math.max(rect.height, 1), 0, 1)
    const titleDistance = Math.abs(yRatio - overlayAnchors.titleY)
    const infoDistance = Math.abs(yRatio - overlayAnchors.infoY)
    const target: OverlayKey = titleDistance <= infoDistance ? 'title' : 'info'

    if (Math.min(titleDistance, infoDistance) > 0.08) {
      return
    }

    draggingOverlayRef.current = target
    setActiveOverlayHandle(target)
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
    updateOverlayFromPointer(pointerEvent)
  }, [overlayAnchors.infoY, overlayAnchors.titleY, updateOverlayFromPointer])

  const handlePreviewPointerMove = useCallback((pointerEvent: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingOverlayRef.current) {
      return
    }

    updateOverlayFromPointer(pointerEvent)
  }, [updateOverlayFromPointer])

  const handlePreviewPointerUp = useCallback((pointerEvent: ReactPointerEvent<HTMLCanvasElement>) => {
    if (draggingOverlayRef.current) {
      pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId)
    }

    draggingOverlayRef.current = null
    setActiveOverlayHandle(null)
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
    setShareError(null)
    setShareStatus(null)

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
      const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
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

      const timelineDuration = Math.max(timelineTotal, durationSeconds)
      const startMs = performance.now()
      await new Promise<void>((resolve) => {
        const tick = (now: number) => {
          const elapsed = (now - startMs) / 1000
          if (elapsed >= timelineDuration) {
            drawFrame(ctx, timelineDuration, false)
            resolve()
            return
          }

          drawFrame(ctx, elapsed, false)
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

      const fileName = `${sanitizeSlug(eventName)}-${activeFormat.ratioLabel.replace(':', 'x')}-${Math.round(timelineDuration)}s.mp4`
      const file = new File([mp4Blob], fileName, { type: 'video/mp4' })
      setLastExportedFile(file)

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

      setExportStatus('MP4 export completed. You can now share directly below.')
      window.setTimeout(() => setExportStatus(null), 7000)
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
    drawFrame,
    durationSeconds,
    eventName,
    exporting,
    hasMusic,
    images.length,
    musicPresetId,
    musicSource,
    musicUploadUrl,
    timelineTotal,
  ])

  const removeImage = useCallback((id: string) => {
    setImages((current) => {
      const next = current.filter((entry) => entry.id !== id)
      setActiveImageIndex((index) => clamp(index, 0, Math.max(0, next.length - 1)))
      return next
    })

    setImageWeights((current) => {
      const next = { ...current }
      delete next[id]
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

  const normalizeTimelineWeights = useCallback(() => {
    setImageWeights(() => Object.fromEntries(images.map((image) => [image.id, 1])))
  }, [images])

  const shareExportedVideo = useCallback(async () => {
    if (!lastExportedFile) {
      setShareError('Export a video first before sharing.')
      return
    }

    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
      setShareError('Native share is not available on this device. Use the downloaded file to post manually.')
      return
    }

    try {
      if (!navigator.canShare({ files: [lastExportedFile] })) {
        setShareError('This device cannot share files from the browser. Use the downloaded file manually.')
        return
      }

      await navigator.share({
        files: [lastExportedFile],
        title: `${eventName} promo video`,
        text: caption || ctaOverlay || ctaText,
      })
      setShareStatus('Share sheet opened successfully.')
      setShareError(null)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      setShareError(error instanceof Error ? error.message : 'Could not open share sheet.')
    }
  }, [caption, ctaOverlay, ctaText, eventName, lastExportedFile])

  const copyCaption = useCallback(async () => {
    const text = caption || `${eventName} - ${eventDate} at ${venue}. ${ctaOverlay || ctaText}`
    try {
      await copyTextToClipboard(text)
      setShareStatus('Caption copied to clipboard.')
      setShareError(null)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not copy caption.')
    }
  }, [caption, ctaOverlay, ctaText, eventDate, eventName, venue])

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

          <div className="video-editor-timeline-wrap">
            <div className="video-editor-section-row">
              <span className="video-editor-section-title">Timeline Blocks</span>
              <button type="button" className="ghost-button" onClick={normalizeTimelineWeights}>Auto Balance</button>
            </div>
            <div className="video-editor-timeline-bar">
              {timelineSegments.map((segment, index) => (
                <div
                  key={segment.image.id}
                  className="video-editor-timeline-segment"
                  style={{ width: `${(segment.duration / Math.max(timelineTotal, 0.001)) * 100}%` }}
                >
                  <span>{index + 1}</span>
                </div>
              ))}
            </div>
            <div className="video-editor-timeline-controls">
              {timelineSegments.map((segment, index) => (
                <label key={segment.image.id} className="promote-field">
                  <span>{`Clip ${index + 1}: ${segment.image.name} (${segment.duration.toFixed(1)}s)`}</span>
                  <input
                    type="range"
                    min="0.5"
                    max="6"
                    step="0.1"
                    value={imageWeights[segment.image.id] ?? 1}
                    onChange={(event) => setImageWeights((current) => ({
                      ...current,
                      [segment.image.id]: Number.parseFloat(event.target.value),
                    }))}
                  />
                </label>
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
              <span>Overlay Snap</span>
              <div className="promote-checkbox-group">
                <input
                  id="video-overlay-snap"
                  type="checkbox"
                  checked={snapToGridEnabled}
                  onChange={(event) => setSnapToGridEnabled(event.target.checked)}
                />
                <label htmlFor="video-overlay-snap">Snap drag handles to thirds/center guides</label>
              </div>
            </label>
            <p className="field-hint video-editor-drag-hint">Drag "Title" and "Info + CTA" guide lines inside preview to reposition text overlays.</p>
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

          <div className="video-editor-share-hooks">
            <span className="video-editor-section-title">Share Hooks</span>
            <div className="video-editor-share-actions">
              <button type="button" className="secondary-button" onClick={() => void shareExportedVideo()} disabled={!lastExportedFile}>
                Share Exported Video
              </button>
              <button type="button" className="secondary-button" onClick={() => void copyCaption()}>
                Copy Caption
              </button>
              <a className="secondary-button video-editor-link-btn" href="https://www.instagram.com/create/select/" target="_blank" rel="noreferrer noopener">Open Instagram Upload</a>
              <a className="secondary-button video-editor-link-btn" href="https://www.tiktok.com/upload" target="_blank" rel="noreferrer noopener">Open TikTok Upload</a>
              <a className="secondary-button video-editor-link-btn" href="https://www.facebook.com/reel/create" target="_blank" rel="noreferrer noopener">Open Facebook Reels</a>
            </div>
            {shareStatus ? <p className="field-hint">{shareStatus}</p> : null}
            {shareError ? <p className="error-text no-margin-bottom">{shareError}</p> : null}
          </div>
        </div>

        <div className="video-editor-preview-pane">
          <div className="video-editor-preview-header">
            <p>Preview</p>
            <span>{activeFormat.width}x{activeFormat.height} - {activeFormat.ratioLabel} - {timelineTotal.toFixed(1)}s</span>
          </div>
          <div className="video-editor-preview-frame">
            <canvas
              ref={previewCanvasRef}
              className="video-editor-preview-canvas"
              onPointerDown={handlePreviewPointerDown}
              onPointerMove={handlePreviewPointerMove}
              onPointerUp={handlePreviewPointerUp}
              onPointerCancel={handlePreviewPointerUp}
            />
          </div>
          <p className="field-hint">Tip: Use 9:16 for Stories, Reels, and TikTok. Use 1:1 or 4:5 for feed posts.</p>
          <p className="field-hint">Event ID: {eventId}</p>
        </div>
      </div>
    </section>
  )
}
