import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { prepareFeedImage, shrinkPreparedFeedImage } from '../lib/feedImage'
import { readTextFromLocalStorage, saveTextToLocalStorage } from '../lib/saveHandling'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'
import { IconButton, PrimaryButton, SectionHeader } from './ui'
import { demoMode } from '../demo/demoMode'
import { DEMO_FEED_POSTS, DEMO_LIVE_INCOMING_POSTS } from '../demo/demoFeedPosts'
import type { DemoFeedPost } from '../demo/demoFeedPosts'

type FeedPost = {
  id: string
  event_id: string
  user_id: string
  author_name: string
  message: string
  image_data_url: string | null
  created_at: string
}

type LiveFeedPanelProps = {
  mode: 'audience' | 'mirror' | 'page'
  showComposer?: boolean
  title?: string
  showModerationControls?: boolean
}

const QUICK_EMOJIS = ['🔥', '🎶', '👏', '😍', '😂', '🥳', '🤘', '❤️']
const AUTHOR_NAME_STORAGE_KEY = 'human-jukebox-feed-author-name'
const FEED_IMAGE_QUEUE_INTERVAL_MS = 7000
const FEED_POLL_INTERVAL_MS = 5000
const FEED_FETCH_DEBOUNCE_MS = 300
const FEED_MAX_POSTS = 40
const FEED_PICKER_RECONNECT_SUPPRESS_MS = 20000
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif']

function getStoredAuthorName() {
  if (typeof window === 'undefined') {
    return ''
  }

  return readTextFromLocalStorage(AUTHOR_NAME_STORAGE_KEY, '')
}

function normalizeAuthorName(authorName: string, fallbackName: string) {
  const trimmedName = authorName.trim()

  if (!trimmedName) {
    return fallbackName
  }

  return trimmedName.slice(0, 28)
}

function isAuthRecoverableInsertError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  return message.includes('jwt')
    || message.includes('token')
    || message.includes('not authenticated')
    || message.includes('row-level security')
    || message.includes('permission denied')
}

function isPotentialImagePayloadError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  return message.includes('payload')
    || message.includes('too large')
    || message.includes('413')
    || message.includes('request entity')
    || message.includes('body exceeded')
    || message.includes('content length')
    || message.includes('networkerror')
    || message.includes('failed to fetch')
}

function getSuggestedAuthorName(email: string | undefined, isHost: boolean) {
  if (isHost) {
    return 'Host'
  }

  if (email) {
    return email.split('@')[0]
  }

  return 'Guest'
}

function formatPostTime(createdAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(createdAt))
}


function resolveVisiblePosts(posts: FeedPost[], now: number) {

  const imagePostsOldestFirst = [...posts]
    .filter((post) => Boolean(normalizeImageSource(post.image_data_url)))
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())

  const unlockByImagePostId = new Map<string, number>()
  let previousUnlockAt = 0

  for (const imagePost of imagePostsOldestFirst) {
    const createdAtMs = new Date(imagePost.created_at).getTime()
    const safeCreatedAtMs = Number.isFinite(createdAtMs) ? createdAtMs : now
    const baseUnlockAt = safeCreatedAtMs
    const unlockAt = previousUnlockAt > 0
      ? Math.max(baseUnlockAt, previousUnlockAt + FEED_IMAGE_QUEUE_INTERVAL_MS)
      : baseUnlockAt

    unlockByImagePostId.set(imagePost.id, unlockAt)
    previousUnlockAt = unlockAt
  }

  return posts.filter((post) => {
    const normalizedImageSource = normalizeImageSource(post.image_data_url)

    if (!normalizedImageSource) {
      return true
    }

    const unlockAt = unlockByImagePostId.get(post.id)
    if (!unlockAt) {
      return true
    }

    return unlockAt <= now
  })
}

function hasSupportedImageExtension(fileName: string) {
  const normalizedName = fileName.trim().toLowerCase()
  return SUPPORTED_IMAGE_EXTENSIONS.some((extension) => normalizedName.endsWith(extension))
}

function isSupportedImageFile(file: File) {
  const normalizedType = file.type.trim().toLowerCase()

  if (normalizedType.startsWith('image/')) {
    return true
  }

  return hasSupportedImageExtension(file.name)
}

function normalizeImageSource(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()

  if (!normalizedValue || normalizedValue.toLowerCase() === 'undefined' || normalizedValue.toLowerCase() === 'null') {
    return null
  }

  return normalizedValue
}

