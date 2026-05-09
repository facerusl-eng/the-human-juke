import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type CalendarAction = {
  id: string
  action: 'upsert' | 'delete'
  date: string
  status?: 'free' | 'booked'
  venueName?: string
  city?: string
  contact?: string
  fee?: string
  paymentStatus?: 'unpaid' | 'partial' | 'paid'
  paymentAmount?: string
  paidAt?: string
  notes?: string
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
  calendar?: {
    free: Array<{
      date: string
      notes: string
    }>
    booked: Array<{
      date: string
      venueName: string
      city: string
      contact: string
      fee: string
      paymentStatus: string
      paymentAmount: string
      paidAt: string
      notes: string
      source: string
    }>
  }
}

const EMPTY_PIPELINE: PipelineContext = {
  analytics: { sentCount: 0, contacted: 0, replyStages: 0, confirmed: 0 },
  pendingTasks: [],
  venues: [],
}

type Props = {
  pipeline?: PipelineContext
}

type ManagerOption = {
  id: 'brian' | 'parker' | 'grant'
  name: string
  subtitle: string
}

const STARTERS = [
  'What should I focus on today?',
  'Which venues should I follow up with?',
  'Draft an email for my best lead',
  'How is my pipeline looking?',
]

const MANAGER_OPTIONS: ManagerOption[] = [
  { id: 'brian', name: 'Brian Epstein', subtitle: 'The Beatles' },
  { id: 'parker', name: 'Colonel Tom Parker', subtitle: 'Elvis Presley' },
  { id: 'grant', name: 'Peter Grant', subtitle: 'Led Zeppelin' },
]

const MANAGER_STORAGE_KEY = 'human-jukebox-ai-manager-profile'
const AI_MANAGER_OPEN_EVENT = 'human-jukebox-ai-manager-open'
const OUTREACH_LOG_STORAGE_KEY = 'human-jukebox-outreach-log'
const OUTREACH_STAGE_STORAGE_KEY = 'human-jukebox-outreach-stage-map'
const OUTREACH_TASKS_STORAGE_KEY = 'human-jukebox-outreach-tasks'
const OUTREACH_SESSION_STORAGE_KEY = 'human-jukebox-outreach-session'
const OUTREACH_CALENDAR_STORAGE_KEY = 'human-jukebox-outreach-calendar'
const CALENDAR_UPDATED_EVENT = 'human-jukebox-calendar-updated'

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

