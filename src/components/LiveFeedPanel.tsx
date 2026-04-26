import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { prepareFeedImage } from '../lib/feedImage'
import { readTextFromLocalStorage, saveTextToLocalStorage } from '../lib/saveHandling'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

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
const FEED_IMAGE_REVEAL_DELAY_MS = 7000
const FEED_POLL_INTERVAL_MS = 5000
const FEED_FETCH_DEBOUNCE_MS = 300
const FEED_MAX_POSTS = 40

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

function isFeedPostVisible(post: FeedPost, now: number, mode: LiveFeedPanelProps['mode']) {
  if (mode !== 'mirror') {
    return true
  }

  if (!post.image_data_url) {
    return true
  }

  return new Date(post.created_at).getTime() + FEED_IMAGE_REVEAL_DELAY_MS <= now
}

function LiveFeedPanel({
  mode,
  showComposer = true,
  title = 'Live Feed',
  showModerationControls = true,
}: LiveFeedPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isFetchingPostsRef = useRef(false)
  const hasQueuedReloadRef = useRef(false)
  const reloadTimerIdRef = useRef<number | null>(null)
  const { user, isHost } = useAuthStore()
  const { event } = useQueueStore()
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [message, setMessage] = useState('')
  const [authorName, setAuthorName] = useState(() => getStoredAuthorName())
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [selectedImageName, setSelectedImageName] = useState<string | null>(null)
  const [feedNow, setFeedNow] = useState(() => Date.now())
  const suggestedAuthorName = useMemo(
    () => getSuggestedAuthorName(user?.email, isHost),
    [isHost, user?.email],
  )
  const resolvedAuthorName = authorName.trim() || suggestedAuthorName
  const showJumpLink = mode === 'audience'
  const isMirrorMode = mode === 'mirror'
  const visiblePosts = useMemo(
    () => posts.filter((post) => isFeedPostVisible(post, feedNow, mode)),
    [feedNow, mode, posts],
  )

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
    // feedNow is only used to gate image reveal in mirror mode
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

      channel = supabase
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
          if (!isCurrent) {
            return
          }

          if (status === 'SUBSCRIBED') {
            channelReconnectAttempt = 0
            requestReload(true)
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setErrorText('Feed realtime is reconnecting. Showing latest posts...')
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

  const onImageSelected = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const file = changeEvent.target.files?.[0]

    if (!file) {
      return
    }

    setErrorText(null)

    try {
      const preparedImage = await prepareFeedImage(file)
      setImageDataUrl(preparedImage)
      setSelectedImageName(file.name)
    } catch (error) {
      setImageDataUrl(null)
      setSelectedImageName(null)
      setErrorText(error instanceof Error ? error.message : 'Unable to use that photo.')
    } finally {
      changeEvent.target.value = ''
    }
  }

  const clearSelectedImage = () => {
    setImageDataUrl(null)
    setSelectedImageName(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const onSubmit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    setErrorText(null)

    if (!user || !event?.id) {
      setErrorText('Join the audience before posting to the live feed.')
      return
    }

    const trimmedMessage = message.trim()

    if (!trimmedMessage && !imageDataUrl) {
      setErrorText('Write a message, add an image, or both.')
      return
    }

    setBusy(true)

    try {
      const normalizedAuthorName = normalizeAuthorName(resolvedAuthorName, suggestedAuthorName)

      const { data: insertedPost, error } = await supabase
        .from('feed_posts')
        .insert({
          event_id: event.id,
          user_id: user.id,
          author_name: normalizedAuthorName,
          message: trimmedMessage,
          image_data_url: imageDataUrl,
        })
        .select('id, event_id, user_id, author_name, message, image_data_url, created_at')
        .single()

      if (error) {
        throw error
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
      clearSelectedImage()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to post to the live feed.')
    } finally {
      setBusy(false)
    }
  }

  const deletePost = async (postId: string) => {
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
        <div>
          <p className="eyebrow live-feed-eyebrow">Community</p>
          <h2>{title}</h2>
        </div>
        {showJumpLink ? (
          <Link to="/feed" className="live-feed-link">
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
              <button
                key={emoji}
                type="button"
                className="live-feed-emoji-chip"
                onClick={() => setMessage((currentMessage) => `${currentMessage}${emoji}`)}
              >
                {emoji}
              </button>
            ))}
          </div>

          <div className="live-feed-media-row">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="live-feed-file-input"
              aria-label="Upload crowd feed photo"
              title="Upload crowd feed photo"
              onChange={onImageSelected}
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => fileInputRef.current?.click()}
            >
              Camera or Photo
            </button>
            {selectedImageName ? <span className="live-feed-image-name">{selectedImageName}</span> : null}
            {imageDataUrl ? (
              <button type="button" className="ghost-button" onClick={clearSelectedImage}>
                Remove Image
              </button>
            ) : null}
          </div>

          {imageDataUrl ? (
            <img src={imageDataUrl} alt="Selected feed upload preview" className="live-feed-image-preview" />
          ) : null}

          {errorText ? <p className="error-text no-margin">{errorText}</p> : null}

          <div className="live-feed-actions">
            <button type="submit" className="primary-button" disabled={busy || !event || !user}>
              {busy ? 'Posting...' : 'Post to Feed'}
            </button>
            <span className="live-feed-helper-text">{message.trim().length}/280</span>
          </div>
        </form>
      ) : null}

      {loading ? <p className="subcopy no-margin">Loading the live feed...</p> : null}

      {!loading ? (
        <div className="live-feed-list" role="list">
          {visiblePosts.length === 0 ? (
            <p className="subcopy no-margin">
              {isMirrorMode
                ? 'No community posts yet. Audience shout-outs and photos will appear here live.'
                : 'No feed posts yet. Start the conversation.'}
            </p>
          ) : (
            visiblePosts.map((post) => {
              const canDelete = showModerationControls && (user?.id === post.user_id || isHost)
              const hasImage = Boolean(post.image_data_url)

              return (
                <article key={post.id} className={`live-feed-post ${hasImage ? 'live-feed-post-polaroid' : ''}`} role="listitem">
                  <div className="live-feed-post-head">
                    <div>
                      <strong>{post.author_name}</strong>
                      <span>{formatPostTime(post.created_at)}</span>
                    </div>
                    {canDelete ? (
                      <button type="button" className="ghost-button live-feed-delete" onClick={() => { void deletePost(post.id) }}>
                        Remove
                      </button>
                    ) : null}
                  </div>

                  {post.message ? <p className="live-feed-post-message">{post.message}</p> : null}
                  {post.image_data_url ? (
                    <img src={post.image_data_url} alt={`Shared by ${post.author_name}`} className="live-feed-post-image" />
                  ) : null}
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