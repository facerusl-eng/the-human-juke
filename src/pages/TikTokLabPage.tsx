import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type FormState = {
  venueName: string
  city: string
  vibe: string
  highlight: string
  callToAction: string
}

const DEFAULT_FORM: FormState = {
  venueName: '',
  city: '',
  vibe: 'high-energy singalong',
  highlight: '',
  callToAction: 'Book us for your next live night',
}

function normalizeTag(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '')
}

function createHashtags(form: FormState) {
  const dynamic = [form.city, form.venueName, form.vibe]
    .map(normalizeTag)
    .filter(Boolean)
    .slice(0, 3)
    .map((value) => `#${value}`)

  const base = ['#karaoke', '#livemusic', '#crowdenergy', '#nightlife', '#humanjukebox']
  return [...dynamic, ...base].slice(0, 8)
}

function createCaptions(form: FormState) {
  const location = [form.venueName, form.city].filter(Boolean).join(' • ') || 'Tonight'
  const highlight = form.highlight.trim() || 'The crowd went all in.'
  const cta = form.callToAction.trim() || 'Book us for your next live night.'

  return [
    `${location}: ${highlight} ${cta}`,
    `POV: ${form.vibe} and zero chill. ${highlight} ${cta}`,
    `This is what a real singalong looks like. ${highlight} ${cta}`,
  ]
}

function createHooks(form: FormState) {
  const location = [form.venueName, form.city].filter(Boolean).join(' ') || 'this room'

  return [
    `Nobody expected this at ${location}`,
    `Wait for the crowd reaction in 3 seconds`,
    `If your venue wants this energy, watch this`,
  ]
}

export default function TikTokLabPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)

  const postKit = useMemo(() => {
    return {
      captions: createCaptions(form),
      hashtags: createHashtags(form),
      hooks: createHooks(form),
    }
  }, [form])

  return (
    <section className="app-shell app-shell-wide tiktok-lab-page" aria-label="TikTok Lab">
      <section className="queue-panel tiktok-lab-header">
        <p className="eyebrow">Content Engine</p>
        <h1>TikTok Lab</h1>
        <p className="subcopy">
          Build post-ready ideas fast. Keep it simple, test two variants, and publish from phone, iPad, or desktop.
        </p>
        <div className="tiktok-lab-actions">
          <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>Back to Admin</button>
          <button
            type="button"
            className="primary-button"
            onClick={() => setForm(DEFAULT_FORM)}
          >
            Reset
          </button>
        </div>
      </section>

      <section className="queue-panel tiktok-lab-grid" aria-label="TikTok planning tools">
        <article className="tiktok-card tiktok-form-card">
          <h2>Post Input</h2>
          <div className="tiktok-form-grid">
            <label>
              Venue
              <input
                value={form.venueName}
                onChange={(event) => setForm((prev) => ({ ...prev, venueName: event.target.value }))}
                placeholder="The Golden Bar"
              />
            </label>
            <label>
              City
              <input
                value={form.city}
                onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
                placeholder="Aarhus"
              />
            </label>
            <label>
              Vibe
              <input
                value={form.vibe}
                onChange={(event) => setForm((prev) => ({ ...prev, vibe: event.target.value }))}
                placeholder="high-energy singalong"
              />
            </label>
            <label>
              Highlight Moment
              <textarea
                value={form.highlight}
                onChange={(event) => setForm((prev) => ({ ...prev, highlight: event.target.value }))}
                placeholder="200 people sang the chorus together"
                rows={3}
              />
            </label>
            <label>
              Call to Action
              <input
                value={form.callToAction}
                onChange={(event) => setForm((prev) => ({ ...prev, callToAction: event.target.value }))}
                placeholder="Book us for your next live night"
              />
            </label>
          </div>
        </article>

        <article className="tiktok-card">
          <h2>Hooks (first 2 seconds)</h2>
          <ul>
            {postKit.hooks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="tiktok-card">
          <h2>Caption Options</h2>
          <ol>
            {postKit.captions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>

        <article className="tiktok-card">
          <h2>Hashtag Pack</h2>
          <p className="tiktok-hashtags">{postKit.hashtags.join(' ')}</p>
        </article>

        <article className="tiktok-card tiktok-export-card">
          <h2>Export Checklist</h2>
          <ul>
            <li>Format: 1080x1920 (9:16)</li>
            <li>Clip length: 10-25 seconds</li>
            <li>Captions burned-in and readable</li>
            <li>Strong crowd moment in first 2 seconds</li>
            <li>End with booking CTA</li>
          </ul>
        </article>

        <article className="tiktok-card tiktok-ab-card">
          <h2>Weekly A/B Test</h2>
          <div className="tiktok-ab-grid">
            <div>
              <h3>Variant A</h3>
              <p>Use Hook 1 + Caption 1 + weekday 18:00 post time.</p>
            </div>
            <div>
              <h3>Variant B</h3>
              <p>Use Hook 2 + Caption 2 + weekend 20:00 post time.</p>
            </div>
          </div>
        </article>
      </section>
    </section>
  )
}
