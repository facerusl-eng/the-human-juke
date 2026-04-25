import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '../state/authStore'
import { supabase } from '../lib/supabase'

type SettingsState = {
  display_name: string
  website_url: string
  bio: string
  performer_photo_url: string
  instagram_url: string
  tiktok_url: string
  youtube_url: string
  facebook_url: string
  paypal_url: string
  mobilpay_url: string
  contact_email: string
  theme_preset: string
  accent_color: string
  default_gig_name: string
  default_venue: string
  default_audience_bg_blur: number
  default_mirror_layout: string
}

type UndoRedoState = SettingsState & {
  timestamp: number
}

const AUTOSAVE_DELAY_MS = 2000
const MAX_UNDO_STATES = 20

const DEFAULTS: SettingsState = {
  display_name: '',
  website_url: '',
  bio: '',
  performer_photo_url: '',
  instagram_url: '',
  tiktok_url: '',
  youtube_url: '',
  facebook_url: '',
  paypal_url: '',
  mobilpay_url: '',
  contact_email: '',
  theme_preset: 'dark',
  accent_color: '#5dd7ff',
  default_gig_name: '',
  default_venue: '',
  default_audience_bg_blur: 5,
  default_mirror_layout: 'centered',
}

const THEME_PRESETS = {
  dark: { name: '🌙 Dark', accent: '#5dd7ff', bg: '#0d1136' },
  neon: { name: '⚡ Neon', accent: '#ff0080', bg: '#1a0a2e' },
  pub: { name: '🍺 Pub', accent: '#d4a574', bg: '#2a2420' },
  clean: { name: '☀️ Clean White', accent: '#1a73e8', bg: '#ffffff' },
  highcontrast: { name: '♿ High Contrast', accent: '#ffff00', bg: '#000000' },
}

