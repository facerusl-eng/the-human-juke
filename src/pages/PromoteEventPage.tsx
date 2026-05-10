import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import VideoEditor from '../components/VideoEditor'
import { getAudienceUrl } from '../lib/audienceUrl'
import { prepareFeedImage } from '../lib/feedImage'
import { useQueueStore } from '../state/queueStore'

type PostFormat = 'square' | 'portrait' | 'story'
type SocialPlatform = 'instagram' | 'facebook'
type ThemeKey = 'none' | 'sunset' | 'midnight' | 'studio'
type HeadlinePosition = 'top' | 'center' | 'bottom'
type TextShadow = 'none' | 'light' | 'medium' | 'strong'
type FontChoice = 'default' | 'serif' | 'slab' | 'mono'
type TextFrame = 'none' | 'light' | 'dark' | 'auto'
type MobileDockSection = 'preview' | 'basics' | 'export' | 'tools' | 'video'

type HeadlineAnchor = {
  x: number
  y: number
}

type Theme = {
  key: ThemeKey
  name: string
}

type PromotionDraft = {
  title: string
  subtitle: string
  eventName: string
  venue: string
  eventDate: string
  ctaText: string
  description: string
  format: PostFormat
  platform: SocialPlatform
  theme: ThemeKey
  headlinePosition: HeadlinePosition
  headlineAnchor: HeadlineAnchor
  textScale: number
  textBold: boolean
  textShadow: TextShadow
  fontChoice: FontChoice
  textFrame: TextFrame
  framePadding: number
  textColor: string
  photoContrast: number
  photoBrightnessAdj: number
  photoSaturation: number
}

type SaveFilePickerHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>
    close: () => Promise<void>
  }>
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<SaveFilePickerHandle>
}

const PROMOTION_DRAFT_STORAGE_KEY_PREFIX = 'human-jukebox-promo-draft:'
const PROMOTION_VIDEO_DURATION_SECONDS = 30

const THEMES: Theme[] = [
  {
    key: 'none',
    name: 'No Theme',
  },
  {
    key: 'sunset',
    name: 'Sunset Stage',
  },
  {
    key: 'midnight',
    name: 'Midnight Neon',
  },
  {
    key: 'studio',
    name: 'Studio Glow',
  },
]

const FORMAT_CLASS_MAP: Record<PostFormat, string> = {
  square: 'promote-canvas-square',
  portrait: 'promote-canvas-portrait',
  story: 'promote-canvas-story',
}

const THEME_CLASS_MAP: Record<ThemeKey, string> = {
  none: 'promote-theme-none',
  sunset: 'promote-theme-sunset',
  midnight: 'promote-theme-midnight',
  studio: 'promote-theme-studio',
}

