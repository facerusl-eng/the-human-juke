import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

type FormState = {
  venueName: string
  city: string
  vibe: string
  highlight: string
  callToAction: string
}

type PostKitHistory = {
  id: string
  timestamp: number
  form: FormState
  captions: string[]
  hashtags: string[]
  hooks: string[]
}

const DEFAULT_FORM: FormState = {
  venueName: '',
  city: '',
  vibe: 'high-energy singalong',
  highlight: '',
  callToAction: 'Book us for your next live night',
}

const HISTORY_KEY = 'human-jukebox-tiktok-post-history'
const MAX_HISTORY = 20

function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false)
  }
  // Fallback for older browsers
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return Promise.resolve(success)
  } catch {
    return Promise.resolve(false)
  }
}

function loadPostHistory(): PostKitHistory[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function savePostHistory(history: PostKitHistory[]) {
  try {
    const trimmed = history.slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage full or unavailable
  }
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
  const [history, setHistory] = useState<PostKitHistory[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false })

  // Load history on mount
  useEffect(() => {
    setHistory(loadPostHistory())
  }, [])

  const postKit = useMemo(() => {
    return {
      captions: createCaptions(form),
      hashtags: createHashtags(form),
      hooks: createHooks(form),
    }
  }, [form])

  const showToast = (message: string) => {
    setToast({ message, visible: true })
    setTimeout(() => setToast({ message: '', visible: false }), 2500)
  }

  const handleCopySection = async (content: string | string[], label: string) => {
    const text = Array.isArray(content) ? content.join('\n') : content
    const success = await copyToClipboard(text)
    if (success) {
      showToast(`Copied ${label} to clipboard`)
    } else {
      showToast(`Failed to copy ${label}`)
    }
  }

  const handleSavePostKit = () => {
    const newKit: PostKitHistory = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      form,
      captions: postKit.captions,
      hashtags: postKit.hashtags,
      hooks: postKit.hooks,
    }
    const updated = [newKit, ...history]
    setHistory(updated)
    savePostHistory(updated)
    showToast('Post Kit saved to history')
  }

  const handleLoadFromHistory = (kit: PostKitHistory) => {
    setForm(kit.form)
    setShowHistory(false)
    showToast(`Loaded "${kit.form.venueName || 'Untitled'}" from history`)
  }

  const handleDeleteFromHistory = (id: string) => {
    const updated = history.filter((kit) => kit.id !== id)
    setHistory(updated)
    savePostHistory(updated)
    showToast('Post Kit deleted')
  }

  const handleClearHistory = () => {
    if (confirm('Clear all post history? This cannot be undone.')) {
      setHistory([])
      savePostHistory([])
      showToast('History cleared')
    }
  }

  return (
    <section className="app-shell app-shell-wide tiktok-lab-page" aria-label="TikTok Lab">
      <section className="queue-panel tiktok-lab-header">
        <p className="eyebrow">Content Engine</p>
        <h1>TikTok Lab</h1>
        <p className="subcopy">
          Build post-ready ideas fast. Keep it simple, test two variants, and publish from phone, iPad, or desktop.
        </p>
        <div className="tiktok-lab-actions">
          <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
            Back to Admin
          </button>
          <button type="button" className="primary-button" onClick={() => setForm(DEFAULT_FORM)}>
            Reset
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSavePostKit}
            title={`Save "${form.venueName || 'Untitled'}" to history`}
          >
            💾 Save Post Kit
          </button>
          <button
            type="button"
            className={`secondary-button ${showHistory ? 'active' : ''}`}
            onClick={() => setShowHistory(!showHistory)}
            title={`View ${history.length} saved post kits`}
          >
            📋 History ({history.length})
          </button>
        </div>
      </section>

      <div className="tiktok-lab-container">
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
            <div className="tiktok-card-header">
              <h2>Hooks (first 2 seconds)</h2>
              <button
                type="button"
                className="copy-button"
                onClick={() => handleCopySection(postKit.hooks, 'hooks')}
                title="Copy all hooks"
                aria-label="Copy hooks section"
              >
                📋
              </button>
            </div>
            <ul>
              {postKit.hooks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>

          <article className="tiktok-card">
            <div className="tiktok-card-header">
              <h2>Caption Options</h2>
              <button
                type="button"
                className="copy-button"
                onClick={() => handleCopySection(postKit.captions, 'captions')}
                title="Copy all captions"
                aria-label="Copy captions section"
              >
                📋
              </button>
            </div>
            <ol>
              {postKit.captions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </article>

          <article className="tiktok-card">
            <div className="tiktok-card-header">
              <h2>Hashtag Pack</h2>
              <button
                type="button"
                className="copy-button"
                onClick={() => handleCopySection(postKit.hashtags.join(' '), 'hashtags')}
                title="Copy all hashtags"
                aria-label="Copy hashtags section"
              >
                📋
              </button>
            </div>
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

        {/* History Sidebar */}
        {showHistory && (
          <aside className="tiktok-history-panel">
            <div className="tiktok-history-header">
              <h2>Post History</h2>
              <button
                type="button"
                className="close-button"
                onClick={() => setShowHistory(false)}
                aria-label="Close history panel"
              >
                ✕
              </button>
            </div>

            {history.length === 0 ? (
              <p className="tiktok-history-empty">No saved post kits yet. Build and save one to get started.</p>
            ) : (
              <>
                <div className="tiktok-history-list">
                  {history.map((kit) => (
                    <div key={kit.id} className="tiktok-history-item">
                      <div className="tiktok-history-info">
                        <p className="tiktok-history-venue">{kit.form.venueName || 'Untitled'}</p>
                        <p className="tiktok-history-meta">
                          {kit.form.city && `${kit.form.city} • `}
                          {formatTimestamp(kit.timestamp)}
                        </p>
                      </div>
                      <div className="tiktok-history-actions">
                        <button
                          type="button"
                          className="icon-button"
                          onClick={() => handleLoadFromHistory(kit)}
                          title="Load this post kit"
                          aria-label="Load from history"
                        >
                          ⤴️
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          onClick={() => handleDeleteFromHistory(kit.id)}
                          title="Delete from history"
                          aria-label="Delete from history"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="danger-button tiktok-history-clear"
                  onClick={handleClearHistory}
                >
                  Clear All History
                </button>
              </>
            )}
          </aside>
        )}
      </div>

      {/* Toast Notification */}
      {toast.visible && <div className="tiktok-toast">{toast.message}</div>}
    </section>
  )
}