function normalizeOptionalUrl(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`

  try {
    const normalizedUrl = new URL(withProtocol)
    if (!['http:', 'https:'].includes(normalizedUrl.protocol)) {
      return null
    }
    return normalizedUrl.toString()
  } catch {
    return null
  }
}

type CollapsibleSectionProps = {
  id: string
  title: string
  icon: string
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function CollapsibleSection({
  id,
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <div className="collapsible-section" data-section={id}>
      <button
        type="button"
        className="section-header"
        onClick={onToggle}
        aria-expanded={isExpanded ? 'true' : 'false'}
        aria-controls={`${id}-content`}
      >
        <span className="section-icon">{icon}</span>
        <span className="section-title">{title}</span>
        <span className="section-toggle">›</span>
      </button>
      {isExpanded && (
        <div id={`${id}-content`} className="section-content">
          {children}
        </div>
      )}
    </div>
  )
}

function SettingsPage() {
  const { user, refreshProfile } = useAuthStore()
  const [state, setState] = useState<SettingsState>(DEFAULTS)
  const [undoStack, setUndoStack] = useState<UndoRedoState[]>([])
  const [redoStack, setRedoStack] = useState<UndoRedoState[]>([])
  const [expandedSections, setExpandedSections] = useState(
    new Set(['account', 'performer', 'social', 'tipjar']),
  )
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'unsaved' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!user) {
      setState(DEFAULTS)
      setLoadError(null)
      setLoadingSettings(false)
      return
    }

    let isCurrent = true

    const loadSettings = async () => {
      setLoadError(null)
      setLoadingSettings(true)

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select(
            'display_name, bio, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, mobilpay_url, contact_email, default_gig_name, default_venue',
          )
          .eq('user_id', user.id)
          .single()

        if (!isCurrent) {
          return
        }

        if (error) {
          throw error
        }

        if (data) {
          setState((prev) => ({
            ...prev,
            display_name: data.display_name ?? '',
            bio: data.bio ?? '',
            instagram_url: data.instagram_url ?? '',
            tiktok_url: data.tiktok_url ?? '',
            youtube_url: data.youtube_url ?? '',
            facebook_url: data.facebook_url ?? '',
            paypal_url: data.paypal_url ?? '',
            mobilpay_url: data.mobilpay_url ?? '',
            contact_email: data.contact_email ?? '',
            default_gig_name: data.default_gig_name ?? '',
            default_venue: data.default_venue ?? '',
          }))
        }
      } catch (error) {
        console.warn('SettingsPage: failed to load host settings', error)
        if (isCurrent) {
          setLoadError('Could not load settings.')
        }
      } finally {
        if (isCurrent) {
          setLoadingSettings(false)
        }
      }
    }

    void loadSettings()

    return () => {
      isCurrent = false
    }
  }, [user])

  const clearAutosaveTimer = () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearAutosaveTimer()
    }
  }, [])

  const updateState = (newState: SettingsState) => {
    setState(newState)
    setSaveStatus('unsaved')
    triggerAutosave(newState)
  }

  const triggerAutosave = (newState: SettingsState) => {
    clearAutosaveTimer()
    setSaveStatus('saving')
    autosaveTimerRef.current = window.setTimeout(() => {
      void performSave(newState)
    }, AUTOSAVE_DELAY_MS)
  }

  const pushUndoState = () => {
    setUndoStack((current) => [
      ...current.slice(-MAX_UNDO_STATES + 1),
      { ...state, timestamp: Date.now() },
    ])
    setRedoStack([])
  }

  const performSave = async (stateToSave: SettingsState) => {
    if (!user) {
      setSaveError('Host session not available. Please sign in again.')
      setSaveStatus('error')
      console.warn('SettingsPage: save blocked because user is missing')
      return
    }

    setSaveError(null)

    const resolveOptionalLinkValue = (value: string) => {
      const trimmedValue = value.trim()
      if (!trimmedValue) {
        return null
      }

      // Prefer normalized URLs, but keep raw input so one field never blocks save.
      return normalizeOptionalUrl(trimmedValue) ?? trimmedValue
    }

    const normalizedSocialFields = {
      instagram_url: resolveOptionalLinkValue(stateToSave.instagram_url),
      tiktok_url: resolveOptionalLinkValue(stateToSave.tiktok_url),
      youtube_url: resolveOptionalLinkValue(stateToSave.youtube_url),
      facebook_url: resolveOptionalLinkValue(stateToSave.facebook_url),
      paypal_url: resolveOptionalLinkValue(stateToSave.paypal_url),
      website_url: resolveOptionalLinkValue(stateToSave.website_url),
    }

    // Core columns that always exist
    const corePayload = {
      display_name: stateToSave.display_name.trim() || null,
      bio: stateToSave.bio.trim() || null,
      instagram_url: normalizedSocialFields.instagram_url,
      tiktok_url: normalizedSocialFields.tiktok_url,
      youtube_url: normalizedSocialFields.youtube_url,
      facebook_url: normalizedSocialFields.facebook_url,
      paypal_url: normalizedSocialFields.paypal_url,
      mobilpay_url: stateToSave.mobilpay_url.trim() || null,
      contact_email: stateToSave.contact_email.trim() || null,
      default_gig_name: stateToSave.default_gig_name.trim() || null,
      default_venue: stateToSave.default_venue.trim() || null,
    }

    try {
      // Save core columns. Update first; if no profile row exists yet, insert one.
      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update(corePayload)
        .eq('user_id', user.id)
        .select('user_id')
        .maybeSingle()

      if (updateError) {
        throw updateError
      }

      if (!updatedProfile) {
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            user_id: user.id,
            ...corePayload,
          })

        if (insertError) {
          // If another write created the row in the meantime, retry the update once.
          const insertErrorCode = typeof insertError === 'object' && insertError !== null && 'code' in insertError
            ? String((insertError as { code?: unknown }).code)
            : ''

          if (insertErrorCode === '23505') {
            const { error: retryUpdateError } = await supabase
              .from('profiles')
              .update(corePayload)
              .eq('user_id', user.id)

            if (retryUpdateError) {
              throw retryUpdateError
            }
          } else {
            throw insertError
          }
        }
      }

      // Also try saving extended columns (requires migration to have been run — silent if not)
      void supabase
        .from('profiles')
        .update({
          website_url: normalizedSocialFields.website_url,
          performer_photo_url: stateToSave.performer_photo_url.trim() || null,
          theme_preset: stateToSave.theme_preset,
          accent_color: stateToSave.accent_color,
          default_audience_bg_blur: stateToSave.default_audience_bg_blur,
          default_mirror_layout: stateToSave.default_mirror_layout,
        })
        .eq('user_id', user.id)
        .then(({ error }) => {
          if (error) {
            console.warn('SettingsPage: extended columns not saved (migration pending?)', error.message)
          }
        })

      try {
        await refreshProfile()
      } catch (error) {
        console.warn('SettingsPage: profile refresh failed after save', error)
      }

      setSaveStatus('saved')
      window.setTimeout(() => {
        setSaveStatus('idle')
      }, 2000)
    } catch (error) {
      console.warn('SettingsPage: failed to save settings', error)
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message)
            : 'Unexpected save error.'
      setSaveError('Save failed: ' + errorMessage)
      setSaveStatus('error')
    }
  }

  const onUndo = () => {
    if (undoStack.length === 0) return
    const previousState = undoStack[undoStack.length - 1]
    setRedoStack((current) => [...current, { ...state, timestamp: Date.now() }])
    setUndoStack((current) => current.slice(0, -1))
    setState(previousState)
    setSaveStatus('unsaved')
    clearAutosaveTimer()
  }

  const onRedo = () => {
    if (redoStack.length === 0) return
    const nextState = redoStack[redoStack.length - 1]
    setUndoStack((current) => [...current, { ...state, timestamp: Date.now() }])
    setRedoStack((current) => current.slice(0, -1))
    setState(nextState)
    setSaveStatus('unsaved')
    clearAutosaveTimer()
  }

  const toggleSection = (sectionId: string) => {
    setExpandedSections((current) => {
      const next = new Set(current)
      next.has(sectionId) ? next.delete(sectionId) : next.add(sectionId)
      return next
    })
  }

  const handleExport = () => {
    const dataToExport = {
      exportDate: new Date().toISOString(),
      settings: state,
    }
    const json = JSON.stringify(dataToExport, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `performer-settings-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const importedSettings = data.settings || data

      pushUndoState()
      updateState({
        ...state,
        ...importedSettings,
        // Ensure theme preset is valid
        theme_preset: importedSettings.theme_preset && THEME_PRESETS[importedSettings.theme_preset as keyof typeof THEME_PRESETS]
          ? importedSettings.theme_preset
          : 'dark',
      })
    } catch (error) {
      setSaveError('Failed to import settings. Please check the file format.')
      console.warn('SettingsPage: import failed', error)
    }
    e.target.value = ''
  }

  const handleResetToDefaults = () => {
    if (!confirm('Are you sure? This will reset all settings to defaults.')) {
      return
    }
    pushUndoState()
    updateState(DEFAULTS)
  }

  const handleApplyTheme = (presetKey: string) => {
    pushUndoState()
    const preset = THEME_PRESETS[presetKey as keyof typeof THEME_PRESETS]
    if (preset) {
      updateState({
        ...state,
        theme_preset: presetKey,
        accent_color: preset.accent,
      })
    }
  }

  if (loadError) {
    return (
      <section className="admin-shell">
        <p className="subcopy settings-load-error">{loadError}</p>
      </section>
    )
  }

  return (
    <section className="admin-shell admin-settings-page" aria-label="Settings">
      {/* Header */}
      <div className="admin-settings-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h1>Settings</h1>
          <p className="subcopy">Manage your performer profile, appearance, and gig defaults.</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="admin-settings-toolbar">
        <div className="toolbar-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={undoStack.length === 0}
            onClick={onUndo}
            title="Undo (Ctrl+Z)"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={redoStack.length === 0}
            onClick={onRedo}
            title="Redo (Ctrl+Y)"
          >
            ↷ Redo
          </button>
        </div>

        <div className="toolbar-status">
          {saveStatus === 'unsaved' && <span className="status-badge unsaved">Unsaved Changes</span>}
          {saveStatus === 'saving' && <span className="status-badge saving">Saving...</span>}
          {saveStatus === 'saved' && <span className="status-badge saved">✓ Saved</span>}
          {saveStatus === 'error' && <span className="status-badge error">✕ Error</span>}
        </div>
      </div>

      {loadingSettings ? <p className="subcopy">Loading settings…</p> : null}

      <div className="admin-settings-form">
        {/* Account Settings */}
        <CollapsibleSection
          id="account"
          title="Account Settings"
          icon="👤"
          isExpanded={expandedSections.has('account')}
          onToggle={() => toggleSection('account')}
        >
          <div className="field-row">
            <label>
              <span>Display Name</span>
              <input
                type="text"
                placeholder="Your stage name"
                value={state.display_name}
                onChange={(e) => updateState({ ...state, display_name: e.target.value })}
                maxLength={80}
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Website</span>
              <input
                type="text"
                placeholder="https://yourwebsite.com"
                value={state.website_url}
                onChange={(e) => updateState({ ...state, website_url: e.target.value })}
              />
            </label>
          </div>
        </CollapsibleSection>

        {/* Performer Profile */}
        <CollapsibleSection
          id="performer"
          title="Performer Profile"
          icon="🎤"
          isExpanded={expandedSections.has('performer')}
          onToggle={() => toggleSection('performer')}
        >
          <div className="field-row">
            <label>
              <span>Short Bio</span>
              <textarea
                placeholder="A short intro shown to your audience"
                value={state.bio}
                onChange={(e) => updateState({ ...state, bio: e.target.value })}
                rows={3}
                maxLength={400}
              />
            </label>
            <p className="field-hint">{state.bio.length}/400 characters</p>
          </div>

          <div className="field-row">
            <label>
              <span>Performer Photo URL</span>
              <input
                type="text"
                placeholder="https://..."
                value={state.performer_photo_url}
                onChange={(e) => updateState({ ...state, performer_photo_url: e.target.value })}
              />
            </label>
            <p className="field-hint">Paste a direct image URL or upload to a service like Imgur</p>
            {state.performer_photo_url && (
              <div className="photo-preview">
                <img
                  src={state.performer_photo_url}
                  alt="Performer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Social Media */}
        <CollapsibleSection
          id="social"
          title="Social Media Links"
          icon="📱"
          isExpanded={expandedSections.has('social')}
          onToggle={() => toggleSection('social')}
        >
          <div className="social-links-grid">
            {[
              {
                key: 'instagram_url',
                label: '📷 Instagram',
                placeholder: 'https://instagram.com/youraccount',
              },
              {
                key: 'tiktok_url',
                label: '🎵 TikTok',
                placeholder: 'https://www.tiktok.com/@youraccount',
              },
              {
                key: 'youtube_url',
                label: '▶️ YouTube',
                placeholder: 'https://www.youtube.com/@yourchannel',
              },
              {
                key: 'facebook_url',
                label: '👍 Facebook',
                placeholder: 'https://www.facebook.com/yourpage',
              },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="field-row">
                <label>
                  <span>{label}</span>
                  <input
                    type="text"
                    placeholder={placeholder}
                    value={state[key as keyof SettingsState] as string}
                    onChange={(e) =>
                      updateState({
                        ...state,
                        [key]: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
            ))}

          <div className="field-row">
            <label>
              <span>✉ Contact Email</span>
              <input
                type="email"
                placeholder="you@example.com"
                value={state.contact_email}
                onChange={(e) => updateState({ ...state, contact_email: e.target.value })}
              />
            </label>
          </div>
          </div>
        </CollapsibleSection>

        {/* Tip Jar */}
        <CollapsibleSection
          id="tipjar"
          title="Tip Jar & Payment"
          icon="💰"
          isExpanded={expandedSections.has('tipjar')}
          onToggle={() => toggleSection('tipjar')}
        >
          <div className="field-row">
            <label>
              <span>PayPal Link</span>
              <input
                type="text"
                placeholder="https://paypal.me/yourhandle"
                value={state.paypal_url}
                onChange={(e) => updateState({ ...state, paypal_url: e.target.value })}
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>MobilePay Link</span>
              <input
                type="text"
                placeholder="mobilepay.dk/your-link or +4512345678"
                value={state.mobilpay_url}
                onChange={(e) => updateState({ ...state, mobilpay_url: e.target.value })}
              />
            </label>
          </div>
        </CollapsibleSection>

        {/* Theme & Branding */}
        <CollapsibleSection
          id="theme"
          title="Theme & Branding"
          icon="🎨"
          isExpanded={expandedSections.has('theme')}
          onToggle={() => toggleSection('theme')}
        >
          <div className="theme-presets-grid">
            {Object.entries(THEME_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                className={`theme-preset-card ${state.theme_preset === key ? 'selected' : ''}`}
                onClick={() => handleApplyTheme(key)}
                data-accent={preset.accent}
                data-bg={preset.bg}
              >
                <div className="preset-preview"></div>
                <span>{preset.name}</span>
              </button>
            ))}
          </div>

          <div className="field-row">
            <label>
              <span>Custom Accent Color</span>
              <div className="color-input-wrapper">
                <input
                  type="color"
                  value={state.accent_color}
                  onChange={(e) => updateState({ ...state, accent_color: e.target.value })}
                />
                <code>{state.accent_color}</code>
              </div>
            </label>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() => handleApplyTheme('dark')}
          >
            Reset to Default Theme
          </button>
        </CollapsibleSection>

        {/* Default Gig Settings */}
        <CollapsibleSection
          id="defaults"
          title="Default Gig Settings"
          icon="🎵"
          isExpanded={expandedSections.has('defaults')}
          onToggle={() => toggleSection('defaults')}
        >
          <div className="field-row">
            <label>
              <span>Default Gig Name</span>
              <input
                type="text"
                placeholder="e.g. Friday Night Sessions"
                value={state.default_gig_name}
                onChange={(e) => updateState({ ...state, default_gig_name: e.target.value })}
                maxLength={100}
              />
            </label>
          </div>

          <div className="field-row">
            <label>
              <span>Default Venue</span>
              <input
                type="text"
                placeholder="e.g. The Rusty Nail, Oslo"
                value={state.default_venue}
                onChange={(e) => updateState({ ...state, default_venue: e.target.value })}
                maxLength={100}
              />
            </label>
          </div>

          <p className="field-hint">These values auto-fill when you create a new gig.</p>
        </CollapsibleSection>

        {/* Default Audience Screen Settings */}
        <CollapsibleSection
          id="audience"
          title="Default Audience Screen"
          icon="🎪"
          isExpanded={expandedSections.has('audience')}
          onToggle={() => toggleSection('audience')}
        >
          <div className="field-row">
            <label>
              <span>Background Blur Effect (0-10)</span>
              <input
                type="range"
                min="0"
                max="10"
                value={state.default_audience_bg_blur}
                onChange={(e) => updateState({ ...state, default_audience_bg_blur: parseInt(e.target.value) })}
              />
              <p className="field-hint">Current blur: {state.default_audience_bg_blur}px</p>
            </label>
          </div>

          <p className="field-hint">Applied to new gigs when they are created.</p>
        </CollapsibleSection>

        {/* Default Mirror Screen Settings */}
        <CollapsibleSection
          id="mirror"
          title="Default Mirror Screen"
          icon="📺"
          isExpanded={expandedSections.has('mirror')}
          onToggle={() => toggleSection('mirror')}
        >
          <div className="field-row">
            <label>
              <span>Default Layout</span>
              <select
                value={state.default_mirror_layout}
                onChange={(e) => updateState({ ...state, default_mirror_layout: e.target.value })}
              >
                <option value="centered">Centered</option>
                <option value="side-by-side">Side by Side</option>
                <option value="minimal">Minimal</option>
              </select>
            </label>
          </div>

          <p className="field-hint">Applied to new gigs when they are created.</p>
        </CollapsibleSection>

        {/* Advanced Options */}
        <CollapsibleSection
          id="advanced"
          title="Advanced Options"
          icon="⚙️"
          isExpanded={false}
          onToggle={() => toggleSection('advanced')}
        >
          <div className="advanced-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleExport}
            >
              📥 Export Settings (JSON)
            </button>

            <label className="file-input-label">
              <span>📤 Import Settings (JSON)</span>
              <input
                type="file"
                accept="application/json"
                onChange={handleImport}
                className="visually-hidden"
              />
            </label>

            <button
              type="button"
              className="secondary-button danger"
              onClick={handleResetToDefaults}
            >
              🔄 Reset All to Defaults
            </button>
          </div>

          <p className="field-hint">
            Use export/import to backup settings or move them between accounts. Reset will clear all
            customizations.
          </p>
        </CollapsibleSection>

        {/* Error Message */}
        {saveError && <p className="error-message" role="alert">{saveError}</p>}
      </div>
    </section>
  )
}

export default SettingsPage
