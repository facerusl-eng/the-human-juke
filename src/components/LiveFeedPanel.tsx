import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { prepareFeedImage } from '../lib/feedImage'
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
}

const QUICK_EMOJIS = ['🔥', '🎶', '👏', '😍', '😂', '🥳', '🤘', '❤️']
const AUTHOR_NAME_STORAGE_KEY = 'human-jukebox-feed-author-name'
const FEED_IMAGE_REVEAL_DELAY_MS = 7000
const FEED_POLL_INTERVAL_MS = 2000

function getStoredAuthorName() {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.localStorage.getItem(AUTHOR_NAME_STORAGE_KEY) ?? ''
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

function LiveFeedPanel({ mode, showComposer = true, title = 'Live Feed' }: LiveFeedPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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

    window.localStorage.setItem(AUTHOR_NAME_STORAGE_KEY, authorName.trim())
  }, [authorName])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFeedNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let isCurrent = true
    let pollTimerId: number | null = null

    const loadPosts = async () => {
      if (!event?.id) {
        if (isCurrent) {
          setPosts([])
          setLoading(false)
        }
        return
      }

      if (isCurrent) {
        setLoading(true)
      }

      const { data, error } = await supabase
        .from('feed_posts')
        .select('id, event_id, user_id, author_name, message, image_data_url, created_at')
        .eq('event_id', event.id)
        .order('created_at', { ascending: false })
        .limit(40)

      if (!isCurrent) {
        return
      }

      if (error) {
        setErrorText('Unable to load the live feed right now.')
        setPosts([])
        setLoading(false)
        return
      }

      setPosts((data ?? []) as FeedPost[])
      setLoading(false)
    }

    void loadPosts()

    if (!event?.id) {
      return () => {
        isCurrent = false
      }
    }

    const channel = supabase
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
          void loadPosts()
        },
      )
      .subscribe()

    pollTimerId = window.setInterval(() => {
      if (isCurrent) {
        void loadPosts()
      }
    }, FEED_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false
      if (pollTimerId !== null) {
        window.clearInterval(pollTimerId)
      }
      void supabase.removeChannel(channel)
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

    if (!message.trim() && !imageDataUrl) {
      setErrorText('Write a message, add an image, or both.')
      return
    }

    setBusy(true)

    try {
      const { data: insertedPost, error } = await supabase
        .from('feed_posts')
        .insert({
          event_id: event.id,
          user_id: user.id,
          author_name: resolvedAuthorName,
          message: message.trim(),
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

          return [insertedPost as FeedPost, ...currentPosts].slice(0, 40)
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

    const { error } = await supabase
      .from('feed_posts')
      .delete()
      .eq('id', postId)

    if (error) {
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
              const canDelete = user?.id === post.user_id || isHost
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