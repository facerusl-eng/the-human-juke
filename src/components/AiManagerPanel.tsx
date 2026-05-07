import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type PipelineContext = {
  analytics: {
    sentCount: number
    contacted: number
    replyStages: number
    confirmed: number
  }
  pendingTasks: Array<{
    venueName: string
    type: string
    dueAt: string
  }>
  venues: Array<{
    name: string
    type: string
    stage: string
    leadScore: number
    distanceKm: number
    contactEmail: string
    email: string
  }>
}

type Props = {
  pipeline: PipelineContext
}

const STARTERS = [
  'What should I focus on today?',
  'Which venues should I follow up with?',
  'Draft an email for my best lead',
  'How is my pipeline looking?',
]

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

export function AiManagerPanel({ pipeline }: Props) {
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'not-connected'>('checking')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    async function checkConnection() {
      setConnectionStatus('checking')
      try {
        const res = await fetch('/api/ai-manager', { method: 'GET' })
        const data: { connected?: boolean } = await res.json()
        if (!cancelled) {
          setConnectionStatus(res.ok && data.connected ? 'connected' : 'not-connected')
        }
      } catch {
        if (!cancelled) {
          setConnectionStatus('not-connected')
        }
      }
    }

    checkConnection()

    return () => {
      cancelled = true
    }
  }, [open])

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMsg: Message = { id: generateId(), role: 'user', content: trimmed }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/ai-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          pipeline,
        }),
      })

      const data: { reply?: string; error?: string } = await res.json()

      if (!res.ok || !data.reply) {
        setError(data.error ?? 'Something went wrong. Try again.')
      } else {
        setMessages(prev => [...prev, { id: generateId(), role: 'assistant', content: data.reply! }])
      }
    } catch {
      setError('Network error — check your connection.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="ai-manager-root" data-ai-manager-root="true">
      {open && (
        <div className="ai-manager-panel" role="dialog" aria-label="AI Booking Manager">
          <div className="ai-manager-header">
            <div className="ai-manager-header-info">
              <span className="ai-manager-avatar" aria-hidden="true">
                {!avatarBroken ? (
                  <img
                    src="/images/brian-epstein-avatar.png"
                    alt=""
                    className="ai-manager-avatar-image"
                    onError={() => setAvatarBroken(true)}
                  />
                ) : (
                  <span className="ai-manager-avatar-fallback">BE</span>
                )}
              </span>
              <div>
                <p className="ai-manager-name">Brian Epstein</p>
                <p className="ai-manager-title">AI Booking Manager</p>
              </div>
            </div>
            <span
              className={`ai-manager-status ai-manager-status-${connectionStatus}`}
              aria-live="polite"
            >
              {connectionStatus === 'connected' ? 'AI Connected' : connectionStatus === 'checking' ? 'Checking...' : 'AI Not Connected'}
            </span>
            <button
              type="button"
              className="ai-manager-close"
              onClick={() => setOpen(false)}
              aria-label="Close AI manager"
            >
              ×
            </button>
          </div>

          <div className="ai-manager-messages">
            {messages.length === 0 && (
              <div className="ai-manager-empty">
                <p className="ai-manager-empty-text">Hi, I'm Brian Epstein - your booking manager. Ask me anything about your pipeline, or pick a quick start:</p>
                <div className="ai-manager-starters">
                  {STARTERS.map(s => (
                    <button
                      key={s}
                      type="button"
                      className="ai-manager-starter"
                      onClick={() => sendMessage(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div
                key={msg.id}
                className={`ai-manager-bubble ai-manager-bubble-${msg.role}`}
              >
                <p className="ai-manager-bubble-text">{msg.content}</p>
              </div>
            ))}

            {loading && (
              <div className="ai-manager-bubble ai-manager-bubble-assistant ai-manager-bubble-loading">
                <span className="ai-manager-typing-dot" />
                <span className="ai-manager-typing-dot" />
                <span className="ai-manager-typing-dot" />
              </div>
            )}

            {error && (
              <div className="ai-manager-error">
                <p>{error}</p>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="ai-manager-input-row">
            <textarea
              ref={inputRef}
              className="ai-manager-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Brian Epstein anything..."
              rows={1}
              disabled={loading}
            />
            <button
              type="button"
              className="ai-manager-send"
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              aria-label="Send message"
            >
              ↑
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className={`ai-manager-fab ${open ? 'ai-manager-fab-open' : ''}`}
        onClick={() => setOpen(prev => !prev)}
        aria-label={open ? 'Close AI manager' : 'Open AI booking manager'}
      >
        <span className="ai-manager-fab-icon" aria-hidden="true">
          {!avatarBroken ? (
            <img
              src="/images/brian-epstein-avatar.png"
              alt=""
              className="ai-manager-fab-image"
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <span className="ai-manager-avatar-fallback">BE</span>
          )}
        </span>
        {!open && <span className="ai-manager-fab-label">Brian Epstein</span>}
      </button>
    </div>,
    document.body,
  )
}
