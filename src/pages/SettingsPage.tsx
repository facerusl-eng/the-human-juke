import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { useAuthStore } from '../state/authStore'
import { supabase } from '../lib/supabase'

type HostSettings = {
  display_name: string
  bio: string
  instagram_url: string
  tiktok_url: string
  youtube_url: string
  facebook_url: string
  paypal_url: string
  buymeacoffee_url: string
  kofi_url: string
  default_gig_name: string
  default_venue: string
}

const DEFAULTS: HostSettings = {
  display_name: '',
  bio: '',
  instagram_url: '',
  tiktok_url: '',
  youtube_url: '',
  facebook_url: '',
  paypal_url: '',
  buymeacoffee_url: '',
  kofi_url: '',
  default_gig_name: '',
  default_venue: '',
}

function SettingsPage() {
  const { user, refreshProfile } = useAuthStore()
  const [settings, setSettings] = useState<HostSettings>(DEFAULTS)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user) return

    supabase
      .from('profiles')
      .select(
        'display_name, bio, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, buymeacoffee_url, kofi_url, default_gig_name, default_venue',
      )
      .eq('user_id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setLoadError('Could not load settings.')
          return
        }
        if (data) {
          setSettings({
            display_name: data.display_name ?? '',
            bio: data.bio ?? '',
            instagram_url: data.instagram_url ?? '',
            tiktok_url: data.tiktok_url ?? '',
            youtube_url: data.youtube_url ?? '',
            facebook_url: data.facebook_url ?? '',
            paypal_url: data.paypal_url ?? '',
            buymeacoffee_url: data.buymeacoffee_url ?? '',
            kofi_url: data.kofi_url ?? '',
            default_gig_name: data.default_gig_name ?? '',
            default_venue: data.default_venue ?? '',
          })
        }
      })
  }, [user])

  const set = (key: keyof HostSettings) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setSettings((prev) => ({ ...prev, [key]: e.target.value }))

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!user) return

    setSaving(true)
    setSaveError(null)
    setSaved(false)

    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: settings.display_name.trim() || null,
        bio: settings.bio.trim() || null,
        instagram_url: settings.instagram_url.trim() || null,
        tiktok_url: settings.tiktok_url.trim() || null,
        youtube_url: settings.youtube_url.trim() || null,
        facebook_url: settings.facebook_url.trim() || null,
        paypal_url: settings.paypal_url.trim() || null,
        buymeacoffee_url: settings.buymeacoffee_url.trim() || null,
        kofi_url: settings.kofi_url.trim() || null,
        default_gig_name: settings.default_gig_name.trim() || null,
        default_venue: settings.default_venue.trim() || null,
      })
      .eq('user_id', user.id)

    setSaving(false)

    if (error) {
      setSaveError('Save failed: ' + error.message)
      return
    }

    await refreshProfile()
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loadError) {
    return (
      <section className="admin-shell">
        <p className="subcopy settings-load-error">{loadError}</p>
      </section>
    )
  }

  return (
    <section className="admin-shell settings-page" aria-label="Settings">
      <section className="hero-card admin-card">
        <p className="eyebrow">Admin</p>
        <h1>Settings</h1>
        <p className="subcopy">Manage your performer profile, social links, tip jar, and event defaults.</p>
      </section>

      <form className="settings-form" onSubmit={onSubmit}>

        {/* ── Performer Profile ───────────────────────────── */}
        <fieldset className="settings-section">
          <legend>Performer Profile</legend>

          <label className="settings-field">
            <span>Display Name</span>
            <input
              type="text"
              placeholder="Your stage name"
              value={settings.display_name}
              onChange={set('display_name')}
              maxLength={80}
            />
          </label>

          <label className="settings-field">
            <span>Bio</span>
            <textarea
              placeholder="A short intro shown to your audience"
              value={settings.bio}
              onChange={set('bio')}
              rows={3}
              maxLength={400}
            />
          </label>
        </fieldset>

        {/* ── Social Links ───────────────────────────────── */}
        <fieldset className="settings-section">
          <legend>Social Links</legend>

          {(
            [
              { key: 'instagram_url', label: 'Instagram URL', placeholder: 'https://instagram.com/youraccount' },
              { key: 'tiktok_url', label: 'TikTok URL', placeholder: 'https://www.tiktok.com/@youraccount' },
              { key: 'youtube_url', label: 'YouTube URL', placeholder: 'https://www.youtube.com/@yourchannel' },
              { key: 'facebook_url', label: 'Facebook URL', placeholder: 'https://www.facebook.com/yourpage' },
            ] as { key: keyof HostSettings; label: string; placeholder: string }[]
          ).map(({ key, label, placeholder }) => (
            <label key={key} className="settings-field">
              <span>{label}</span>
              <input
                type="url"
                placeholder={placeholder}
                value={settings[key]}
                onChange={set(key)}
              />
            </label>
          ))}
        </fieldset>

        {/* ── Tip Jar ─────────────────────────────────────── */}
        <fieldset className="settings-section">
          <legend>Tip Jar</legend>

          {(
            [
              { key: 'paypal_url', label: 'PayPal URL', placeholder: 'https://paypal.me/yourhandle' },
              { key: 'buymeacoffee_url', label: 'Buy Me a Coffee URL', placeholder: 'https://buymeacoffee.com/yourhandle' },
              { key: 'kofi_url', label: 'Ko-fi URL', placeholder: 'https://ko-fi.com/yourhandle' },
            ] as { key: keyof HostSettings; label: string; placeholder: string }[]
          ).map(({ key, label, placeholder }) => (
            <label key={key} className="settings-field">
              <span>{label}</span>
              <input
                type="url"
                placeholder={placeholder}
                value={settings[key]}
                onChange={set(key)}
              />
            </label>
          ))}
        </fieldset>

        {/* ── Event Defaults ───────────────────────────────── */}
        <fieldset className="settings-section">
          <legend>Event Defaults</legend>

          <label className="settings-field">
            <span>Default Gig Name</span>
            <input
              type="text"
              placeholder="e.g. Friday Night Sessions"
              value={settings.default_gig_name}
              onChange={set('default_gig_name')}
              maxLength={100}
            />
          </label>

          <label className="settings-field">
            <span>Default Venue</span>
            <input
              type="text"
              placeholder="e.g. The Rusty Nail, Oslo"
              value={settings.default_venue}
              onChange={set('default_venue')}
              maxLength={100}
            />
          </label>
        </fieldset>

        {saveError && (
          <p className="settings-error" role="alert">{saveError}</p>
        )}

        <div className="settings-actions">
          {saved && <span className="meta-badge settings-saved-badge">Saved!</span>}
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default SettingsPage