function PromoteEventPage() {
  const { event, hostEvents, setEventAudienceNoGigVisibility } = useQueueStore()
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia('(max-width: 1024px)').matches
  })
  const previewRef = useRef<HTMLElement | null>(null)
  const controlsPanelRef = useRef<HTMLElement | null>(null)
  const exportPanelRef = useRef<HTMLDivElement | null>(null)
  const toolsPanelRef = useRef<HTMLElement | null>(null)
  const videoPanelRef = useRef<HTMLElement | null>(null)
  const headlineRef = useRef<HTMLDivElement | null>(null)
  const dragActiveRef = useRef(false)
  const photoObjectUrlRef = useRef<string | null>(null)
  const photoDataUrlRef = useRef<string | null>(null)
  const initializingDraftRef = useRef(false)
  const [format, setFormat] = useState<PostFormat>('portrait')
  const [platform, setPlatform] = useState<SocialPlatform>('instagram')
  const [theme, setTheme] = useState<ThemeKey>('sunset')
  const [headlinePosition, setHeadlinePosition] = useState<HeadlinePosition>('center')
  const [headlineAnchor, setHeadlineAnchor] = useState<HeadlineAnchor>({ x: 50, y: 50 })
  const [headlineDragging, setHeadlineDragging] = useState(false)
  const [textScale, setTextScale] = useState(1)
  const [title, setTitle] = useState('Live Music, Made Interactive')
  const [subtitle, setSubtitle] = useState('Audience requests + live voting + host control')
  const [eventName, setEventName] = useState('The Human Jukebox Experience')
  const [venue, setVenue] = useState('Your Venue Here')
  const [eventDate, setEventDate] = useState('Saturday · 20:00')
  const [ctaText, setCtaText] = useState('Join the show at the-human-jukebox.org')
  const [description, setDescription] = useState(
    'Turn your audience into active participants with real-time song requests and voting.',
  )
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [exportingImage, setExportingImage] = useState(false)
  const [exportingVideo, setExportingVideo] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [videoStatus, setVideoStatus] = useState<string | null>(null)
  const [audienceVisibilitySaving, setAudienceVisibilitySaving] = useState(false)
  const [audienceVisibilitySaved, setAudienceVisibilitySaved] = useState(false)
  const [audienceVisibilityError, setAudienceVisibilityError] = useState<string | null>(null)
  const [facebookLinkCopied, setFacebookLinkCopied] = useState(false)
  const [facebookShareError, setFacebookShareError] = useState<string | null>(null)
  const [selectedPromotionEventId, setSelectedPromotionEventId] = useState('')
  const [showVideoEditor, setShowVideoEditor] = useState(false)
  const [showMobileAdvancedControls, setShowMobileAdvancedControls] = useState(false)
  const [eventFilterQuery, setEventFilterQuery] = useState('')
  const [promotionSaved, setPromotionSaved] = useState(false)
  const [promotionSaveError, setPromotionSaveError] = useState<string | null>(null)
  const [textBold, setTextBold] = useState(false)
  const [textShadow, setTextShadow] = useState<TextShadow>('light')
  const [fontChoice, setFontChoice] = useState<FontChoice>('default')
  const [textFrame, setTextFrame] = useState<TextFrame>('auto')
  const [framePadding, setFramePadding] = useState(0.65)
  const [textColor, setTextColor] = useState('#f8fafc')
  const [photoContrast, setPhotoContrast] = useState(1.15)
  const [photoBrightnessAdj, setPhotoBrightnessAdj] = useState(1.25)
  const [photoSaturation, setPhotoSaturation] = useState(1.1)
  const [mobileDockActive, setMobileDockActive] = useState<MobileDockSection>('preview')
  const [photoBrightness, setPhotoBrightness] = useState<number | null>(null)
  const [photoBusyness, setPhotoBusyness] = useState<number | null>(null)

  const filteredHostEvents = useMemo(() => {
    const normalizedQuery = eventFilterQuery.trim().toLowerCase()

    if (!normalizedQuery) {
      return hostEvents
    }

    return hostEvents.filter((hostEvent) => {
      const name = hostEvent.name.toLowerCase()
      const venue = (hostEvent.venue ?? '').toLowerCase()
      return name.includes(normalizedQuery) || venue.includes(normalizedQuery)
    })
  }, [hostEvents, eventFilterQuery])

  const selectedHostEvent = useMemo(() => {
    const normalizedEventId = selectedPromotionEventId.trim()

    if (normalizedEventId) {
      const matchedEvent = hostEvents.find((hostEvent) => hostEvent.id === normalizedEventId)

      if (matchedEvent) {
        return matchedEvent
      }
    }

    return hostEvents.find((hostEvent) => hostEvent.id === event?.id) ?? null
  }, [hostEvents, selectedPromotionEventId, event?.id])

  const selectedEventId = selectedHostEvent?.id ?? event?.id ?? ''

  const activeTheme = useMemo(
    () => THEMES.find((item) => item.key === theme) ?? THEMES[0],
    [theme],
  )

  const targetDimensions = useMemo(() => {
    const platformDimensions: Record<SocialPlatform, Record<PostFormat, { width: number; height: number }>> = {
      instagram: {
        square: { width: 1080, height: 1080 },
        portrait: { width: 1080, height: 1350 },
        story: { width: 1080, height: 1920 },
      },
      facebook: {
        square: { width: 1200, height: 1200 },
        portrait: { width: 1200, height: 1500 },
        story: { width: 1080, height: 1920 },
      },
    }

    return platformDimensions[platform][format]
  }, [platform, format])

  useEffect(() => {
    if (!selectedPromotionEventId && event?.id) {
      setSelectedPromotionEventId(event.id)
    }
  }, [selectedPromotionEventId, event?.id])

  useEffect(() => {
    if (!selectedEventId) {
      setShowVideoEditor(false)
    }
  }, [selectedEventId])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 1024px)')
    const onViewportChange = (event: MediaQueryListEvent) => setIsMobileViewport(event.matches)

    setIsMobileViewport(mediaQuery.matches)
    mediaQuery.addEventListener('change', onViewportChange)

    return () => {
      mediaQuery.removeEventListener('change', onViewportChange)
    }
  }, [])

  useEffect(() => {
    if (!isMobileViewport) {
      setShowMobileAdvancedControls(false)
    }
  }, [isMobileViewport])

  useEffect(() => {
    if (!isMobileViewport || typeof window === 'undefined') {
      return
    }

    let rafId = 0

    const updateActiveDockFromScroll = () => {
      rafId = 0
      const viewportAnchor = Math.round(window.innerHeight * 0.26)

      const sections: Array<{ key: MobileDockSection; ref: React.RefObject<HTMLElement | null> }> = [
        { key: 'preview', ref: previewRef },
        { key: 'basics', ref: controlsPanelRef },
        { key: 'export', ref: exportPanelRef },
        { key: 'tools', ref: toolsPanelRef },
      ]

      if (showVideoEditor && selectedEventId) {
        sections.push({ key: 'video', ref: videoPanelRef })
      }

      let bestSection: MobileDockSection = mobileDockActive
      let bestDistance = Number.POSITIVE_INFINITY

      for (const section of sections) {
        const sectionNode = section.ref.current

        if (!sectionNode) {
          continue
        }

        const rect = sectionNode.getBoundingClientRect()
        const sectionTop = rect.top
        const sectionBottom = rect.bottom
        const isInViewportBand = sectionTop <= viewportAnchor && sectionBottom >= viewportAnchor
        const distance = isInViewportBand ? 0 : Math.min(Math.abs(sectionTop - viewportAnchor), Math.abs(sectionBottom - viewportAnchor))

        if (distance < bestDistance) {
          bestDistance = distance
          bestSection = section.key
        }
      }

      if (bestSection !== mobileDockActive) {
        setMobileDockActive(bestSection)
      }
    }

    const queueUpdate = () => {
      if (rafId) {
        return
      }

      rafId = window.requestAnimationFrame(updateActiveDockFromScroll)
    }

    queueUpdate()
    window.addEventListener('scroll', queueUpdate, { passive: true })
    window.addEventListener('resize', queueUpdate)

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }

      window.removeEventListener('scroll', queueUpdate)
      window.removeEventListener('resize', queueUpdate)
    }
  }, [isMobileViewport, mobileDockActive, selectedEventId, showVideoEditor])

  useEffect(() => {
    if (!selectedEventId) {
      return
    }

    const storageKey = `${PROMOTION_DRAFT_STORAGE_KEY_PREFIX}${selectedEventId}`
    const savedDraftText = window.localStorage.getItem(storageKey)
    const defaultEventDate = 'Saturday · 20:00'

    setPromotionSaveError(null)
    initializingDraftRef.current = true

    try {
      if (savedDraftText) {
        const draft = JSON.parse(savedDraftText) as Partial<PromotionDraft>
        setTitle(draft.title ?? 'Live Music, Made Interactive')
        setSubtitle(draft.subtitle ?? 'Audience requests + live voting + host control')
        setEventName(draft.eventName ?? selectedHostEvent?.name ?? 'The Human Jukebox Experience')
        setVenue(draft.venue ?? selectedHostEvent?.venue ?? '')
        setEventDate(draft.eventDate ?? defaultEventDate)
        setCtaText(draft.ctaText ?? 'Join the show at the-human-jukebox.org')
        setDescription(draft.description ?? 'Turn your audience into active participants with real-time song requests and voting.')
        setFormat(draft.format ?? 'portrait')
        setPlatform(draft.platform ?? 'instagram')
        setTheme(draft.theme ?? 'sunset')
        setHeadlinePosition(draft.headlinePosition ?? 'center')
        setHeadlineAnchor(draft.headlineAnchor ?? { x: 50, y: 50 })
        setTextScale(typeof draft.textScale === 'number' ? draft.textScale : 1)
        setTextBold(draft.textBold ?? false)
        setTextShadow(draft.textShadow ?? 'light')
        setFontChoice(draft.fontChoice ?? 'default')
        setTextFrame(draft.textFrame ?? 'auto')
        setFramePadding(typeof draft.framePadding === 'number' ? draft.framePadding : 0.65)
        setTextColor(draft.textColor ?? '#f8fafc')
        setPhotoContrast(typeof draft.photoContrast === 'number' ? draft.photoContrast : 1.15)
        setPhotoBrightnessAdj(typeof draft.photoBrightnessAdj === 'number' ? draft.photoBrightnessAdj : 1.25)
        setPhotoSaturation(typeof draft.photoSaturation === 'number' ? draft.photoSaturation : 1.1)
        return
      }

      setEventName(selectedHostEvent?.name ?? 'The Human Jukebox Experience')
      setVenue(selectedHostEvent?.venue ?? '')
      setEventDate(defaultEventDate)
    } catch {
      setPromotionSaveError('Could not load saved promotion for this event.')
    } finally {
      window.setTimeout(() => {
        initializingDraftRef.current = false
      }, 0)
    }
  }, [selectedEventId, selectedHostEvent?.name, selectedHostEvent?.venue])

  const analyzeImageMetrics = async (imageUrl: string) => {
    try {
      const image = new Image()

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Could not load image for brightness analysis.'))
        image.src = imageUrl
      })

      const sampleMaxDimension = 120
      const largestDimension = Math.max(image.naturalWidth, image.naturalHeight)
      const scale = largestDimension > sampleMaxDimension ? sampleMaxDimension / largestDimension : 1
      const sampleWidth = Math.max(1, Math.round(image.naturalWidth * scale))
      const sampleHeight = Math.max(1, Math.round(image.naturalHeight * scale))

      const sampleCanvas = document.createElement('canvas')
      sampleCanvas.width = sampleWidth
      sampleCanvas.height = sampleHeight

      const context = sampleCanvas.getContext('2d')

      if (!context) {
        return null
      }

      context.drawImage(image, 0, 0, sampleWidth, sampleHeight)
      const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight)

      const luminanceValues = new Array<number>(sampleWidth * sampleHeight)
      let luminanceTotal = 0

      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const pixelIndex = (y * sampleWidth + x)
          const dataIndex = pixelIndex * 4
          const red = data[dataIndex] / 255
          const green = data[dataIndex + 1] / 255
          const blue = data[dataIndex + 2] / 255
          const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
          luminanceValues[pixelIndex] = luminance
          luminanceTotal += luminance
        }
      }

      const sampleCount = luminanceValues.length

      if (!sampleCount || sampleWidth < 2 || sampleHeight < 2) {
        return null
      }

      let luminanceDiffTotal = 0
      let diffCount = 0

      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const index = y * sampleWidth + x
          const current = luminanceValues[index]

          if (x + 1 < sampleWidth) {
            luminanceDiffTotal += Math.abs(current - luminanceValues[index + 1])
            diffCount += 1
          }

          if (y + 1 < sampleHeight) {
            luminanceDiffTotal += Math.abs(current - luminanceValues[index + sampleWidth])
            diffCount += 1
          }
        }
      }

      const brightness = luminanceTotal / sampleCount
      const busyness = diffCount ? luminanceDiffTotal / diffCount : 0

      return {
        brightness,
        busyness,
      }
    } catch {
      return null
    }
  }

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]
    event.target.value = ''

    if (!nextFile) {
      return
    }

    setExportError(null)
    setPhotoBrightness(null)
    setPhotoBusyness(null)

    if (photoObjectUrlRef.current) {
      URL.revokeObjectURL(photoObjectUrlRef.current)
      photoObjectUrlRef.current = null
    }

    try {
      const preparedPhotoDataUrl = await prepareFeedImage(nextFile)

      photoDataUrlRef.current = preparedPhotoDataUrl
      setPhotoUrl(preparedPhotoDataUrl)

      const metrics = await analyzeImageMetrics(preparedPhotoDataUrl)
      setPhotoBrightness(metrics?.brightness ?? null)
      setPhotoBusyness(metrics?.busyness ?? null)
    } catch (error) {
      photoDataUrlRef.current = null
      setPhotoUrl(null)
      setExportError(error instanceof Error ? error.message : 'Could not prepare that photo. Please try a different file.')
    }
  }

  const resolvedTextFrame = useMemo<'none' | 'light' | 'dark'>(() => {
    if (textFrame === 'none' || textFrame === 'light' || textFrame === 'dark') {
      return textFrame
    }

    if (photoBrightness === null) {
      return 'dark'
    }

    if (photoBrightness >= 0.52) {
      return 'dark'
    }

    if ((photoBusyness ?? 0) >= 0.16) {
      return 'dark'
    }

    return 'light'
  }, [photoBrightness, photoBusyness, textFrame])

  const autoFrameHint = useMemo(() => {
    if (textFrame !== 'auto') {
      return null
    }

    if (photoBrightness === null) {
      return 'Auto picks Dark Background until a photo is uploaded.'
    }

    const reason = resolvedTextFrame === 'dark'
      ? (photoBrightness >= 0.52
        ? 'bright photo'
        : (photoBusyness ?? 0) >= 0.16
          ? 'busy photo'
          : 'safety default')
      : 'low brightness and low visual noise'

    return `Auto picked: ${resolvedTextFrame === 'dark' ? 'Dark Background' : 'Light Background'} (${reason})`
  }, [photoBrightness, photoBusyness, resolvedTextFrame, textFrame])

  const captionPreview = useMemo(() => {
    return `${eventName}\n${description}\n${ctaText}`
  }, [ctaText, description, eventName])

  const audienceShareUrl = useMemo(() => {
    return getAudienceUrl(selectedEventId || null, { compact: true, includeVersion: true })
  }, [selectedEventId])

  const facebookShareUrl = useMemo(() => {
    if (!audienceShareUrl) {
      return ''
    }

    const shareUrl = new URL('https://www.facebook.com/sharer/sharer.php')
    shareUrl.searchParams.set('u', audienceShareUrl)

    const quoteText = `${eventName}\n${description}`.trim()

    if (quoteText) {
      shareUrl.searchParams.set('quote', quoteText)
    }

    return shareUrl.toString()
  }, [audienceShareUrl, description, eventName])

  const copyCaption = async () => {
    await navigator.clipboard.writeText(captionPreview)
  }

  useEffect(() => {
    if (!headlineRef.current) {
      return
    }

    headlineRef.current.style.setProperty('--headline-x', `${headlineAnchor.x}%`)
    headlineRef.current.style.setProperty('--headline-y', `${headlineAnchor.y}%`)
  }, [headlineAnchor])

  useEffect(() => {
    if (!previewRef.current) {
      return
    }

    previewRef.current.style.setProperty('--promote-text-scale', String(textScale))
  }, [textScale])

  useEffect(() => {
    if (!previewRef.current) {
      return
    }

    previewRef.current.style.setProperty('--promote-frame-padding', `${framePadding}rem`)
  }, [framePadding])

  useEffect(() => {
    if (!previewRef.current) {
      return
    }

    previewRef.current.style.setProperty('--promote-text-color', textColor)
  }, [textColor])

  useEffect(() => {
    if (!previewRef.current) {
      return
    }

    previewRef.current.style.setProperty(
      '--promote-photo-filter',
      `brightness(${photoBrightnessAdj}) contrast(${photoContrast}) saturate(${photoSaturation})`,
    )
  }, [photoBrightnessAdj, photoContrast, photoSaturation])

  const clampPercentage = (value: number, min = 8, max = 92) => Math.min(max, Math.max(min, value))

  const updateHeadlineAnchorFromPointer = useCallback((clientX: number, clientY: number) => {
    const canvas = previewRef.current

    if (!canvas) {
      return
    }

    const canvasRect = canvas.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return
    }

    const nextX = clampPercentage(((clientX - canvasRect.left) / canvasRect.width) * 100)
    const nextY = clampPercentage(((clientY - canvasRect.top) / canvasRect.height) * 100, 12, 73)
    setHeadlineAnchor({ x: nextX, y: nextY })
  }, [])

  const onHeadlinePointerMove = useCallback((pointerEvent: PointerEvent) => {
    if (!dragActiveRef.current) {
      return
    }

    updateHeadlineAnchorFromPointer(pointerEvent.clientX, pointerEvent.clientY)
  }, [updateHeadlineAnchorFromPointer])

  const stopHeadlineDrag = useCallback(() => {
    dragActiveRef.current = false
    setHeadlineDragging(false)
    window.removeEventListener('pointermove', onHeadlinePointerMove)
    window.removeEventListener('pointerup', stopHeadlineDrag)
    window.removeEventListener('pointercancel', stopHeadlineDrag)
  }, [onHeadlinePointerMove])

  const startHeadlineDrag = useCallback((pointerEvent: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerEvent.button !== 0) {
      return
    }

    pointerEvent.preventDefault()
    dragActiveRef.current = true
    setHeadlineDragging(true)
    updateHeadlineAnchorFromPointer(pointerEvent.clientX, pointerEvent.clientY)

    window.addEventListener('pointermove', onHeadlinePointerMove)
    window.addEventListener('pointerup', stopHeadlineDrag)
    window.addEventListener('pointercancel', stopHeadlineDrag)
  }, [onHeadlinePointerMove, stopHeadlineDrag, updateHeadlineAnchorFromPointer])

  const handleHeadlinePositionPreset = (nextPosition: HeadlinePosition) => {
    setHeadlinePosition(nextPosition)

    if (nextPosition === 'top') {
      setHeadlineAnchor({ x: 50, y: 24 })
      return
    }

    if (nextPosition === 'bottom') {
      setHeadlineAnchor({ x: 50, y: 64 })
      return
    }

    setHeadlineAnchor({ x: 50, y: 50 })
  }

  useEffect(() => {
    return () => {
      dragActiveRef.current = false
      setHeadlineDragging(false)
      window.removeEventListener('pointermove', onHeadlinePointerMove)
      window.removeEventListener('pointerup', stopHeadlineDrag)
      window.removeEventListener('pointercancel', stopHeadlineDrag)

      if (photoObjectUrlRef.current) {
        URL.revokeObjectURL(photoObjectUrlRef.current)
        photoObjectUrlRef.current = null
      }
    }
  }, [onHeadlinePointerMove, stopHeadlineDrag])

  useEffect(() => {
    if (!audienceVisibilitySaved) {
      return
    }

    const timerId = window.setTimeout(() => {
      setAudienceVisibilitySaved(false)
    }, 1800)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [audienceVisibilitySaved])

  useEffect(() => {
    if (!facebookLinkCopied) {
      return
    }

    const timerId = window.setTimeout(() => {
      setFacebookLinkCopied(false)
    }, 1800)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [facebookLinkCopied])

  useEffect(() => {
    if (!promotionSaved) {
      return
    }

    const timerId = window.setTimeout(() => {
      setPromotionSaved(false)
    }, 1800)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [promotionSaved])

  const loadPhotoImage = useCallback(async () => {
    if (!photoDataUrlRef.current) {
      return null
    }

    const img = new Image()
    await new Promise<void>((resolve) => {
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = photoDataUrlRef.current!
    })

    return img.naturalWidth > 0 ? img : null
  }, [])

  const drawPromoteFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    photoImage: HTMLImageElement | null,
    animationProgress = 1,
  ) => {
    const t = Math.min(1, Math.max(0, animationProgress))
    const easeInOut = t * t * (3 - 2 * t)
    const headlineAlpha = Math.min(1, Math.max(0, (t - 0.08) / 0.22))
    const footerAlpha = Math.min(1, Math.max(0, (t - 0.22) / 0.25))
    const chipAlpha = Math.min(1, Math.max(0, (t - 0.02) / 0.2))

    const PAD = Math.round(W * 0.045)
    const RADIUS = Math.round(W * 0.04)

    ctx.clearRect(0, 0, W, H)

    // Rounded clip so exported media matches the live preview silhouette.
    ctx.beginPath()
    ctx.moveTo(RADIUS, 0)
    ctx.lineTo(W - RADIUS, 0)
    ctx.quadraticCurveTo(W, 0, W, RADIUS)
    ctx.lineTo(W, H - RADIUS)
    ctx.quadraticCurveTo(W, H, W - RADIUS, H)
    ctx.lineTo(RADIUS, H)
    ctx.quadraticCurveTo(0, H, 0, H - RADIUS)
    ctx.lineTo(0, RADIUS)
    ctx.quadraticCurveTo(0, 0, RADIUS, 0)
    ctx.closePath()
    ctx.save()
    ctx.clip()

    const themeGradients: Record<ThemeKey, [string, string, string, number][]> = {
      none: [['#0f172a', '#0f172a', '#0f172a', 0]],
      sunset: [['#3c1f1e', '#8d3f2f', '#f18c57', 140]],
      midnight: [['#111827', '#1e3a8a', '#2563eb', 140]],
      studio: [['#1f2937', '#334155', '#06b6d4', 140]],
    }

    const tg = themeGradients[theme]
    if (tg[0][0] === tg[0][1] && tg[0][1] === tg[0][2]) {
      ctx.fillStyle = tg[0][0]
      ctx.fillRect(0, 0, W, H)
    } else {
      const [c0, c1, c2, angleDeg] = tg[0]
      const rad = (angleDeg * Math.PI) / 180
      const gx1 = W / 2 - (Math.cos(rad) * W) / 2
      const gy1 = H / 2 - (Math.sin(rad) * H) / 2
      const gx2 = W / 2 + (Math.cos(rad) * W) / 2
      const gy2 = H / 2 + (Math.sin(rad) * H) / 2
      const bg = ctx.createLinearGradient(gx1, gy1, gx2, gy2)
      bg.addColorStop(0, c0)
      bg.addColorStop(0.45, c1)
      bg.addColorStop(1, c2)
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)
    }

    if (photoImage) {
      const baseScale = Math.max(W / photoImage.naturalWidth, H / photoImage.naturalHeight)
      const zoom = 1.02 + 0.06 * easeInOut
      const dw = photoImage.naturalWidth * baseScale * zoom
      const dh = photoImage.naturalHeight * baseScale * zoom
      const driftX = (0.5 - easeInOut) * W * 0.04
      const driftY = (0.5 - easeInOut) * H * 0.02
      const dx = (W - dw) / 2 + driftX
      const dy = (H - dh) / 2 + driftY
      ctx.save()
      ctx.filter = `brightness(${photoBrightnessAdj}) contrast(${photoContrast}) saturate(${photoSaturation})`
      ctx.drawImage(photoImage, dx, dy, dw, dh)
      ctx.filter = 'none'
      ctx.restore()
    }

    const overlay = ctx.createLinearGradient(0, 0, 0, H)
    overlay.addColorStop(0, 'rgba(0,0,0,0)')
    overlay.addColorStop(1, `rgba(0,0,0,${0.35 + 0.12 * easeInOut})`)
    ctx.fillStyle = overlay
    ctx.fillRect(0, 0, W, H)

    const accentMap: Record<ThemeKey, string> = {
      none: '#94a3b8',
      sunset: '#ffd3a1',
      midnight: '#93c5fd',
      studio: '#a5f3fc',
    }
    const accent = accentMap[theme]

    const fontFamilyMap: Record<FontChoice, string> = {
      default: 'system-ui, -apple-system, sans-serif',
      serif: 'Georgia, serif',
      slab: '"Courier New", Courier, monospace',
      mono: 'Monaco, monospace',
    }
    const ff = fontFamilyMap[fontChoice]
    const fw = textBold ? '700' : '500'
    const textColorResolved = textColor || '#f8fafc'

    const shadowMap: Record<TextShadow, string | null> = {
      none: null,
      light: 'rgba(15,23,42,0.6)',
      medium: 'rgba(15,23,42,0.75)',
      strong: 'rgba(0,0,0,0.9)',
    }
    const shadowColor = shadowMap[textShadow]
    if (shadowColor) {
      ctx.shadowColor = shadowColor
      ctx.shadowBlur = textShadow === 'strong' ? 18 : textShadow === 'medium' ? 12 : 8
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 2
    }

    const drawText = (
      textValue: string,
      x: number,
      y: number,
      fontSize: number,
      maxWidth: number,
      opts: { align?: CanvasTextAlign; color?: string; weight?: string } = {},
    ) => {
      if (!textValue) return
      ctx.save()
      ctx.font = `${opts.weight ?? fw} ${fontSize}px ${ff}`
      ctx.fillStyle = opts.color ?? textColorResolved
      ctx.textAlign = opts.align ?? 'left'
      ctx.textBaseline = 'top'
      const words = textValue.split(' ')
      let line = ''
      let lineY = y
      const lineH = fontSize * 1.25
      for (const word of words) {
        const test = line ? `${line} ${word}` : word
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x, lineY, maxWidth)
          line = word
          lineY += lineH
        } else {
          line = test
        }
      }
      if (line) ctx.fillText(line, x, lineY, maxWidth)
      ctx.restore()
    }

    const CHIP_FONT = Math.round(W * 0.028)
    const CHIP_PX = Math.round(W * 0.022)
    const CHIP_PY = Math.round(W * 0.014)
    const chipLabel = 'The Human Jukebox'
    ctx.save()
    ctx.globalAlpha = chipAlpha
    ctx.font = `500 ${CHIP_FONT}px ${ff}`
    const chipW = ctx.measureText(chipLabel).width + CHIP_PX * 2
    const chipH = CHIP_FONT + CHIP_PY * 2
    const chipX = PAD
    const chipY = PAD
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    const chipR = chipH / 2
    ctx.moveTo(chipX + chipR, chipY)
    ctx.lineTo(chipX + chipW - chipR, chipY)
    ctx.quadraticCurveTo(chipX + chipW, chipY, chipX + chipW, chipY + chipR)
    ctx.lineTo(chipX + chipW, chipY + chipH - chipR)
    ctx.quadraticCurveTo(chipX + chipW, chipY + chipH, chipX + chipW - chipR, chipY + chipH)
    ctx.lineTo(chipX + chipR, chipY + chipH)
    ctx.quadraticCurveTo(chipX, chipY + chipH, chipX, chipY + chipH - chipR)
    ctx.lineTo(chipX, chipY + chipR)
    ctx.quadraticCurveTo(chipX, chipY, chipX + chipR, chipY)
    ctx.closePath()
    ctx.fillStyle = 'rgba(15,23,42,0.36)'
    ctx.fill()
    ctx.stroke()
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.fillStyle = '#f8fafc'
    ctx.textBaseline = 'middle'
    ctx.fillText(chipLabel, chipX + CHIP_PX, chipY + chipH / 2)
    ctx.restore()

    const CONTENT_W = W - PAD * 2
    const drawFrame = (fx: number, fy: number, fw2: number, fh: number) => {
      const tf = resolvedTextFrame
      if (tf === 'none') return
      ctx.save()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      const fr = Math.round(W * 0.025)
      ctx.beginPath()
      ctx.moveTo(fx + fr, fy)
      ctx.lineTo(fx + fw2 - fr, fy)
      ctx.quadraticCurveTo(fx + fw2, fy, fx + fw2, fy + fr)
      ctx.lineTo(fx + fw2, fy + fh - fr)
      ctx.quadraticCurveTo(fx + fw2, fy + fh, fx + fw2 - fr, fy + fh)
      ctx.lineTo(fx + fr, fy + fh)
      ctx.quadraticCurveTo(fx, fy + fh, fx, fy + fh - fr)
      ctx.lineTo(fx, fy + fr)
      ctx.quadraticCurveTo(fx, fy, fx + fr, fy)
      ctx.closePath()
      ctx.fillStyle = tf === 'light'
        ? `rgba(255,255,255,${0.12 + framePadding * 0.12})`
        : `rgba(0,0,0,${0.28 + framePadding * 0.18})`
      ctx.fill()
      ctx.restore()
    }

    const OVERLINE_SIZE = Math.round(W * 0.030 * textScale)
    const TITLE_SIZE = Math.round(W * 0.082 * textScale)
    const SUBTITLE_SIZE = Math.round(W * 0.037 * textScale)
    const DESC_SIZE = Math.round(W * 0.033 * textScale)
    const LINE_GAP = Math.round(W * 0.012)

    const measureBlockHeight = () => {
      let h = 0
      if (eventDate) h += OVERLINE_SIZE * 1.25 + LINE_GAP
      if (title) h += TITLE_SIZE * 1.25 + LINE_GAP
      if (subtitle) h += SUBTITLE_SIZE * 1.25 + LINE_GAP
      if (description) {
        ctx.font = `${fw} ${DESC_SIZE}px ${ff}`
        const words = description.split(' ')
        let lines = 1
        let line = ''
        for (const word of words) {
          const test = line ? `${line} ${word}` : word
          if (ctx.measureText(test).width > CONTENT_W && line) {
            lines++
            line = word
          } else {
            line = test
          }
        }
        h += lines * DESC_SIZE * 1.25
      }
      return h
    }

    const blockH = measureBlockHeight()
    const anchorYFrac = headlineAnchor.y / 100
    const enterOffset = Math.round((1 - easeInOut) * H * 0.06)
    const blockTopY = Math.round(H * anchorYFrac - blockH / 2 + enterOffset)
    const FRAME_PAD = Math.round(W * 0.025)

    ctx.save()
    ctx.globalAlpha = headlineAlpha
    drawFrame(PAD - FRAME_PAD, blockTopY - FRAME_PAD, CONTENT_W + FRAME_PAD * 2, blockH + FRAME_PAD * 2)

    let ty = blockTopY
    if (eventDate) {
      drawText(eventDate.toUpperCase(), PAD, ty, OVERLINE_SIZE, CONTENT_W)
      ty += OVERLINE_SIZE * 1.25 + LINE_GAP
    }
    if (title) {
      ctx.save()
      ctx.font = `700 ${TITLE_SIZE}px ${ff}`
      ctx.fillStyle = textColorResolved
      ctx.textBaseline = 'top'
      const words = title.split(' ')
      let line = ''
      const lineH = TITLE_SIZE * 1.15
      for (const word of words) {
        const test = line ? `${line} ${word}` : word
        if (ctx.measureText(test).width > CONTENT_W && line) {
          ctx.fillText(line, PAD, ty, CONTENT_W)
          line = word
          ty += lineH
        } else {
          line = test
        }
      }
      if (line) {
        ctx.fillText(line, PAD, ty, CONTENT_W)
        ty += lineH
      }
      ctx.restore()
      ty += LINE_GAP
    }
    if (subtitle) {
      drawText(subtitle, PAD, ty, SUBTITLE_SIZE, CONTENT_W)
      ty += SUBTITLE_SIZE * 1.25 + LINE_GAP
    }
    if (description) {
      drawText(description, PAD, ty, DESC_SIZE, CONTENT_W, { color: `${textColorResolved}ee` })
    }
    ctx.restore()

    const FOOT_NAME_SIZE = Math.round(W * 0.036 * textScale)
    const FOOT_META_SIZE = Math.round(W * 0.030 * textScale)
    const FOOT_H = FOOT_NAME_SIZE + FOOT_META_SIZE * 1.4 + Math.round(W * 0.02) + Math.round(W * 0.035)
    const footerY = H - PAD - FOOT_H
    const footTextY = footerY + Math.round(W * 0.018)

    ctx.save()
    ctx.globalAlpha = footerAlpha
    ctx.strokeStyle = accent
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(PAD, footerY)
    ctx.lineTo(W - PAD, footerY)
    ctx.stroke()

    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.font = `700 ${FOOT_NAME_SIZE}px ${ff}`
    ctx.fillStyle = textColorResolved
    ctx.textBaseline = 'top'
    if (eventName) ctx.fillText(eventName, PAD, footTextY, CONTENT_W * 0.65)
    ctx.font = `${fw} ${FOOT_META_SIZE}px ${ff}`
    ctx.fillStyle = `${textColorResolved}ee`
    if (venue) ctx.fillText(venue, PAD, footTextY + FOOT_NAME_SIZE * 1.3, CONTENT_W * 0.65)
    if (ctaText) {
      ctx.textAlign = 'right'
      ctx.font = `${fw} ${FOOT_META_SIZE}px ${ff}`
      ctx.fillStyle = accent
      ctx.fillText(ctaText, W - PAD, footTextY + FOOT_NAME_SIZE * 0.3, CONTENT_W * 0.45)
    }
    ctx.restore()

    ctx.restore()
  }, [
    ctaText,
    description,
    eventDate,
    eventName,
    fontChoice,
    framePadding,
    headlineAnchor.y,
    photoBrightnessAdj,
    photoContrast,
    photoSaturation,
    resolvedTextFrame,
    textBold,
    textColor,
    textScale,
    textShadow,
    theme,
    title,
    subtitle,
    venue,
  ])

  const exportImage = async (type: 'png' | 'jpg') => {
    if (exportingImage || exportingVideo) {
      return
    }

    setExportError(null)
    setVideoError(null)
    setExportStatus(null)
    setExportingImage(true)

    const sanitizedEventName = eventName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'promote-event'

    try {
      const W = targetDimensions.width
      const H = targetDimensions.height
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas not available on this device.')

      const photoImage = await loadPhotoImage()
      drawPromoteFrame(ctx, W, H, photoImage, 1)

      // ── encode & download ─────────────────────────────────────────────────
      const mimeType = type === 'png' ? 'image/png' : 'image/jpeg'
      const quality  = type === 'png' ? undefined : 0.92
      const fileName = `${sanitizedEventName}-${platform}-${format}-${targetDimensions.width}x${targetDimensions.height}.${type}`

      // Helper: decode a data URL to Blob without fetch() which can be unreliable for large payloads.
      const dataUrlToBlob = (dataUrl: string): Blob => {
        const [header, base64] = dataUrl.split(',')
        const mimeMatch = header.match(/:(.*?);/)
        const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return new Blob([bytes], { type: mime })
      }

      let blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, mimeType, quality)
      })

      // Fallback for browsers that return null from toBlob (use manual base64 decode, not fetch).
      if (!blob) {
        const dataUrl = type === 'png'
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.92)
        blob = dataUrlToBlob(dataUrl)
      }

      if (!blob) {
        throw new Error('Canvas could not produce an image blob.')
      }

      // Use native share only on mobile; desktop/laptop should always download a file directly.
      const isLikelyMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      const file = new File([blob], fileName, { type: mimeType })
      if (
        isLikelyMobile &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({ files: [file], title: fileName })
        return
      }

      // Desktop / Android fallback – object URL download
      // Desktop: try File System Access API first (most reliable — opens native Save dialog).
      const saveFilePickerWindow = window as SaveFilePickerWindow

      if (typeof saveFilePickerWindow.showSaveFilePicker === 'function') {
        try {
          const handle = await saveFilePickerWindow.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'Image', accept: { [mimeType]: [`.${type}`] } }],
          })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
          setExportStatus('Image saved successfully.')
          window.setTimeout(() => setExportStatus(null), 4000)
          return
        } catch (fsErr: unknown) {
          // User cancelled the picker — abort silently.
          if (fsErr instanceof DOMException && fsErr.name === 'AbortError') return
          // Any other FS error — fall through to anchor download.
          console.warn('PromoteEventPage: showSaveFilePicker failed, falling back', fsErr)
        }
      }

      const objectUrl = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a')
        link.download = fileName
        link.href = objectUrl
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setExportStatus('Download started — check your Downloads folder or browser bar.')
        window.setTimeout(() => setExportStatus(null), 6000)

        // Safety net for browsers without download attribute support.
        if (!('download' in HTMLAnchorElement.prototype)) {
          window.open(objectUrl, '_blank', 'noopener,noreferrer')
        }
      } finally {
        // Delay revoke so the browser has time to start the download
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
      }
    } catch (error) {
      console.warn('PromoteEventPage: canvas export failed', error)
      setExportError(error instanceof Error ? `Export failed: ${error.message}` : 'Could not export image — please try again.')
    } finally {
      setExportingImage(false)
    }
  }

  const exportVideo = async () => {
    if (exportingImage || exportingVideo) {
      return
    }

    setVideoError(null)
    setExportError(null)
    setVideoStatus(null)
    setExportStatus(null)
    setExportingVideo(true)

    const sanitizedEventName = eventName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'promote-event'

    const fps = 24
    const frameDelayMs = Math.round(1000 / fps)
    const totalFrames = PROMOTION_VIDEO_DURATION_SECONDS * fps

    try {
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('Video recording is not supported on this browser/device. Use desktop Chrome or Edge.')
      }

      const W = targetDimensions.width
      const H = targetDimensions.height
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Canvas not available on this device.')
      }

      const photoImage = await loadPhotoImage()
      drawPromoteFrame(ctx, W, H, photoImage, 0)

      const mimeCandidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ]
      const supportedMimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
      const stream = canvas.captureStream(fps)
      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream)

      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      const finished = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve()
        recorder.onerror = (event) => {
          reject(event.error ?? new Error('Video recorder failed unexpectedly.'))
        }
      })

      recorder.start(1000)
      setVideoStatus(`Recording ${PROMOTION_VIDEO_DURATION_SECONDS}s video... keep this tab open.`)

      for (let frame = 0; frame < totalFrames; frame += 1) {
        const progress = frame / Math.max(1, totalFrames - 1)
        drawPromoteFrame(ctx, W, H, photoImage, progress)
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), frameDelayMs)
        })
      }

      recorder.stop()
      await finished
      stream.getTracks().forEach((track) => track.stop())

      const mimeType = supportedMimeType || 'video/webm'
      const blob = new Blob(chunks, { type: mimeType })
      if (!blob.size) {
        throw new Error('Video export produced an empty file. Please try again.')
      }

      const fileName = `${sanitizedEventName}-${platform}-${format}-${targetDimensions.width}x${targetDimensions.height}-${PROMOTION_VIDEO_DURATION_SECONDS}s.webm`
      const objectUrl = URL.createObjectURL(blob)

      try {
        const link = document.createElement('a')
        link.download = fileName
        link.href = objectUrl
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
      }

      setVideoStatus('Video download started — check your Downloads folder or browser bar.')
      window.setTimeout(() => setVideoStatus(null), 6000)
    } catch (error) {
      console.warn('PromoteEventPage: video export failed', error)
      setVideoError(error instanceof Error ? `Video export failed: ${error.message}` : 'Could not export video — please try again.')
      setVideoStatus(null)
    } finally {
      setExportingVideo(false)
    }
  }

  const toggleAudienceNoLiveVisibility = async () => {
    if (!selectedEventId || audienceVisibilitySaving) {
      return
    }

    setAudienceVisibilityError(null)
    setAudienceVisibilitySaved(false)
    setAudienceVisibilitySaving(true)

    try {
      await setEventAudienceNoGigVisibility(selectedEventId, !(selectedHostEvent?.showInAudienceNoGig ?? false))
      setAudienceVisibilitySaved(true)
    } catch (error) {
      setAudienceVisibilityError(error instanceof Error ? error.message : 'Failed to update no-live audience visibility.')
    } finally {
      setAudienceVisibilitySaving(false)
    }
  }

  const savePromotionDraft = () => {
    if (!selectedEventId || initializingDraftRef.current) {
      setPromotionSaveError('Select an event before saving a promotion.')
      return
    }

    setPromotionSaveError(null)
    setPromotionSaved(false)

    const storageKey = `${PROMOTION_DRAFT_STORAGE_KEY_PREFIX}${selectedEventId}`
    const draft: PromotionDraft = {
      title,
      subtitle,
      eventName,
      venue,
      eventDate,
      ctaText,
      description,
      format,
      platform,
      theme,
      headlinePosition,
      headlineAnchor,
      textScale,
      textBold,
      textShadow,
      fontChoice,
      textFrame,
      framePadding,
      textColor,
      photoContrast,
      photoBrightnessAdj,
      photoSaturation,
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft))
      setPromotionSaved(true)
    } catch {
      setPromotionSaveError('Could not save promotion draft. Please try again.')
    }
  }

  const copyFacebookShareLink = async () => {
    if (!facebookShareUrl) {
      return
    }

    setFacebookShareError(null)

    try {
      await navigator.clipboard.writeText(facebookShareUrl)
      setFacebookLinkCopied(true)
    } catch {
      setFacebookShareError('Could not copy Facebook link. Please copy it manually from your browser.')
    }
  }

  const openFacebookShareDialog = () => {
    if (!facebookShareUrl) {
      return
    }

    setFacebookShareError(null)
    window.open(facebookShareUrl, '_blank', 'noopener,noreferrer')
  }

  const scrollToSection = <T extends HTMLElement>(ref: React.RefObject<T | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="promote-shell" aria-label="Promote event designer">
      <section ref={controlsPanelRef} className="queue-panel promote-controls-panel">
        <div className="panel-head">
          <h1>Promote Event</h1>
          <span className="meta-badge">Designer</span>
        </div>
        <p className="subcopy promote-shell-intro">
          Build a professional promo layout with your own photo, event details, and call-to-action.
        </p>

        <details className="promote-collapsible" open={!isMobileViewport}>
          <summary className="promote-collapsible-summary">Basics</summary>
          <div className="promote-control-grid">
          <label className="promote-field">
            <span>Event</span>
            <input
              value={eventFilterQuery}
              onChange={(changeEvent) => setEventFilterQuery(changeEvent.target.value)}
              placeholder="Filter events by name or venue"
            />
            <select
              value={selectedEventId}
              onChange={(changeEvent) => {
                setPromotionSaveError(null)
                setSelectedPromotionEventId(changeEvent.target.value)
              }}
            >
              {!filteredHostEvents.length ? <option value="">No matching events</option> : null}
              {filteredHostEvents.map((hostEvent) => (
                <option key={hostEvent.id} value={hostEvent.id}>
                  {hostEvent.name}{hostEvent.venue ? ` - ${hostEvent.venue}` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="promote-field promote-field-wide">
            <span>Step 2: Video</span>
            <button
              type="button"
              className="secondary-button"
              disabled={!selectedEventId}
              onClick={() => setShowVideoEditor((current) => !current)}
            >
              {!selectedEventId
                ? 'Select Event First'
                : showVideoEditor
                ? 'Hide Promo Video Editor'
                : 'Create Promo Video'}
            </button>
            <p className="field-hint">Create a social-ready MP4 with AI suggestions, overlays, transitions, and music.</p>
          </div>

          <label className="promote-field">
            <span>Format</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as PostFormat)}>
              <option value="square">Instagram Square (1:1)</option>
              <option value="portrait">Feed Portrait (4:5)</option>
              <option value="story">Story/Reel Cover (9:16)</option>
            </select>
          </label>

          <label className="promote-field promote-field-wide">
            <span>Upload Photo</span>
            <input type="file" accept="image/*" onChange={handleImageUpload} />
          </label>

          <label className="promote-field promote-field-wide">
            <span>Headline</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="promote-field promote-field-wide">
            <span>Subheadline</span>
            <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
          </label>

          <label className="promote-field">
            <span>Event Name</span>
            <input value={eventName} onChange={(event) => setEventName(event.target.value)} />
          </label>

          <label className="promote-field">
            <span>Venue</span>
            <input value={venue} onChange={(event) => setVenue(event.target.value)} />
          </label>

          <label className="promote-field">
            <span>Date + Time</span>
            <input value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
          </label>

          <label className="promote-field promote-field-wide">
            <span>Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </label>

          <label className="promote-field promote-field-wide">
            <span>CTA</span>
            <input value={ctaText} onChange={(event) => setCtaText(event.target.value)} />
          </label>

                {photoUrl && (!isMobileViewport || showMobileAdvancedControls) ? (
                  <>
                    <label className="promote-field">
                      <span>Photo Brightness ({Math.round(photoBrightnessAdj * 100)}%)</span>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.05"
                        value={photoBrightnessAdj}
                        onChange={(event) => setPhotoBrightnessAdj(Number.parseFloat(event.target.value))}
                      />
                    </label>
                    <label className="promote-field">
                      <span>Photo Contrast ({Math.round(photoContrast * 100)}%)</span>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.05"
                        value={photoContrast}
                        onChange={(event) => setPhotoContrast(Number.parseFloat(event.target.value))}
                      />
                    </label>
                    <label className="promote-field">
                      <span>Photo Saturation ({Math.round(photoSaturation * 100)}%)</span>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.05"
                        value={photoSaturation}
                        onChange={(event) => setPhotoSaturation(Number.parseFloat(event.target.value))}
                      />
                    </label>
                  </>
                ) : null}

                {(!isMobileViewport || showMobileAdvancedControls) ? (
                  <>
                    <label className="promote-field">
                      <span>Platform</span>
                      <select value={platform} onChange={(event) => setPlatform(event.target.value as SocialPlatform)}>
                        <option value="instagram">Instagram</option>
                        <option value="facebook">Facebook</option>
                      </select>
                    </label>

                    <label className="promote-field">
                      <span>Theme</span>
                      <select value={theme} onChange={(event) => setTheme(event.target.value as ThemeKey)}>
                        {THEMES.map((themeOption) => (
                          <option key={themeOption.key} value={themeOption.key}>
                            {themeOption.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="promote-field">
                      <span>Headline Position</span>
                      <select value={headlinePosition} onChange={(event) => handleHeadlinePositionPreset(event.target.value as HeadlinePosition)}>
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </label>

                    <label className="promote-field">
                      <span>Text Size ({Math.round(textScale * 100)}%)</span>
                      <input
                        type="range"
                        min="0.8"
                        max="1.4"
                        step="0.05"
                        value={textScale}
                        onChange={(event) => {
                          setTextScale(Number.parseFloat(event.target.value))
                        }}
                      />
                    </label>

                    <label className="promote-field">
                      <span>Font</span>
                      <select value={fontChoice} onChange={(event) => setFontChoice(event.target.value as FontChoice)}>
                        <option value="default">Modern Sans</option>
                        <option value="serif">Serif</option>
                        <option value="slab">Slab Serif</option>
                        <option value="mono">Monospace</option>
                      </select>
                    </label>

                    <label className="promote-field">
                      <span>Text Shadow</span>
                      <select value={textShadow} onChange={(event) => setTextShadow(event.target.value as TextShadow)}>
                        <option value="none">None</option>
                        <option value="light">Light</option>
                        <option value="medium">Medium</option>
                        <option value="strong">Strong</option>
                      </select>
                    </label>

                    <label className="promote-field">
                      <span>Text Style</span>
                      <div className="promote-checkbox-group">
                        <input
                          type="checkbox"
                          id="bold-toggle"
                          checked={textBold}
                          onChange={(event) => setTextBold(event.target.checked)}
                        />
                        <label htmlFor="bold-toggle">Bold</label>
                      </div>
                    </label>

                    <label className="promote-field">
                      <span>Text Frame</span>
                      <select value={textFrame} onChange={(event) => setTextFrame(event.target.value as TextFrame)}>
                        <option value="auto">Auto (Smart Contrast)</option>
                        <option value="none">None</option>
                        <option value="light">Light Background</option>
                        <option value="dark">Dark Background</option>
                      </select>
                      {autoFrameHint ? <p className="field-hint">{autoFrameHint}</p> : null}
                    </label>

                    {textFrame !== 'none' ? (
                      <label className="promote-field">
                        <span>Frame Padding ({Math.round((framePadding / 1.8) * 100)}%)</span>
                        <input
                          type="range"
                          min="0"
                          max="1.8"
                          step="0.05"
                          value={framePadding}
                          onChange={(event) => setFramePadding(Number.parseFloat(event.target.value))}
                        />
                      </label>
                    ) : null}

                    <label className="promote-field">
                      <span>Text Color</span>
                      <input
                        type="color"
                        value={textColor}
                        onChange={(event) => setTextColor(event.target.value)}
                      />
                    </label>

                    <div className="promote-field promote-field-wide">
                      <span>
                        No-Live Audience Option
                        {audienceVisibilitySaved ? <span className="meta-badge">Saved</span> : null}
                      </span>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          void toggleAudienceNoLiveVisibility()
                        }}
                        disabled={!selectedEventId || audienceVisibilitySaving}
                      >
                        {!selectedEventId
                          ? 'No Active Event Selected'
                          : audienceVisibilitySaving
                          ? 'Saving...'
                          : selectedHostEvent?.showInAudienceNoGig
                          ? 'Hide This Event When No Gig Is Live'
                          : 'Show This Event When No Gig Is Live'}
                      </button>
                      <p className="field-hint">
                        {selectedEventId
                          ? selectedHostEvent?.showInAudienceNoGig
                            ? 'Audience fallback is enabled for this event.'
                            : 'Audience fallback is disabled for this event.'
                          : 'Select an active event first to configure audience fallback visibility.'}
                      </p>
                    </div>
                  </>
                ) : null}
          </div>
        </details>

        <div ref={exportPanelRef}>
          <details className="promote-collapsible promote-collapsible-export" open={!isMobileViewport}>
            <summary className="promote-collapsible-summary">Export &amp; Share</summary>
            <div className="promote-control-grid promote-export-grid">
          <div className="promote-field promote-field-wide">
            <span>Save Draft</span>
            <button
              type="button"
              className="secondary-button"
              onClick={savePromotionDraft}
              disabled={!selectedEventId}
            >
              {promotionSaved ? 'Draft Saved!' : 'Save Draft'}
            </button>
          </div>

          <div className="promote-field promote-field-wide">
            <span>Export Image</span>
            <div className="hero-actions no-margin-bottom">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void exportImage('png')}
                disabled={exportingImage || exportingVideo || !selectedEventId}
              >
                {exportingImage ? 'Exporting…' : 'Download PNG'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void exportImage('jpg')}
                disabled={exportingImage || exportingVideo || !selectedEventId}
              >
                {exportingImage ? 'Exporting…' : 'Download JPG'}
              </button>
            </div>
            {exportStatus ? <p className="field-hint">{exportStatus}</p> : null}
            {exportError ? <p className="error-text no-margin-bottom">{exportError}</p> : null}
          </div>

          <div className="promote-field promote-field-wide">
            <span>Export Video</span>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void exportVideo()}
              disabled={exportingImage || exportingVideo || !selectedEventId}
            >
              {exportingVideo ? 'Rendering…' : 'Download MP4'}
            </button>
            {videoStatus ? <p className="field-hint">{videoStatus}</p> : null}
            {videoError ? <p className="error-text no-margin-bottom">{videoError}</p> : null}
          </div>

          <div className="promote-field promote-field-wide">
            <span>Caption &amp; Share</span>
            <div className="hero-actions no-margin-bottom">
              <button type="button" className="secondary-button" onClick={() => void copyCaption()}>
                Copy Caption
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void copyFacebookShareLink()}
                disabled={!facebookShareUrl}
              >
                {facebookLinkCopied ? 'Link Copied!' : 'Copy Facebook Link'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={openFacebookShareDialog}
                disabled={!facebookShareUrl}
              >
                Share on Facebook
              </button>
            </div>
            {facebookShareError ? <p className="error-text no-margin-bottom">{facebookShareError}</p> : null}
          </div>

            </div>
          </details>
        </div>

        {promotionSaveError ? <p className="error-text no-margin-bottom">{promotionSaveError}</p> : null}
        {audienceVisibilityError ? <p className="error-text no-margin-bottom">{audienceVisibilityError}</p> : null}
      </section>

      {isMobileViewport ? (
        <section ref={toolsPanelRef} className="queue-panel promote-mobile-advanced-panel" aria-label="Advanced promo controls">
          <div className="panel-head">
            <h2>More Tools</h2>
            <span className="meta-badge">Optional</span>
          </div>
            <p className="subcopy no-margin-bottom">Quick workflow: fill basics, export, and only open advanced tools when needed.</p>
          <div className="hero-actions promote-tool-row no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setShowMobileAdvancedControls((current) => !current)
                setMobileDockActive('tools')
              }}
            >
              {showMobileAdvancedControls ? 'Hide Advanced Tools' : 'Show Advanced Tools'}
            </button>
            {showVideoEditor && selectedEventId ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowVideoEditor(false)
                  setMobileDockActive('tools')
                }}
              >
                Hide Video Editor
              </button>
            ) : selectedEventId ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowVideoEditor(true)
                  setMobileDockActive('video')
                }}
              >
                Open Video Editor
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {showVideoEditor && selectedEventId ? (
        <section ref={videoPanelRef} className="queue-panel promote-video-editor-panel" aria-label="Video editor">
          <VideoEditor
            eventId={selectedEventId}
            eventName={eventName}
            eventDate={eventDate}
            venue={venue}
            ctaText={ctaText}
            defaultTheme={theme}
            initialImageDataUrls={photoDataUrlRef.current ? [photoDataUrlRef.current] : []}
          />
        </section>
      ) : null}

      <section className="queue-panel promote-preview-panel" aria-label="Promotional preview">
        <div className="panel-head">
          <h2>Live Preview</h2>
          <span className="meta-badge">Professional Style</span>
        </div>

        <article
          ref={previewRef}
          className={`promote-canvas ${FORMAT_CLASS_MAP[format]} ${THEME_CLASS_MAP[activeTheme.key]}`}
        >
          {photoUrl ? <img src={photoUrl} alt="Promo background" className="promote-photo" /> : null}
          <div className="promote-overlay" aria-hidden="true"></div>

          <div className="promote-chip">
            The Human Jukebox
          </div>

          <div
            ref={headlineRef}
            className={`promote-content promote-content-${headlinePosition} ${headlineDragging ? 'promote-content-dragging' : ''} promote-font-${fontChoice} ${textBold ? 'promote-text-bold' : ''} promote-shadow-${textShadow} promote-frame-${resolvedTextFrame}`}
            onPointerDown={startHeadlineDrag}
            role="presentation"
          >
            <p className="promote-overline">{eventDate}</p>
            <h3>{title}</h3>
            <p className="promote-subtitle">{subtitle}</p>
            <p className="promote-description">{description}</p>
          </div>

          <div className={`promote-footer promote-font-${fontChoice} ${textBold ? 'promote-text-bold' : ''} promote-shadow-${textShadow} promote-frame-${resolvedTextFrame}`}>
            <div>
              <p className="promote-event-name">{eventName}</p>
              <p className="promote-event-meta">{venue}</p>
            </div>
            <p className="promote-cta">{ctaText}</p>
          </div>
        </article>
      </section>

      {isMobileViewport ? (
        <nav className="promote-mobile-dock" aria-label="Editor quick actions">
          <button
            type="button"
            className={`secondary-button promote-dock-btn${mobileDockActive === 'preview' ? ' promote-dock-btn-active' : ''}`}
            onClick={() => {
              setMobileDockActive('preview')
              scrollToSection(previewRef)
            }}
          >
            <span className="promote-dock-btn-icon" aria-hidden="true">🖼️</span>
            <span className="promote-dock-btn-label">Preview</span>
          </button>
          <button
            type="button"
            className={`secondary-button promote-dock-btn${mobileDockActive === 'basics' ? ' promote-dock-btn-active' : ''}`}
            onClick={() => {
              setMobileDockActive('basics')
              scrollToSection(controlsPanelRef)
            }}
          >
            <span className="promote-dock-btn-icon" aria-hidden="true">✍️</span>
            <span className="promote-dock-btn-label">Basics</span>
          </button>
          <button
            type="button"
            className={`secondary-button promote-dock-btn${mobileDockActive === 'export' ? ' promote-dock-btn-active' : ''}`}
            onClick={() => {
              setMobileDockActive('export')
              scrollToSection(exportPanelRef)
            }}
          >
            <span className="promote-dock-btn-icon" aria-hidden="true">⬇️</span>
            <span className="promote-dock-btn-label">Export</span>
          </button>
          <button
            type="button"
            className={`secondary-button promote-dock-btn${mobileDockActive === 'tools' ? ' promote-dock-btn-active' : ''}`}
            onClick={() => {
              setMobileDockActive('tools')
              setShowMobileAdvancedControls(true)
              scrollToSection(toolsPanelRef)
            }}
          >
            <span className="promote-dock-btn-icon" aria-hidden="true">🎚️</span>
            <span className="promote-dock-btn-label">Tools</span>
          </button>
          <button
            type="button"
            className={`secondary-button promote-dock-btn${mobileDockActive === 'video' ? ' promote-dock-btn-active' : ''}`}
            disabled={!selectedEventId}
            onClick={() => {
              if (!selectedEventId) return
              setMobileDockActive('video')
              setShowVideoEditor(true)
              window.setTimeout(() => {
                scrollToSection(videoPanelRef)
              }, 0)
            }}
          >
            <span className="promote-dock-btn-icon" aria-hidden="true">🎬</span>
            <span className="promote-dock-btn-label">Video</span>
          </button>
        </nav>
      ) : null}

    </section>
  )
}

export default PromoteEventPage
