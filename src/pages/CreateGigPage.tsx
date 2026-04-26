import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'
import { supabase } from '../lib/supabase'

type Step = 'info' | 'datetime'

const MAX_GIG_COVER_IMAGE_BYTES = 3 * 1024 * 1024

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not process that image. Try another file.'))
    }

    reader.onerror = () => {
      reject(new Error('Could not read that image file.'))
    }

    reader.readAsDataURL(file)
  })
}

function CreateGigPage() {
  const navigate = useNavigate()
  const { user, isHost, loading } = useAuthStore()
  const { event, createEvent } = useQueueStore()
  const [step, setStep] = useState<Step>('info')
  const [gigName, setGigName] = useState('')
  const [venue, setVenue] = useState('')
  const [gigDate, setGigDate] = useState('')
  const [gigStartTime, setGigStartTime] = useState('')
  const [gigEndTime, setGigEndTime] = useState('')
  const [showInAudienceNoGig, setShowInAudienceNoGig] = useState(false)
  const [coverImageDataUrl, setCoverImageDataUrl] = useState<string | null>(null)
  const [coverImageName, setCoverImageName] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const pendingTimerIdsRef = useRef<number[]>([])

  const clearTrackedTimeout = useCallback((timerId: number) => {
    window.clearTimeout(timerId)
    pendingTimerIdsRef.current = pendingTimerIdsRef.current.filter((currentTimerId) => currentTimerId !== timerId)
  }, [])

  const scheduleTrackedTimeout = useCallback((callback: () => void, delayMs: number) => {
    const timerId = window.setTimeout(() => {
      pendingTimerIdsRef.current = pendingTimerIdsRef.current.filter((currentTimerId) => currentTimerId !== timerId)
      callback()
    }, delayMs)

    pendingTimerIdsRef.current.push(timerId)
    return timerId
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      pendingTimerIdsRef.current.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      pendingTimerIdsRef.current = []
    }
  }, [])

  useEffect(() => {
    if (!user?.id || !isHost) {
      return
    }

    let isCurrent = true

    const loadHostCreateDefaults = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('default_gig_name, default_venue')
          .eq('user_id', user.id)
          .maybeSingle()

        if (!isCurrent || error || !data) {
          return
        }

        const defaultGigName = (data.default_gig_name ?? '').trim()
        const defaultVenue = (data.default_venue ?? '').trim()

        setGigName((currentValue) => currentValue.trim() || defaultGigName)
        setVenue((currentValue) => currentValue.trim() || defaultVenue)
      } catch (error) {
        console.warn('CreateGigPage: failed to load default gig settings', error)
      }
    }

    void loadHostCreateDefaults()

    return () => {
      isCurrent = false
    }
  }, [isHost, user?.id])

  const isAuthLockError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    return /lock broken|steal option|navigatorlockacquiretimeouterror|auth-token|released because another request stole it/i.test(message)
  }

  const isEventsRlsInsertError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    return /row-level security policy.*events/i.test(message)
  }

  const runCreateWithLockRetry = async (
    name: string,
    nextVenue: string,
    options?: { gigDate?: string; gigStartTime?: string; gigEndTime?: string; showInAudienceNoGig?: boolean },
  ) => {
    const maxAttempts = 6

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      try {
        await createEvent(name, nextVenue, options)
        return
      } catch (error) {
        const isLastAttempt = attemptIndex === maxAttempts - 1

        if (!isAuthLockError(error) || isLastAttempt) {
          throw error
        }

        await new Promise<void>((resolve) => {
          scheduleTrackedTimeout(resolve, 450 * (attemptIndex + 1))
        })
      }
    }
  }

  const withSubmitTimeout = <T,>(promise: Promise<T>) => {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = scheduleTrackedTimeout(() => {
        reject(new Error('Create gig is taking longer than expected. Please wait a moment and try again.'))
      }, 35_000)

      promise
        .then(resolve)
        .catch(reject)
        .finally(() => {
          clearTrackedTimeout(timeoutId)
        })
    })
  }

  const handleInfoSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (busy) {
      return
    }

    setErrorText(null)

    if (!gigName.trim()) {
      setErrorText('Gig name is required.')
      return
    }

    setStep('datetime')
  }

  const doCreate = async (includeDatetime: boolean) => {
    if (busy) {
      return
    }

    setErrorText(null)
    setBusy(true)

    const eventOptions = includeDatetime
      ? {
          gigDate: gigDate || undefined,
          gigStartTime: gigStartTime || undefined,
          gigEndTime: gigEndTime || undefined,
          showInAudienceNoGig,
          coverImageUrl: coverImageDataUrl,
        }
      : { showInAudienceNoGig, coverImageUrl: coverImageDataUrl }

    try {
      await withSubmitTimeout(runCreateWithLockRetry(gigName.trim(), venue.trim(), eventOptions))
      navigate('/admin/gig-control')
    } catch (error) {
      if (!isMountedRef.current) {
        return
      }

      if (isAuthLockError(error)) {
        setErrorText('Session lock is busy. Close duplicate admin tabs, wait 2 seconds, then try Create Gig again.')
        return
      }

      if (isEventsRlsInsertError(error)) {
        setErrorText('Create Gig was blocked by database permissions for this session. Sign out, sign back in with the host account, and try again.')
        return
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message)
            : 'Failed to create gig. Check your connection and try again.'
      setErrorText(errorMessage)
    } finally {
      if (isMountedRef.current) {
        setBusy(false)
      }
    }
  }

  const onSelectCoverImage = async (changeEvent: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      setCoverImageDataUrl(null)
      setCoverImageName('')
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorText('Please choose an image file for the gig cover.')
      return
    }

    if (selectedFile.size > MAX_GIG_COVER_IMAGE_BYTES) {
      setErrorText('Cover image is too large. Use an image up to 3 MB.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)

      if (!isMountedRef.current) {
        return
      }

      setCoverImageDataUrl(dataUrl)
      setCoverImageName(selectedFile.name)
      setErrorText(null)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to import that cover image.')
    }
  }

  if (loading) {
    return <section className="create-gig-shell"><section className="queue-panel">Checking host access...</section></section>
  }

  if (!isHost) {
    return (
      <section className="create-gig-shell" aria-label="Create gig">
        <section className="hero-card create-gig-card">
          <p className="eyebrow">Host Required</p>
          <h1>Create a New Gig</h1>
          <p className="subcopy">
            Sign out of this session, then sign back in with the host email to create and manage gigs.
          </p>
          <div className="hero-actions no-margin-bottom">
            <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
              Back to Dashboard
            </button>
          </div>
        </section>
      </section>
    )
  }

  if (step === 'datetime') {
    return (
      <section className="create-gig-shell" aria-label="Set gig date and time">
        <section className="hero-card create-gig-card">
          <p className="eyebrow">Step 2 of 2</p>
          <h1>Set Date &amp; Time?</h1>
          <p className="subcopy">
            Adding a date and time is optional. You can always update this later in Gig Settings.
          </p>

          <div className="create-gig-datetime-choice">
            <button
              type="button"
              className="create-gig-choice-btn primary-choice"
              disabled={busy}
              onClick={() => doCreate(false)}
            >
              <span className="choice-icon">⏭</span>
              <strong>Skip for now</strong>
              <span className="choice-hint">Create the gig without a date</span>
            </button>

            <div className="create-gig-choice-divider">or</div>

            <div className="create-gig-datetime-fields">
              <p className="create-gig-datetime-label">Set date &amp; time</p>

              <div className="field-row">
                <label htmlFor="gig-date">Date</label>
                <input
                  id="gig-date"
                  type="date"
                  value={gigDate}
                  onChange={(e) => setGigDate(e.target.value)}
                />
              </div>

              <div className="create-gig-time-row">
                <div className="field-row">
                  <label htmlFor="gig-start-time">Start time</label>
                  <input
                    id="gig-start-time"
                    type="time"
                    value={gigStartTime}
                    onChange={(e) => setGigStartTime(e.target.value)}
                  />
                </div>

                <div className="field-row">
                  <label htmlFor="gig-end-time">End time <span className="optional-label">(optional)</span></label>
                  <input
                    id="gig-end-time"
                    type="time"
                    value={gigEndTime}
                    onChange={(e) => setGigEndTime(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="button"
                className="primary-button create-gig-confirm-btn"
                disabled={busy}
                onClick={() => doCreate(true)}
              >
                {busy ? 'Creating…' : 'Create Gig with Date & Time'}
              </button>
            </div>
          </div>

          {errorText ? <p className="error-text">{errorText}</p> : null}

          <div className="create-gig-back-row">
            <button
              type="button"
              className="secondary-button"
              onClick={() => { setStep('info'); setErrorText(null) }}
              disabled={busy}
            >
              ← Back
            </button>
          </div>
        </section>
      </section>
    )
  }

  // Step 1: basic info
  return (
    <section className="create-gig-shell" aria-label="Create gig">
      <section className="hero-card create-gig-card">
        <p className="eyebrow">Step 1 of 2</p>
        <h1>Create a New Gig</h1>
        <p className="subcopy">
          Name your gig now, then choose from the dashboard which gig is live for your audience.
        </p>

        {event ? (
          <div className="active-gig-notice">
            <p className="meta-badge">Active gig: {event.name}{event.venue ? ` · ${event.venue}` : ''}</p>
            <p className="subcopy subcopy-top-gap">
              Creating a new gig saves it to your list. You can set any saved gig as the active audience room from the dashboard.
            </p>
          </div>
        ) : null}

        <form className="queue-form create-gig-form" onSubmit={handleInfoSubmit}>
          <div className="field-row">
            <label htmlFor="gig-name">Gig name *</label>
            <input
              id="gig-name"
              value={gigName}
              onChange={(e) => setGigName(e.target.value)}
              placeholder="Friday Night at The Anchor"
              autoFocus
              required
              aria-required="true"
            />
          </div>
          <div className="field-row">
            <label htmlFor="venue">Venue (optional)</label>
            <input
              id="venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="The Anchor Bar, Main Stage"
            />
          </div>
          <label className="checkbox-row create-gig-checkbox-row" htmlFor="show-in-audience-no-gig">
            <input
              id="show-in-audience-no-gig"
              type="checkbox"
              checked={showInAudienceNoGig}
              onChange={(e) => setShowInAudienceNoGig(e.target.checked)}
            />
            <span>Show this event in the Audience App when no gig is running</span>
          </label>

          <div className="field-row">
            <label htmlFor="gig-cover-image">Gig cover image (optional)</label>
            <input
              id="gig-cover-image"
              type="file"
              accept="image/*"
              onChange={(e) => {
                void onSelectCoverImage(e)
              }}
            />
            <p className="field-hint">Shown in Upcoming Events when no gig is live. Max 3 MB.</p>
            {coverImageDataUrl ? (
              <div className="photo-preview">
                <img src={coverImageDataUrl} alt="Gig cover preview" />
                <p className="field-hint">{coverImageName || 'Cover selected'}</p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setCoverImageDataUrl(null)
                    setCoverImageName('')
                  }}
                >
                  Remove cover
                </button>
              </div>
            ) : null}
          </div>

          {errorText ? <p className="error-text">{errorText}</p> : null}
          <div className="hero-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              Next →
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/admin')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </section>
  )
}

export default CreateGigPage