function LiveFeedPanel({
  mode,
  showComposer = true,
  title = 'Live Feed',
  showModerationControls = true,
}: LiveFeedPanelProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const isFetchingPostsRef = useRef(false)
  const hasQueuedReloadRef = useRef(false)
  const reloadTimerIdRef = useRef<number | null>(null)
  const suppressReconnectWarningUntilRef = useRef(0)
  const previewObjectUrlRef = useRef<string | null>(null)
  const lastHandledFileSignatureRef = useRef<string | null>(null)
  const { user, isHost } = useAuthStore()
  const { event } = useQueueStore()
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [message, setMessage] = useState('')
  const [authorName, setAuthorName] = useState(() => getStoredAuthorName())
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [isPreparingImage, setIsPreparingImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [selectedImageName, setSelectedImageName] = useState<string | null>(null)
  const [imageStatusText, setImageStatusText] = useState<string | null>(null)
  const [feedNow, setFeedNow] = useState(() => Date.now())
  const suggestedAuthorName = useMemo(
    () => getSuggestedAuthorName(user?.email, isHost),
    [isHost, user?.email],
  )
  const resolvedAuthorName = authorName.trim() || suggestedAuthorName
  const showJumpLink = mode === 'audience'
  const isMirrorMode = mode === 'mirror'
  const previewImageSrc = imagePreviewUrl ?? imageDataUrl
  const visiblePosts = useMemo(
    () => (isMirrorMode ? resolveVisiblePosts(posts, feedNow) : posts),
    [feedNow, isMirrorMode, posts],
  )

  const suppressReconnectWarning = () => {
    suppressReconnectWarningUntilRef.current = Date.now() + FEED_PICKER_RECONNECT_SUPPRESS_MS
  }

  const shouldSuppressReconnectWarning = () => Date.now() < suppressReconnectWarningUntilRef.current

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(AUTHOR_NAME_STORAGE_KEY, authorName.trim())
    if (!result.success) {
      console.warn('LiveFeedPanel: failed to save author name to localStorage', result.error)
    }
  }, [authorName])

  useEffect(() => {
    if (!isMirrorMode) {
      return
    }

    const timer = window.setInterval(() => {
      setFeedNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [isMirrorMode])

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current)
        previewObjectUrlRef.current = null
      }
    }
  }, [])

  // Demo mode: trickle in "live" incoming posts after a short delay
  useEffect(() => {
    if (!demoMode) return

    const timers = DEMO_LIVE_INCOMING_POSTS.map((post, index) => {
      const delayMs = 6000 + index * 9000 // 6s, then 15s
      return window.setTimeout(() => {
        const livePost: DemoFeedPost = { ...post, created_at: new Date().toISOString() }
        setPosts((current) => {
          if (current.some((p) => p.id === livePost.id)) return current
          return [livePost as FeedPost, ...current]
        })
      }, delayMs)
    })

    return () => {
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [])

  useEffect(() => {  // eslint-disable-line react-hooks/exhaustive-deps
    // Demo mode: load fake posts immediately, skip all Supabase logic
    if (demoMode) {
      setPosts(DEMO_FEED_POSTS as FeedPost[])
      setLoading(false)
      return
    }

    let isCurrent = true
    let pollTimerId: number | null = null
    let channel: ReturnType<typeof supabase.channel> | null = null
    let channelReconnectTimerId: number | null = null
    let channelReconnectAttempt = 0

    const loadPosts = async (silent = false) => {
      if (isFetchingPostsRef.current) {
        hasQueuedReloadRef.current = true
        return
      }

      isFetchingPostsRef.current = true

      if (!event?.id) {
        if (isCurrent) {
          setPosts([])
          setLoading(false)
        }
        isFetchingPostsRef.current = false
        return
      }

      if (isCurrent && !silent) {
        setLoading(true)
      }

      try {
        const { data, error } = await supabase
          .from('feed_posts')
          .select('id, event_id, user_id, author_name, message, image_data_url, created_at')
          .eq('event_id', event.id)
          .order('created_at', { ascending: false })
          .limit(FEED_MAX_POSTS)

        if (!isCurrent) {
          isFetchingPostsRef.current = false
          return
        }

        if (error) {
          throw error
        }

        setErrorText(null)
        setPosts((data ?? []) as FeedPost[])
      } catch (error) {
        console.warn('LiveFeedPanel: failed to load posts', error)
        if (isCurrent) {
          setErrorText('Unable to load the live feed right now.')
        }
      } finally {
        if (isCurrent) {
          setLoading(false)
        }

        isFetchingPostsRef.current = false

        if (hasQueuedReloadRef.current) {
          hasQueuedReloadRef.current = false
          void loadPosts(true)
        }
      }
    }

    const requestReload = (silent = true) => {
      if (reloadTimerIdRef.current !== null) {
        return
      }

      reloadTimerIdRef.current = window.setTimeout(() => {
        reloadTimerIdRef.current = null
        void loadPosts(silent)
      }, FEED_FETCH_DEBOUNCE_MS)
    }

    void loadPosts(false)

    const clearChannelReconnectTimer = () => {
      if (channelReconnectTimerId !== null) {
        window.clearTimeout(channelReconnectTimerId)
        channelReconnectTimerId = null
      }
    }

    const disconnectFeedChannel = () => {
      if (!channel) {
        return
      }

      void supabase.removeChannel(channel)
      channel = null
    }

    const connectFeedChannel = () => {
      if (!isCurrent || !event?.id) {
        return
      }

      clearChannelReconnectTimer()
      disconnectFeedChannel()

      const nextChannel = supabase
        .channel(`feed-posts-${event.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'feed_posts',
            filter: `event_id=eq.${event.id}`,
          },
          () => {
            requestReload(true)
          },
        )
        .subscribe((status) => {
          if (!isCurrent || channel !== nextChannel) {
            return
          }

          if (status === 'SUBSCRIBED') {
            channelReconnectAttempt = 0
            setErrorText(null)
            requestReload(true)
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (!shouldSuppressReconnectWarning()) {
              setErrorText('Feed realtime is reconnecting. Showing latest posts...')
            }
            requestReload(true)

            if (channelReconnectTimerId !== null) {
              return
            }

            const retryDelayMs = Math.min(1000 * (2 ** channelReconnectAttempt), 8000)
            channelReconnectAttempt += 1
            channelReconnectTimerId = window.setTimeout(() => {
              channelReconnectTimerId = null
              connectFeedChannel()
            }, retryDelayMs)
          }
        })

      channel = nextChannel
    }

    if (!event?.id) {
      return () => {
        isCurrent = false
      }
    }

    connectFeedChannel()

    pollTimerId = window.setInterval(() => {
      if (isCurrent && !document.hidden) {
        requestReload(true)
      }
    }, FEED_POLL_INTERVAL_MS)

    const reloadOnReconnect = () => {
      if (!document.hidden) {
        if (shouldSuppressReconnectWarning()) {
          requestReload(true)
          return
        }

        connectFeedChannel()
        requestReload(true)
      }
    }

    window.addEventListener('focus', reloadOnReconnect)
    window.addEventListener('online', reloadOnReconnect)
    window.addEventListener('pageshow', reloadOnReconnect)
    document.addEventListener('visibilitychange', reloadOnReconnect)

    return () => {
      isCurrent = false
      isFetchingPostsRef.current = false
      hasQueuedReloadRef.current = false
      clearChannelReconnectTimer()
      if (reloadTimerIdRef.current !== null) {
        window.clearTimeout(reloadTimerIdRef.current)
        reloadTimerIdRef.current = null
      }
      if (pollTimerId !== null) {
        window.clearInterval(pollTimerId)
      }
      window.removeEventListener('focus', reloadOnReconnect)
      window.removeEventListener('online', reloadOnReconnect)
      window.removeEventListener('pageshow', reloadOnReconnect)
      document.removeEventListener('visibilitychange', reloadOnReconnect)
      disconnectFeedChannel()
    }
  }, [event?.id])

  const processSelectedImage = async (file: File, inputElement: HTMLInputElement) => {
    setErrorText(null)
    setSelectedImageName(file.name || 'Camera photo')
    setImageStatusText('Photo selected. Preparing...')

    if (file.size === 0) {
      setImageDataUrl(null)
      setImagePreviewUrl(null)
      setSelectedImageName(null)
      setImageStatusText(null)
      setIsPreparingImage(false)
      setErrorText('Camera did not return a usable photo. Please try again or choose from gallery.')
      inputElement.value = ''
      return
    }

    if (!isSupportedImageFile(file)) {
      setImageDataUrl(null)
      setImagePreviewUrl(null)
      setSelectedImageName(null)
      setImageStatusText(null)
      setIsPreparingImage(false)
      setErrorText('Unsupported image format. Please choose JPG, PNG, WEBP, GIF, BMP, or HEIC/HEIF.')
      inputElement.value = ''
      return
    }

    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
      previewObjectUrlRef.current = null
    }

    try {
      const previewUrl = URL.createObjectURL(file)
      previewObjectUrlRef.current = previewUrl
      setImagePreviewUrl(previewUrl)
    } catch {
      setImagePreviewUrl(null)
    }

    setIsPreparingImage(true)

    try {
      const preparedImage = await prepareFeedImage(file)
      setImageDataUrl(preparedImage)
      setImageStatusText('Photo ready.')
    } catch (error) {
      setImageDataUrl(null)
      setImagePreviewUrl(null)
      setSelectedImageName(null)
      setImageStatusText(null)
      setErrorText(error instanceof Error ? error.message : 'Unable to use that photo.')
    } finally {
      setIsPreparingImage(false)
      inputElement.value = ''
    }
  }

  const onImageSelected = (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const inputElement = changeEvent.currentTarget
    const tryHandleSelection = (delayMs = 0) => {
      window.setTimeout(() => {
        const file = inputElement.files?.[0]

        if (!file) {
          if (delayMs === 0) {
            tryHandleSelection(180)
            return
          }

          setImageStatusText('No photo selected yet.')
          setIsPreparingImage(false)
          return
        }

        const fileSignature = `${file.name}|${file.size}|${file.lastModified}`

        if (lastHandledFileSignatureRef.current === fileSignature) {
          return
        }

        lastHandledFileSignatureRef.current = fileSignature
        void processSelectedImage(file, inputElement)
      }, delayMs)
    }

    tryHandleSelection(0)
  }

  const clearSelectedImage = () => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
      previewObjectUrlRef.current = null
    }

    setImageDataUrl(null)
    setImagePreviewUrl(null)
    setSelectedImageName(null)
    setImageStatusText(null)
    setIsPreparingImage(false)
    lastHandledFileSignatureRef.current = null
    if (cameraInputRef.current) {
      cameraInputRef.current.value = ''
    }

    if (galleryInputRef.current) {
      galleryInputRef.current.value = ''
    }
  }

  const resolvePostingUser = async (): Promise<User> => {
    if (user) {
      return user
    }

    const { data: existingUserData } = await supabase.auth.getUser()

    if (existingUserData.user) {
      return existingUserData.user
    }

    const { error: anonymousSignInError } = await supabase.auth.signInAnonymously()

    if (anonymousSignInError) {
      throw new Error('Audience sign-in expired. Refresh the page and try posting again.')
    }

    const { data: nextUserData } = await supabase.auth.getUser()

    if (!nextUserData.user) {
      throw new Error('Audience sign-in expired. Refresh the page and try posting again.')
    }

    return nextUserData.user
  }

  const onSubmit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    setErrorText(null)

    const trimmedMessage = message.trim()

    if (isPreparingImage) {
      setErrorText('Photo is still being prepared. Please wait a moment and post again.')
      return
    }

    if (!trimmedMessage && !imageDataUrl) {
      setErrorText('Write a message, add an image, or both.')
      return
    }

    // Demo mode: post directly to in-memory state, no Supabase
    if (demoMode) {
      const demoPost: FeedPost = {
        id: `demo-user-post-${Date.now()}`,
        event_id: 'demo-event-001',
        user_id: 'demo-audience-user',
        author_name: normalizeAuthorName(resolvedAuthorName, suggestedAuthorName),
        message: trimmedMessage,
        image_data_url: imageDataUrl,
        created_at: new Date().toISOString(),
      }
      setPosts((current) => [demoPost, ...current].slice(0, FEED_MAX_POSTS))
      setMessage('')
      clearSelectedImage()
      return
    }

    if (!event?.id) {
      setErrorText('Join the audience before posting to the live feed.')
      return
    }

    setBusy(true)

    try {
      const normalizedAuthorName = normalizeAuthorName(resolvedAuthorName, suggestedAuthorName)
      let postingUser = await resolvePostingUser()

      const insertPost = async (postingUserId: string, imagePayload: string | null = imageDataUrl) => {
        const { data, error } = await supabase
          .from('feed_posts')
          .insert({
            event_id: event.id,
            user_id: postingUserId,
            author_name: normalizedAuthorName,
            message: trimmedMessage,
            image_data_url: imagePayload,
          })
          .select('id, event_id, user_id, author_name, message, image_data_url, created_at')
          .single()

        if (error) {
          throw error
        }

        return data as FeedPost
      }

      let insertedPost: FeedPost | null = null
      let imagePayload = imageDataUrl

      try {
        insertedPost = await insertPost(postingUser.id, imagePayload)
      } catch (error) {
        if (isAuthRecoverableInsertError(error)) {
          const { data: sessionData } = await supabase.auth.getSession()

          if (sessionData.session) {
            const { error: refreshError } = await supabase.auth.refreshSession()

            if (refreshError) {
              throw error
            }
          } else if (postingUser.is_anonymous) {
            const { error: signInError } = await supabase.auth.signInAnonymously()

            if (signInError) {
              throw error
            }
          } else {
            throw error
          }

          postingUser = await resolvePostingUser()
          insertedPost = await insertPost(postingUser.id, imagePayload)
        } else if (imagePayload && isPotentialImagePayloadError(error)) {
          setImageStatusText('Photo is being optimized for posting...')
          const smallerImagePayload = await shrinkPreparedFeedImage(imagePayload)

          if (!smallerImagePayload || smallerImagePayload === imagePayload) {
            throw error
          }

          imagePayload = smallerImagePayload
          setImageDataUrl(smallerImagePayload)
          setImageStatusText('Photo ready.')
          insertedPost = await insertPost(postingUser.id, imagePayload)
        } else {
          throw error
        }
      }

      if (insertedPost) {
        setPosts((currentPosts) => {
          if (currentPosts.some((post) => post.id === insertedPost.id)) {
            return currentPosts
          }

              return [insertedPost as FeedPost, ...currentPosts].slice(0, FEED_MAX_POSTS)
        })
      }

      setMessage('')
      setImageStatusText(null)
      clearSelectedImage()
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : (typeof error === 'object' && error !== null && 'message' in error)
          ? `${(error as { message: unknown }).message}`
          : 'Unable to post to the live feed.'
      console.error('LiveFeedPanel: post failed', error)
      setErrorText(errorMessage || 'Unable to post to the live feed.')
    } finally {
      setBusy(false)
    }
  }

  const deletePost = async (postId: string) => {
    if (!isHost || !showModerationControls) {
      return
    }

    setErrorText(null)

    try {
      const { error } = await supabase
        .from('feed_posts')
        .delete()
        .eq('id', postId)

      if (error) {
        throw error
      }
    } catch (error) {
      console.warn('LiveFeedPanel: failed to delete post', { postId, error })
      setErrorText('Unable to remove that post right now.')
    }
  }

  return (
    <section className={`live-feed-panel live-feed-panel-${mode}`} aria-label={title}>
      <div className="live-feed-head">
        <SectionHeader eyebrow="Community" title={title} className="live-feed-headline" />
        <span className="live-feed-live-badge" aria-label="Live feed active">● LIVE</span>
        {showJumpLink ? (
          <Link to="/feed" className="live-feed-link" aria-label="Open feed">
            <span aria-hidden="true">↗</span>
            Open Feed
          </Link>
        ) : null}
      </div>

      {showComposer ? (
        <form className="live-feed-composer" onSubmit={onSubmit}>
          <div className="field-row">
            <label htmlFor={`feed-author-${mode}`}>Display name</label>
            <input
              id={`feed-author-${mode}`}
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
              placeholder={suggestedAuthorName}
              maxLength={28}
            />
          </div>

          <div className="field-row">
            <label htmlFor={`feed-message-${mode}`}>Message</label>
            <textarea
              id={`feed-message-${mode}`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Send a shout-out, dedication, or crowd moment..."
              rows={4}
              maxLength={280}
            />
          </div>

          <div className="live-feed-emoji-row" aria-label="Quick emojis">
            {QUICK_EMOJIS.map((emoji) => (
              <IconButton
                key={emoji}
                icon={emoji}
                label={`Add ${emoji}`}
                className="live-feed-emoji-chip"
                onClick={() => setMessage((currentMessage) => `${currentMessage}${emoji}`)}
              />
            ))}
          </div>

          <div className="live-feed-media-row">
            <input
              id={`feed-image-camera-${mode}`}
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              className="live-feed-file-input"
              aria-label="Take a crowd feed photo"
              onClick={(event) => {
                suppressReconnectWarning()
                event.currentTarget.value = ''
                event.currentTarget.setAttribute('capture', 'environment')
              }}
              onChange={onImageSelected}
              onInput={(event) => { void onImageSelected(event as unknown as ChangeEvent<HTMLInputElement>) }}
            />
            <input
              id={`feed-image-gallery-${mode}`}
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="live-feed-file-input"
              aria-label="Choose a crowd feed photo"
              onClick={(event) => {
                suppressReconnectWarning()
                event.currentTarget.value = ''
                event.currentTarget.removeAttribute('capture')
              }}
              onChange={onImageSelected}
            />
            <label
              htmlFor={`feed-image-camera-${mode}`}
              className="secondary-button"
              onClick={suppressReconnectWarning}
            >
              <span aria-hidden="true">📷</span> Take Photo
            </label>
            <label
              htmlFor={`feed-image-gallery-${mode}`}
              className="ghost-button"
              onClick={suppressReconnectWarning}
            >
              <span aria-hidden="true">🖼</span> Choose Photo
            </label>
            {selectedImageName ? <span className="live-feed-image-name">{selectedImageName}</span> : null}
            {imageStatusText ? <span className="live-feed-helper-text">{imageStatusText}</span> : null}
            {previewImageSrc ? (
              <PrimaryButton type="button" variant="ghost" onClick={clearSelectedImage}>
                Remove Image
              </PrimaryButton>
            ) : null}
          </div>

          <p className="live-feed-helper-text no-margin">
            On phone: tap <strong>Take Photo</strong> to capture and share instantly to the live feed.
          </p>

          {previewImageSrc ? (
            <img src={previewImageSrc} alt="Selected feed upload preview" className="live-feed-image-preview" />
          ) : null}

          {errorText ? <p className="error-text no-margin">{errorText}</p> : null}

          <div className="live-feed-actions">
            <PrimaryButton
              type="submit"
              className="primary-button"
              disabled={busy || !event}
            >
              {busy ? 'Posting...' : 'Post to Feed'}
            </PrimaryButton>
            <span className="live-feed-helper-text">{message.trim().length}/280</span>
          </div>
        </form>
      ) : null}

      {loading ? <p className="subcopy no-margin">Loading the live feed...</p> : null}

      {!loading ? (
        <div className="live-feed-list">
          {visiblePosts.length === 0 ? (
            <p className="subcopy no-margin">
              {isMirrorMode
                ? 'No community posts yet. Audience shout-outs and photos will appear here live.'
                : 'No feed posts yet. Start the conversation.'}
            </p>
          ) : (
            visiblePosts.map((post) => {
              const canDelete = showModerationControls && isHost
              const normalizedPostImageSource = normalizeImageSource(post.image_data_url)
              const hasImage = Boolean(normalizedPostImageSource)
              const useMirrorPhotoLayout = isMirrorMode && hasImage
              const isMirrorTextPost = isMirrorMode && !hasImage && Boolean(post.message?.trim())
              const imageNode = normalizedPostImageSource ? (
                <div className="live-feed-post-image-wrapper">
                  <img src={normalizedPostImageSource} alt={`Shared by ${post.author_name}`} className="live-feed-post-image" />
                  {useMirrorPhotoLayout ? <strong className="live-feed-post-image-author">{post.author_name}</strong> : null}
                </div>
              ) : null

              return (
                <article
                  key={post.id}
                  className={`live-feed-post queue-slide-in ${hasImage ? 'live-feed-post-polaroid' : ''} ${isMirrorTextPost ? 'live-feed-post-mirror-text' : ''}`.trim()}
                >
                  {isMirrorMode ? imageNode : null}

                  <div className="live-feed-post-head">
                    {useMirrorPhotoLayout ? <span>{formatPostTime(post.created_at)}</span> : (
                      <div>
                        <strong>{post.author_name}</strong>
                        <span>{formatPostTime(post.created_at)}</span>
                      </div>
                    )}
                    {canDelete ? (
                      <PrimaryButton type="button" variant="ghost" className="ghost-button live-feed-delete" onClick={() => { void deletePost(post.id) }}>
                        Remove
                      </PrimaryButton>
                    ) : null}
                  </div>

                  {post.message ? <p className="live-feed-post-message">{post.message}</p> : null}
                  {!isMirrorMode ? imageNode : null}
                </article>
              )
            })
          )}
        </div>
      ) : null}
    </section>
  )
}

export default LiveFeedPanel