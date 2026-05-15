import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AudioPlayer from '../components/ui/AudioPlayer'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'
import { supabase } from '../lib/supabase'

type Step = 'info' | 'datetime'
type EventType = 'halli-live' | 'harald-live' | 'karaoke' | 'build-self'

type IntroAudioLibraryItem = {
  path: string
  name: string
  url: string
  createdAt: string | null
}

const MAX_GIG_COVER_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_GIG_INTRO_AUDIO_BYTES = 12 * 1024 * 1024

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
  const [repeatDateInput, setRepeatDateInput] = useState('')
  const [additionalGigDates, setAdditionalGigDates] = useState<string[]>([])
  const [gigStartTime, setGigStartTime] = useState('')
  const [gigEndTime, setGigEndTime] = useState('')
  const [description, setDescription] = useState('')
  const [eventType, setEventType] = useState<EventType>('harald-live')
  const [karafunUrl, setKarafunUrl] = useState('')
  const [artistName, setArtistName] = useState('')
  const [audienceVotingEnabled, setAudienceVotingEnabled] = useState(true)
  const [showInAudienceNoGig, setShowInAudienceNoGig] = useState(true)
  const [isTestGig, setIsTestGig] = useState(false)
  const [autoLiveEnabled, setAutoLiveEnabled] = useState(false)
  const [introAudioUrl, setIntroAudioUrl] = useState<string | null>(null)
  const [introAudioName, setIntroAudioName] = useState('')
  const [selectedIntroAudioPath, setSelectedIntroAudioPath] = useState<string>('')
  const [introAudioLibrary, setIntroAudioLibrary] = useState<IntroAudioLibraryItem[]>([])
  const [introAudioLibraryLoading, setIntroAudioLibraryLoading] = useState(false)
  const [coverImageDataUrl, setCoverImageDataUrl] = useState<string | null>(null)
  const [coverImageName, setCoverImageName] = useState('')
  const [processingIntroAudio, setProcessingIntroAudio] = useState(false)
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

  const refreshIntroAudioLibrary = useCallback(async () => {
    if (!user?.id || !isHost) {
      setIntroAudioLibrary([])
      return
    }

    setIntroAudioLibraryLoading(true)

    try {
      const { data, error } = await supabase
        .storage
        .from('gig-intro-audio')
        .list(user.id, {
          limit: 100,
          sortBy: { column: 'created_at', order: 'desc' },
        })

      if (error) {
        throw new Error(error.message)
      }

      const nextLibrary = (data ?? [])
        .filter((file) => !file.name.endsWith('/'))
        .filter((file) => file.name.toLowerCase().endsWith('.mp3'))
        .map((file) => {
          const path = `${user.id}/${file.name}`
          const { data: publicUrlData } = supabase
            .storage
            .from('gig-intro-audio')
            .getPublicUrl(path)

          return {
            path,
            name: file.name,
            url: publicUrlData.publicUrl,
            createdAt: file.created_at ?? null,
          } satisfies IntroAudioLibraryItem
        })

      setIntroAudioLibrary(nextLibrary)
    } catch (error) {
      console.warn('CreateGigPage: failed to load intro audio library', error)
    } finally {
      if (isMountedRef.current) {
        setIntroAudioLibraryLoading(false)
      }
    }
  }, [isHost, user?.id])

  useEffect(() => {
    void refreshIntroAudioLibrary()
  }, [refreshIntroAudioLibrary])

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
    options?: {
      subtitle?: string
      gigDate?: string
      gigStartTime?: string
      gigEndTime?: string
      showInAudienceNoGig?: boolean
      coverImageUrl?: string | null
      eventType?: 'halli-live' | 'karaoke' | 'build-self'
      eventTheme?: 'harald-live' | 'human-jukebox' | 'karaoke'
      karafunUrl?: string
      artistName?: string | null
      audienceVotingEnabled?: boolean
      autoLiveEnabled?: boolean
      introAudioUrl?: string | null
    },
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

  const addAdditionalGigDate = () => {
    const normalizedDate = repeatDateInput.trim()

    if (!normalizedDate) {
      return
    }

    if (normalizedDate === gigDate) {
      setErrorText('That date is already set as the main gig date.')
      return
    }

    if (additionalGigDates.includes(normalizedDate)) {
      setErrorText('That repeat date is already added.')
      return
    }

    setAdditionalGigDates((currentDates) => [...currentDates, normalizedDate].sort((a, b) => a.localeCompare(b)))
    setRepeatDateInput('')
    setErrorText(null)
  }

  const removeAdditionalGigDate = (targetDate: string) => {
    setAdditionalGigDates((currentDates) => currentDates.filter((date) => date !== targetDate))
  }

  const doCreate = async (includeDatetime: boolean) => {
    if (busy) {
      return
    }

    setErrorText(null)
    setBusy(true)

    const persistedEventType: 'halli-live' | 'karaoke' | 'build-self' =
      eventType === 'harald-live' ? 'halli-live' : eventType
    const persistedEventTheme: 'harald-live' | 'human-jukebox' | 'karaoke' =
      eventType === 'karaoke' ? 'karaoke' : eventType === 'harald-live' ? 'harald-live' : 'human-jukebox'

    const createOptionsBase = {
      gigStartTime: gigStartTime || undefined,
      gigEndTime: gigEndTime || undefined,
      showInAudienceNoGig: isTestGig ? false : showInAudienceNoGig,
      coverImageUrl: coverImageDataUrl,
      subtitle: description.trim() || undefined,
      eventType: persistedEventType,
      eventTheme: persistedEventTheme,
      karafunUrl: karafunUrl.trim() || undefined,
      artistName: eventType === 'build-self' ? (artistName.trim() || undefined) : undefined,
      audienceVotingEnabled: eventType === 'build-self' ? audienceVotingEnabled : undefined,
      autoLiveEnabled,
      introAudioUrl,
      isTestGig,
    }

    const uniqueRepeatDates = additionalGigDates
      .filter((date) => date && date !== gigDate)
      .filter((date, index, allDates) => allDates.indexOf(date) === index)

    if (includeDatetime && uniqueRepeatDates.length > 0 && !gigDate) {
      setErrorText('Set the main gig date before adding repeat dates.')
      setBusy(false)
      return
    }

    try {
      if (includeDatetime) {
        const datesToCreate = gigDate
          ? [...uniqueRepeatDates, gigDate]
          : []

        if (datesToCreate.length > 0) {
          for (const nextDate of datesToCreate) {
            await withSubmitTimeout(runCreateWithLockRetry(gigName.trim(), venue.trim(), {
              ...createOptionsBase,
              gigDate: nextDate,
            }))
          }
        } else {
          await withSubmitTimeout(runCreateWithLockRetry(gigName.trim(), venue.trim(), {
            ...createOptionsBase,
            gigDate: gigDate || undefined,
          }))
        }
      } else {
        await withSubmitTimeout(runCreateWithLockRetry(gigName.trim(), venue.trim(), {
          ...createOptionsBase,
        }))
      }

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

  const onSelectIntroAudio = async (changeEvent: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      setIntroAudioUrl(null)
      setIntroAudioName('')
      setSelectedIntroAudioPath('')
      return
    }

    const isLikelyMp3 = selectedFile.type === 'audio/mpeg' || selectedFile.name.toLowerCase().endsWith('.mp3')
    if (!isLikelyMp3) {
      setErrorText('Please choose an MP3 file for the intro song.')
      return
    }

    if (selectedFile.size > MAX_GIG_INTRO_AUDIO_BYTES) {
      setErrorText('Intro audio is too large. Use an MP3 up to 12 MB.')
      return
    }

    if (!user?.id) {
      setErrorText('You must be signed in as host to upload intro audio.')
      return
    }

    setProcessingIntroAudio(true)

    try {
      const sanitizedFileName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `${user.id}/${Date.now()}-${sanitizedFileName}`

      const { error: uploadError } = await supabase
        .storage
        .from('gig-intro-audio')
        .upload(storagePath, selectedFile, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'audio/mpeg',
        })

      if (uploadError) {
        throw new Error(uploadError.message)
      }

      const { data: publicUrlData } = supabase
        .storage
        .from('gig-intro-audio')
        .getPublicUrl(storagePath)

      if (!isMountedRef.current) {
        return
      }

      setIntroAudioUrl(publicUrlData.publicUrl)
      setIntroAudioName(selectedFile.name)
      setSelectedIntroAudioPath(storagePath)
      setErrorText(null)
      void refreshIntroAudioLibrary()
    } catch (error) {
      if (!isMountedRef.current) {
        return
      }

      const message = error instanceof Error ? error.message : 'Unable to upload intro audio.'
      setErrorText(message)
    } finally {
      if (isMountedRef.current) {
        setProcessingIntroAudio(false)
      }
    }
  }

  const onSelectSavedIntroAudio = (path: string) => {
    setSelectedIntroAudioPath(path)

    if (!path) {
      setIntroAudioUrl(null)
      setIntroAudioName('')
      return
    }

    const selectedTrack = introAudioLibrary.find((item) => item.path === path)
    if (!selectedTrack) {
      return
    }

    setIntroAudioUrl(selectedTrack.url)
    setIntroAudioName(selectedTrack.name)
    setErrorText(null)
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
    const uniqueRepeatDatesCount = additionalGigDates
      .filter((date) => date && date !== gigDate)
      .filter((date, index, allDates) => allDates.indexOf(date) === index)
      .length
    const totalGigsToCreate = gigDate ? uniqueRepeatDatesCount + 1 : 1

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
                  onChange={(e) => {
                    const nextMainDate = e.target.value
                    setGigDate(nextMainDate)
                    setAdditionalGigDates((currentDates) => currentDates.filter((date) => date !== nextMainDate))
                  }}
                />
              </div>

              <div className="field-row">
                <label htmlFor="gig-repeat-date">Add repeat dates (optional)</label>
                <div className="create-gig-time-row">
                  <input
                    id="gig-repeat-date"
                    type="date"
                    value={repeatDateInput}
                    onChange={(e) => setRepeatDateInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !gigDate || !repeatDateInput}
                    onClick={addAdditionalGigDate}
                  >
                    Add date
                  </button>
                </div>
                <p className="field-hint">Set the main date first, then add more dates. The app will create a gig clone for each added date using the same settings.</p>
                {additionalGigDates.length > 0 ? (
                  <div className="create-gig-repeat-dates-list">
                    {additionalGigDates.map((date) => (
                      <button
                        key={date}
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => removeAdditionalGigDate(date)}
                        title="Remove repeat date"
                      >
                        {date} ×
                      </button>
                    ))}
                  </div>
                ) : null}
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
              <p className="field-hint">This will create {totalGigsToCreate} gig{totalGigsToCreate === 1 ? '' : 's'} in your calendar.</p>
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
          <div className="field-row">
            <label htmlFor="event-type">Choose event type</label>
            <select
              id="event-type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
            >
              <option value="harald-live">Harald Live</option>
              <option value="halli-live">The Human Jukebox</option>
              <option value="karaoke">Karaoke Event</option>
              <option value="build-self">Build Self Gig</option>
            </select>
          </div>
          {eventType === 'karaoke' ? (
            <div className="field-row">
              <label htmlFor="karafun-url">KaraFun playlist link (optional)</label>
              <input
                id="karafun-url"
                type="url"
                value={karafunUrl}
                onChange={(e) => setKarafunUrl(e.target.value)}
                placeholder="https://www.karafun.com/..."
              />
              <p className="field-hint">This link will be shown on the karaoke event page.</p>
            </div>
          ) : null}
          {eventType === 'build-self' ? (
            <>
              <div className="field-row">
                <label htmlFor="artist-name">Artist / performer name</label>
                <input
                  id="artist-name"
                  value={artistName}
                  onChange={(e) => setArtistName(e.target.value)}
                  placeholder="Your artist or band name"
                />
              </div>
              <label className="checkbox-row create-gig-checkbox-row" htmlFor="audience-voting">
                <input
                  id="audience-voting"
                  type="checkbox"
                  checked={audienceVotingEnabled}
                  onChange={(e) => setAudienceVotingEnabled(e.target.checked)}
                />
                <span>Allow audience to choose and vote for songs</span>
              </label>
              {!audienceVotingEnabled ? (
                <p className="field-hint">Audience will see the setlist only — no requests or voting.</p>
              ) : null}
            </>
          ) : null}
          <div className="field-row">
            <label htmlFor="gig-description">Description</label>
            <textarea
              id="gig-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell people what this event is about..."
              rows={3}
            />
          </div>
          <label className="checkbox-row create-gig-checkbox-row" htmlFor="show-in-audience-no-gig">
            <input
              id="show-in-audience-no-gig"
              type="checkbox"
              checked={showInAudienceNoGig}
              onChange={(e) => setShowInAudienceNoGig(e.target.checked)}
              disabled={isTestGig}
            />
            <span>Show this event in the Audience App when no gig is running</span>
          </label>
          {isTestGig ? (
            <p className="field-hint">Test gigs stay private and are never shown in audience fallback lists.</p>
          ) : null}

          <label className="checkbox-row create-gig-checkbox-row" htmlFor="is-test-gig">
            <input
              id="is-test-gig"
              type="checkbox"
              checked={isTestGig}
              onChange={(e) => {
                const nextIsTestGig = e.target.checked
                setIsTestGig(nextIsTestGig)

                if (nextIsTestGig) {
                  setShowInAudienceNoGig(false)
                }
              }}
            />
            <span>Create as private Test Gig (host-only)</span>
          </label>

          <label className="checkbox-row create-gig-checkbox-row" htmlFor="auto-live-enabled">
            <input
              id="auto-live-enabled"
              type="checkbox"
              checked={autoLiveEnabled}
              onChange={(e) => setAutoLiveEnabled(e.target.checked)}
            />
            <span>Automatically go live at scheduled start time</span>
          </label>
          {autoLiveEnabled ? (
            <p className="field-hint">The gig will activate automatically when the scheduled start time is reached — as long as the host dashboard is open in a browser.</p>
          ) : null}

          <div className="field-row create-gig-intro-panel">
            <label htmlFor="gig-intro-audio">Intro MP3 (optional)</label>
            <input
              id="gig-intro-audio"
              type="file"
              accept=".mp3,audio/mpeg"
              onChange={(e) => {
                void onSelectIntroAudio(e)
              }}
              disabled={processingIntroAudio || busy}
            />
            <p className="field-hint">Upload intro tracks once, then pick any saved MP3 for this gig. Max 12 MB per file.</p>
            {processingIntroAudio ? <p className="field-hint">Uploading intro audio…</p> : null}

            <label htmlFor="saved-intro-audio">Saved intro MP3 library</label>
            <select
              id="saved-intro-audio"
              value={selectedIntroAudioPath}
              onChange={(e) => onSelectSavedIntroAudio(e.target.value)}
              disabled={introAudioLibraryLoading || busy}
            >
              <option value="">Choose saved MP3…</option>
              {introAudioLibrary.map((track) => (
                <option key={track.path} value={track.path}>
                  {track.name}
                </option>
              ))}
            </select>
            {introAudioLibraryLoading ? <p className="field-hint">Loading saved intro tracks…</p> : null}

            {introAudioUrl ? (
              <div className="photo-preview create-gig-intro-preview">
                <AudioPlayer src={introAudioUrl} label={introAudioName || 'Intro MP3 selected'} />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setIntroAudioUrl(null)
                    setIntroAudioName('')
                    setSelectedIntroAudioPath('')
                  }}
                >
                  Remove intro audio
                </button>
              </div>
            ) : null}
          </div>

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
