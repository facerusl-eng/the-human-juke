import { useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { toPng } from 'html-to-image'

type PostFormat = 'square' | 'portrait' | 'story'
type ThemeKey = 'sunset' | 'midnight' | 'studio'

type Theme = {
  key: ThemeKey
  name: string
}

const THEMES: Theme[] = [
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
  sunset: 'promote-theme-sunset',
  midnight: 'promote-theme-midnight',
  studio: 'promote-theme-studio',
}

function PromoteEventPage() {
  const previewRef = useRef<HTMLElement | null>(null)
  const [format, setFormat] = useState<PostFormat>('portrait')
  const [theme, setTheme] = useState<ThemeKey>('sunset')
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

  const activeTheme = useMemo(
    () => THEMES.find((item) => item.key === theme) ?? THEMES[0],
    [theme],
  )

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0]

    if (!nextFile) {
      return
    }

    const objectUrl = URL.createObjectURL(nextFile)
    setPhotoUrl(objectUrl)
  }

  const captionPreview = useMemo(() => {
    return `${eventName}\n${description}\n${ctaText}`
  }, [ctaText, description, eventName])

  const copyCaption = async () => {
    await navigator.clipboard.writeText(captionPreview)
  }

  const exportPng = async () => {
    if (!previewRef.current || exportingImage) {
      return
    }

    setExportError(null)
    setExportingImage(true)

    const dimensionsByFormat: Record<PostFormat, { width: number; height: number }> = {
      square: { width: 1080, height: 1080 },
      portrait: { width: 1080, height: 1350 },
      story: { width: 1080, height: 1920 },
    }

    const targetDimensions = dimensionsByFormat[format]

    try {
      const dataUrl = await toPng(previewRef.current, {
        cacheBust: true,
        pixelRatio: 1,
        skipAutoScale: true,
        canvasWidth: targetDimensions.width,
        canvasHeight: targetDimensions.height,
      })

      const sanitizedEventName = eventName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'promote-event'

      const downloadLink = document.createElement('a')
      downloadLink.download = `${sanitizedEventName}-${format}.png`
      downloadLink.href = dataUrl
      downloadLink.click()
    } catch (error) {
      console.warn('PromoteEventPage: PNG export failed', error)
      setExportError('Could not export image. Please try another photo or theme.')
    } finally {
      setExportingImage(false)
    }
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
            <span>Format</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as PostFormat)}>
              <option value="square">Instagram Square (1:1)</option>
              <option value="portrait">Feed Portrait (4:5)</option>
              <option value="story">Story/Reel Cover (9:16)</option>
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
        </div>

        <div className="promote-action-row">
          <button type="button" className="secondary-button" onClick={() => void copyCaption()}>
            Copy Caption Text
          </button>
          <button type="button" className="primary-button" onClick={() => void exportPng()} disabled={exportingImage}>
            {exportingImage ? 'Exporting PNG...' : 'Export PNG'}
          </button>
        </div>
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

          <div className="promote-content">
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