function safeParse(value: string | null) {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function moveDateToUpcomingYear(dateIso: string) {
  if (!isIsoDate(dateIso)) {
    return dateIso
  }

  const [yearPart, monthPart, dayPart] = dateIso.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return dateIso
  }

  const today = new Date()
  const currentYear = today.getFullYear()
  const todayIso = `${currentYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const thisYearCandidate = `${currentYear}-${monthPart}-${dayPart}`
  if (thisYearCandidate >= todayIso) {
    return thisYearCandidate
  }

  return `${currentYear + 1}-${monthPart}-${dayPart}`
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCalendarActions(value: unknown): CalendarAction[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const action = entry.action === 'delete' ? 'delete' : 'upsert'
      const date = normalizeText(entry.date)

      if (!isIsoDate(date)) {
        return null
      }

      return {
        id: generateId(),
        action,
        date,
        status: entry.status === 'booked' ? 'booked' : 'free',
        venueName: normalizeText(entry.venueName),
        city: normalizeText(entry.city),
        contact: normalizeText(entry.contact),
        fee: normalizeText(entry.fee),
        paymentStatus: entry.paymentStatus === 'paid' || entry.paymentStatus === 'partial' ? entry.paymentStatus : 'unpaid',
        paymentAmount: normalizeText(entry.paymentAmount),
        paidAt: normalizeText(entry.paidAt),
        notes: normalizeText(entry.notes),
      } as CalendarAction
    })
    .filter((entry): entry is CalendarAction => Boolean(entry))
}

function buildPipelineFromOutreachStorage(): PipelineContext {
  if (typeof window === 'undefined') {
    return EMPTY_PIPELINE
  }

  const logEntries = Array.isArray(safeParse(window.localStorage.getItem(OUTREACH_LOG_STORAGE_KEY)))
    ? safeParse(window.localStorage.getItem(OUTREACH_LOG_STORAGE_KEY)) as Array<Record<string, unknown>>
    : []
  const stageMap = safeParse(window.localStorage.getItem(OUTREACH_STAGE_STORAGE_KEY)) as Record<string, string> | null
  const followUpTasks = Array.isArray(safeParse(window.localStorage.getItem(OUTREACH_TASKS_STORAGE_KEY)))
    ? safeParse(window.localStorage.getItem(OUTREACH_TASKS_STORAGE_KEY)) as Array<Record<string, unknown>>
    : []
  const session = safeParse(window.localStorage.getItem(OUTREACH_SESSION_STORAGE_KEY)) as Record<string, unknown> | null
  const calendarRaw = Array.isArray(safeParse(window.localStorage.getItem(OUTREACH_CALENDAR_STORAGE_KEY)))
    ? safeParse(window.localStorage.getItem(OUTREACH_CALENDAR_STORAGE_KEY)) as Array<Record<string, unknown>>
    : []

  const sentCount = logEntries.filter((entry) => entry?.status === 'sent').length
  const pipelineStages = Object.values(stageMap ?? {})
  const contacted = pipelineStages.filter((stage) => ['contacted', 'replied', 'negotiating', 'confirmed', 'lost'].includes(stage)).length
  const replyStages = pipelineStages.filter((stage) => ['replied', 'negotiating', 'confirmed'].includes(stage)).length
  const confirmed = pipelineStages.filter((stage) => stage === 'confirmed').length

  const pendingTasks = followUpTasks
    .filter((task) => task && task.completed !== true)
    .map((task) => ({
      venueName: typeof task.venueName === 'string' ? task.venueName : 'Unknown venue',
      type: typeof task.type === 'string' ? task.type : 'follow-up',
      dueAt: typeof task.dueAt === 'string' ? task.dueAt : '',
    }))

  const venues = Array.isArray(session?.venues)
    ? (session?.venues as Array<Record<string, unknown>>).slice(0, 30).map((venue) => ({
      name: typeof venue.name === 'string' ? venue.name : 'Unknown venue',
      type: typeof venue.type === 'string' ? venue.type : 'Unknown',
      stage: typeof venue.stage === 'string' ? venue.stage : 'new',
      leadScore: Number(venue.leadScore ?? 0),
      distanceKm: Number(venue.distanceKm ?? 0),
      contactEmail: typeof venue.contactEmail === 'string' ? venue.contactEmail : '',
      email: typeof venue.email === 'string' ? venue.email : '',
    }))
    : []

  const calendarEntries = calendarRaw
    .map((entry) => ({
      date: typeof entry.date === 'string' ? entry.date : '',
      status: entry.status === 'booked' ? 'booked' : 'free',
      venueName: typeof entry.venueName === 'string' ? entry.venueName : '',
      city: typeof entry.city === 'string' ? entry.city : '',
      contact: typeof entry.contact === 'string' ? entry.contact : '',
      fee: typeof entry.fee === 'string' ? entry.fee : '',
      paymentStatus: typeof entry.paymentStatus === 'string' ? entry.paymentStatus : 'unpaid',
      paymentAmount: typeof entry.paymentAmount === 'string' ? entry.paymentAmount : '',
      paidAt: typeof entry.paidAt === 'string' ? entry.paidAt : '',
      notes: typeof entry.notes === 'string' ? entry.notes : '',
      source: typeof entry.source === 'string' ? entry.source : 'manual',
    }))
    .filter((entry) => isIsoDate(entry.date))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    analytics: {
      sentCount,
      contacted,
      replyStages,
      confirmed,
    },
    pendingTasks,
    venues,
    calendar: {
      free: calendarEntries
        .filter((entry) => entry.status === 'free')
        .slice(0, 20)
        .map((entry) => ({ date: entry.date, notes: entry.notes })),
      booked: calendarEntries
        .filter((entry) => entry.status === 'booked')
        .slice(0, 20)
        .map((entry) => ({
          date: entry.date,
          venueName: entry.venueName,
          city: entry.city,
          contact: entry.contact,
          fee: entry.fee,
          paymentStatus: entry.paymentStatus,
          paymentAmount: entry.paymentAmount,
          paidAt: entry.paidAt,
          notes: entry.notes,
          source: entry.source,
        })),
    },
  }
}

export function AiManagerPanel({ pipeline = EMPTY_PIPELINE }: Props) {
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingCalendarActions, setPendingCalendarActions] = useState<CalendarAction[]>([])
  const [selectedCalendarActionIds, setSelectedCalendarActionIds] = useState<string[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'not-connected'>('checking')
  const [managerId, setManagerId] = useState<ManagerOption['id']>(() => {
    if (typeof window === 'undefined') {
      return 'brian'
    }

    const stored = window.localStorage.getItem(MANAGER_STORAGE_KEY)
    return stored === 'parker' || stored === 'grant' ? stored : 'brian'
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const selectedManager = MANAGER_OPTIONS.find(option => option.id === managerId) ?? MANAGER_OPTIONS[0]
  const avatarSrc =
    managerId === 'brian' ? '/images/brian-epstein-avatar.png' :
    managerId === 'parker' ? '/images/Colonel%20Tom%20Parker%20(Elvis%20Presley).png' :
    managerId === 'grant' ? '/images/Peter%20Grant%20(Led%20Zeppelin).png' : ''
  const avatarFallback = managerId === 'parker' ? 'TP' : managerId === 'grant' ? 'PG' : 'BE'

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(MANAGER_STORAGE_KEY, managerId)
    setAvatarBroken(false)
  }, [managerId])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const onExternalOpen = () => setOpen(true)
    window.addEventListener(AI_MANAGER_OPEN_EVENT, onExternalOpen)

    return () => {
      window.removeEventListener(AI_MANAGER_OPEN_EVENT, onExternalOpen)
    }
  }, [])

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
      const livePipeline = buildPipelineFromOutreachStorage()
      const mergedPipeline: PipelineContext = {
        analytics: {
          sentCount: pipeline.analytics?.sentCount ?? livePipeline.analytics.sentCount,
          contacted: pipeline.analytics?.contacted ?? livePipeline.analytics.contacted,
          replyStages: pipeline.analytics?.replyStages ?? livePipeline.analytics.replyStages,
          confirmed: pipeline.analytics?.confirmed ?? livePipeline.analytics.confirmed,
        },
        pendingTasks: pipeline.pendingTasks?.length ? pipeline.pendingTasks : livePipeline.pendingTasks,
        venues: pipeline.venues?.length ? pipeline.venues : livePipeline.venues,
        calendar: pipeline.calendar ?? livePipeline.calendar,
      }

      const res = await fetch('/api/ai-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          pipeline: mergedPipeline,
          managerId,
        }),
      })

      const data: { reply?: string; error?: string; calendarActions?: unknown } = await res.json()

      if (!res.ok || !data.reply) {
        setError(data.error ?? 'Something went wrong. Try again.')
      } else {
        const actions = normalizeCalendarActions(data.calendarActions)
        setPendingCalendarActions(actions)
        setSelectedCalendarActionIds(actions.map((action) => action.id))
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

  const selectedCalendarActions = pendingCalendarActions.filter((action) => selectedCalendarActionIds.includes(action.id))

  function applyCalendarActions() {
    if (typeof window === 'undefined' || selectedCalendarActions.length === 0) {
      return
    }

    const existingRaw = safeParse(window.localStorage.getItem(OUTREACH_CALENDAR_STORAGE_KEY))
    const existing = Array.isArray(existingRaw) ? existingRaw as Array<Record<string, unknown>> : []
    const byDate = new Map<string, Record<string, unknown>>()

    existing.forEach((entry) => {
      const date = normalizeText(entry.date)
      if (isIsoDate(date)) {
        byDate.set(date, entry)
      }
    })

    const nowIso = new Date().toISOString()

    selectedCalendarActions.forEach((action) => {
      if (action.action === 'delete') {
        byDate.delete(action.date)
        return
      }

      const normalizedDate = action.status === 'booked'
        ? moveDateToUpcomingYear(action.date)
        : action.date

      const current = byDate.get(normalizedDate)
      byDate.set(normalizedDate, {
        id: typeof current?.id === 'string' ? current.id : `calendar-${normalizedDate}`,
        date: normalizedDate,
        status: action.status === 'booked' ? 'booked' : 'free',
        venueName: action.venueName ?? '',
        city: action.city ?? '',
        contact: action.contact ?? '',
        fee: action.fee ?? '',
        source: 'ai-manager',
        paymentAmount: action.paymentAmount || (typeof current?.paymentAmount === 'string' ? current.paymentAmount : ''),
        paidAt: action.paidAt || (typeof current?.paidAt === 'string' ? current.paidAt : ''),
        paymentStatus: action.paymentStatus || (typeof current?.paymentStatus === 'string' ? current.paymentStatus : 'unpaid'),
        notes: normalizedDate !== action.date
          ? `${action.notes ? `${action.notes} ` : ''}(AI date adjusted to upcoming year)`
          : (action.notes ?? ''),
        createdAt: typeof current?.createdAt === 'string' ? current.createdAt : nowIso,
        updatedAt: nowIso,
      })
    })

    const nextEntries = [...byDate.values()].sort((a, b) => normalizeText(a.date).localeCompare(normalizeText(b.date)))
    window.localStorage.setItem(OUTREACH_CALENDAR_STORAGE_KEY, JSON.stringify(nextEntries))
    window.dispatchEvent(new CustomEvent(CALENDAR_UPDATED_EVENT))
    const appliedIds = new Set(selectedCalendarActions.map((action) => action.id))
    const remaining = pendingCalendarActions.filter((action) => !appliedIds.has(action.id))
    setPendingCalendarActions(remaining)
    setSelectedCalendarActionIds(remaining.map((action) => action.id))
    setMessages(prev => [...prev, { id: generateId(), role: 'assistant', content: `Applied ${selectedCalendarActions.length} calendar update(s).` }])
  }

  function dismissSelectedCalendarActions() {
    if (selectedCalendarActions.length === 0) {
      return
    }

    const selectedIds = new Set(selectedCalendarActions.map((action) => action.id))
    const remaining = pendingCalendarActions.filter((action) => !selectedIds.has(action.id))
    setPendingCalendarActions(remaining)
    setSelectedCalendarActionIds(remaining.map((action) => action.id))
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="ai-manager-root" data-ai-manager-root="true" data-open={open ? 'true' : 'false'}>
      {open && (
        <div className="ai-manager-panel" role="dialog" aria-label="AI Booking Manager">
          <div className="ai-manager-header">
            <div className="ai-manager-header-info">
              <span className="ai-manager-avatar" aria-hidden="true">
                {!avatarBroken && avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt=""
                    className="ai-manager-avatar-image"
                    onError={() => setAvatarBroken(true)}
                  />
                ) : (
                  <span className="ai-manager-avatar-fallback">{avatarFallback}</span>
                )}
              </span>
              <div>
                <p className="ai-manager-name">{selectedManager.name}</p>
                <p className="ai-manager-title">AI Manager • {selectedManager.subtitle}</p>
              </div>
            </div>
            <label className="ai-manager-profile-picker">
              <span className="ai-manager-profile-picker-label">Manager</span>
              <select
                value={managerId}
                onChange={(event) => setManagerId(event.target.value as ManagerOption['id'])}
                className="ai-manager-profile-select"
                aria-label="Select AI manager profile"
              >
                {MANAGER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.subtitle})
                  </option>
                ))}
              </select>
            </label>
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
                <p className="ai-manager-empty-text">Hi, I'm {selectedManager.name} - your booking manager. Ask me anything about your pipeline, or pick a quick start:</p>
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

            {pendingCalendarActions.length > 0 && (
              <div className="ai-manager-calendar-actions">
                <p className="ai-manager-empty-text">I prepared {pendingCalendarActions.length} calendar update(s). Review and approve each one.</p>
                <ul className="ai-manager-calendar-action-list">
                  {pendingCalendarActions.map((action) => (
                    <li key={action.id} className="ai-manager-calendar-action-item">
                      <label className="queue-toggle queue-toggle-compact">
                        <input
                          type="checkbox"
                          checked={selectedCalendarActionIds.includes(action.id)}
                          onChange={(event) => {
                            setSelectedCalendarActionIds((current) => {
                              if (event.target.checked) {
                                return current.includes(action.id) ? current : [...current, action.id]
                              }

                              return current.filter((id) => id !== action.id)
                            })
                          }}
                        />
                        <span>
                          {action.action === 'delete'
                            ? `Delete ${action.date}`
                            : `${action.status === 'booked' ? 'Book' : 'Free'} ${action.date}${action.venueName ? ` · ${action.venueName}` : ''}`}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="ai-manager-starters">
                  <button type="button" className="ai-manager-starter" onClick={applyCalendarActions} disabled={selectedCalendarActions.length === 0}>Apply selected</button>
                  <button type="button" className="ai-manager-starter" onClick={dismissSelectedCalendarActions} disabled={selectedCalendarActions.length === 0}>Dismiss selected</button>
                  <button
                    type="button"
                    className="ai-manager-starter"
                    onClick={() => {
                      setPendingCalendarActions([])
                      setSelectedCalendarActionIds([])
                    }}
                  >
                    Clear all
                  </button>
                </div>
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
              placeholder={`Ask ${selectedManager.name} anything...`}
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
          {!avatarBroken && avatarSrc ? (
            <img
              src={avatarSrc}
              alt=""
              className="ai-manager-fab-image"
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <span className="ai-manager-avatar-fallback">{avatarFallback}</span>
          )}
        </span>
      </button>
    </div>,
    document.body,
  )
}
