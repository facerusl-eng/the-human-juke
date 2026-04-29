import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import html2canvas from 'html2canvas'
import { toJpeg, toPng } from 'html-to-image'
import { getAudienceUrl } from '../lib/audienceUrl'
import { useQueueStore } from '../state/queueStore'

type PostFormat = 'square' | 'portrait' | 'story'
type SocialPlatform = 'instagram' | 'facebook'
type ThemeKey = 'none' | 'sunset' | 'midnight' | 'studio'
type HeadlinePosition = 'top' | 'center' | 'bottom'

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
}

const PROMOTION_DRAFT_STORAGE_KEY_PREFIX = 'human-jukebox-promo-draft:'

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
  const previewRef = useRef<HTMLElement | null>(null)
  const headlineRef = useRef<HTMLDivElement | null>(null)
  const dragActiveRef = useRef(false)
  const photoObjectUrlRef = useRef<string | null>(null)
  const initializingDraftRef = useRef(false)
  const [format, setFormat] = useState<PostFormat>('portrait')
  const [platform, setPlatform] = useState<SocialPlatform>('instagram')
  const [theme, setTheme] = useState<ThemeKey>('sunset')
  const [headlinePosition, setHeadlinePosition] = useState<HeadlinePosition>('center')
  const [headlineAnchor, setHeadlineAnchor] = useState<HeadlineAnchor>({ x: 50, y: 50 })
  const [headlineDragging, setHeadlineDragging] = useState(false)
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
  const [exportError, setExportError] = useState<string | null>(null)
  const [audienceVisibilitySaving, setAudienceVisibilitySaving] = useState(false)
  const [audienceVisibilitySaved, setAudienceVisibilitySaved] = useState(false)
  const [audienceVisibilityError, setAudienceVisibilityError] = useState<string | null>(null)
  const [facebookLinkCopied, setFacebookLinkCopied] = useState(false)
  const [facebookShareError, setFacebookShareError] = useState<string | null>(null)
  const [selectedPromotionEventId, setSelectedPromotionEventId] = useState('')
  const [promotionSaved, setPromotionSaved] = useState(false)
  const [promotionSaveError, setPromotionSaveError] = useState<string | null>(null)

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

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]

    if (!nextFile) {
      return
    }

    const fileName = nextFile.name.toLowerCase()
    const fileType = nextFile.type.toLowerCase()
    const unsupportedImage = fileType.includes('heic') || fileType.includes('heif') || fileName.endsWith('.heic') || fileName.endsWith('.heif')

    if (unsupportedImage) {
      setExportError('This photo format is not supported by your browser. Please use JPG or PNG.')
      return
    }

    setExportError(null)

    if (photoObjectUrlRef.current) {
      URL.revokeObjectURL(photoObjectUrlRef.current)
    }

    const objectUrl = URL.createObjectURL(nextFile)
    photoObjectUrlRef.current = objectUrl
    setPhotoUrl(objectUrl)
  }

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

  const clampPercentage = (value: number, min = 8, max = 92) => Math.min(max, Math.max(min, value))

  const updateHeadlineAnchorFromPointer = (clientX: number, clientY: number) => {
    const canvas = previewRef.current

    if (!canvas) {
      return
    }

    const canvasRect = canvas.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return
    }

    const nextX = clampPercentage(((clientX - canvasRect.left) / canvasRect.width) * 100)
    const nextY = clampPercentage(((clientY - canvasRect.top) / canvasRect.height) * 100, 12, 84)
    setHeadlineAnchor({ x: nextX, y: nextY })
  }

  const stopHeadlineDrag = () => {
    dragActiveRef.current = false
    setHeadlineDragging(false)
    window.removeEventListener('pointermove', onHeadlinePointerMove)
    window.removeEventListener('pointerup', stopHeadlineDrag)
    window.removeEventListener('pointercancel', stopHeadlineDrag)
  }

  const onHeadlinePointerMove = (pointerEvent: PointerEvent) => {
    if (!dragActiveRef.current) {
      return
    }

    updateHeadlineAnchorFromPointer(pointerEvent.clientX, pointerEvent.clientY)
  }

  const startHeadlineDrag = (pointerEvent: ReactPointerEvent<HTMLDivElement>) => {
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
  }

  const handleHeadlinePositionPreset = (nextPosition: HeadlinePosition) => {
    setHeadlinePosition(nextPosition)

    if (nextPosition === 'top') {
      setHeadlineAnchor({ x: 50, y: 24 })
      return
    }

    if (nextPosition === 'bottom') {
      setHeadlineAnchor({ x: 50, y: 74 })
      return
    }

    setHeadlineAnchor({ x: 50, y: 50 })
  }

  useEffect(() => {
    return () => {
      stopHeadlineDrag()

      if (photoObjectUrlRef.current) {
        URL.revokeObjectURL(photoObjectUrlRef.current)
        photoObjectUrlRef.current = null
      }
    }
  }, [])

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

  const waitForPreviewAssets = async (previewElement: HTMLElement) => {
    if ('fonts' in document && document.fonts?.ready) {
      await document.fonts.ready
    }

    const previewImages = Array.from(previewElement.querySelectorAll('img'))
    await Promise.all(
      previewImages.map(async (imageElement) => {
        if (imageElement.complete && imageElement.naturalWidth > 0) {
          return
        }

        if (typeof imageElement.decode === 'function') {
          await imageElement.decode()
          return
        }

        await new Promise<void>((resolve, reject) => {
          imageElement.onload = () => resolve()
          imageElement.onerror = () => reject(new Error('Could not load preview image'))
        })
      }),
    )
  }

  const exportImage = async (type: 'png' | 'jpg') => {
    if (!previewRef.current || exportingImage) {
      return
    }

    const previewElement = previewRef.current

    setExportError(null)
    setExportingImage(true)

    const sanitizedEventName = eventName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'promote-event'

    const downloadDataUrl = (dataUrl: string) => {
      const downloadLink = document.createElement('a')
      downloadLink.download = `${sanitizedEventName}-${platform}-${format}-${targetDimensions.width}x${targetDimensions.height}.${type}`
      downloadLink.href = dataUrl
      downloadLink.click()
    }

    const exportOptions = {
      cacheBust: true,
      pixelRatio: 2,
      skipAutoScale: true,
      width: previewElement.clientWidth,
      height: previewElement.clientHeight,
      canvasWidth: targetDimensions.width,
      canvasHeight: targetDimensions.height,
    }

    try {
      await waitForPreviewAssets(previewElement)

      const dataUrl = type === 'png'
        ? await toPng(previewElement, exportOptions)
        : await toJpeg(previewRef.current, {
          ...exportOptions,
          quality: 0.95,
        })
      downloadDataUrl(dataUrl)
    } catch (error) {
      console.warn(`PromoteEventPage: primary ${type.toUpperCase()} export failed, trying fallback`, error)

      try {
        await waitForPreviewAssets(previewElement)

        const fallbackCanvas = await html2canvas(previewElement, {
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
          scale: Math.max(targetDimensions.width / previewElement.clientWidth, 1),
          width: previewElement.clientWidth,
          height: previewElement.clientHeight,
          windowWidth: previewElement.clientWidth,
          windowHeight: previewElement.clientHeight,
        })

        const fallbackDataUrl = type === 'png'
          ? fallbackCanvas.toDataURL('image/png')
          : fallbackCanvas.toDataURL('image/jpeg', 0.95)

        downloadDataUrl(fallbackDataUrl)
      } catch (fallbackError) {
        console.warn(`PromoteEventPage: fallback ${type.toUpperCase()} export failed`, fallbackError)
        setExportError('Could not export image. Please try a different photo file and retry.')
      }
    } finally {
      setExportingImage(false)
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

  return (
    <section className="promote-shell" aria-label="Promote event designer">
      <section className="queue-panel promote-controls-panel">
        <div className="panel-head">
          <h1>Promote Event</h1>
          <span className="meta-badge">Designer</span>
        </div>
        <p className="subcopy">
          Build a professional promo layout with your own photo, event details, and call-to-action.
        </p>

        <div className="promote-control-grid">
          <label className="promote-field">
            <span>Event</span>
            <select
              value={selectedEventId}
              onChange={(changeEvent) => {
                setPromotionSaveError(null)
                setSelectedPromotionEventId(changeEvent.target.value)
              }}
            >
              {!hostEvents.length ? <option value="">No events found</option> : null}
              {hostEvents.map((hostEvent) => (
                <option key={hostEvent.id} value={hostEvent.id}>
                  {hostEvent.name}{hostEvent.venue ? ` - ${hostEvent.venue}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="promote-field">
            <span>Format</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as PostFormat)}>
              <option value="square">Instagram Square (1:1)</option>
              <option value="portrait">Feed Portrait (4:5)</option>
              <option value="story">Story/Reel Cover (9:16)</option>
            </select>
          </label>

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
        </div>

        <div className="promote-action-row">
          <button type="button" className="secondary-button" onClick={() => void copyCaption()}>
            Copy Caption Text
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={savePromotionDraft}
            disabled={!selectedEventId || initializingDraftRef.current}
          >
            {promotionSaved ? 'Promotion Saved' : 'Save Promotion Draft'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void copyFacebookShareLink()
            }}
            disabled={!facebookShareUrl}
          >
            {facebookLinkCopied ? 'Facebook Link Copied' : 'Copy Facebook Post Link'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={openFacebookShareDialog}
            disabled={!facebookShareUrl}
          >
            Open Facebook Share
          </button>
          <button type="button" className="primary-button" onClick={() => void exportImage('png')} disabled={exportingImage}>
            {exportingImage ? 'Exporting...' : `Export PNG (${targetDimensions.width}x${targetDimensions.height})`}
          </button>
          <button type="button" className="secondary-button" onClick={() => void exportImage('jpg')} disabled={exportingImage}>
            {exportingImage ? 'Exporting...' : `Export JPG (${targetDimensions.width}x${targetDimensions.height})`}
          </button>
        </div>
        {promotionSaveError ? <p className="error-text no-margin-bottom">{promotionSaveError}</p> : null}
        {facebookShareError ? <p className="error-text no-margin-bottom">{facebookShareError}</p> : null}
        {audienceVisibilityError ? <p className="error-text no-margin-bottom">{audienceVisibilityError}</p> : null}
        {exportError ? <p className="error-text no-margin-bottom">{exportError}</p> : null}
      </section>

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
            className={`promote-content promote-content-${headlinePosition} ${headlineDragging ? 'promote-content-dragging' : ''}`}
            onPointerDown={startHeadlineDrag}
            role="presentation"
          >
            <p className="promote-overline">{eventDate}</p>
            <h3>{title}</h3>
            <p className="promote-subtitle">{subtitle}</p>
            <p className="promote-description">{description}</p>
          </div>

          <div className="promote-footer">
            <div>
              <p className="promote-event-name">{eventName}</p>
              <p className="promote-event-meta">{venue}</p>
            </div>
            <p className="promote-cta">{ctaText}</p>
          </div>
        </article>
      </section>
    </section>
  )
}

export default PromoteEventPage
