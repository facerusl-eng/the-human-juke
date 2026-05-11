import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQueueStore } from '../state/queueStore'

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

type AppAction = {
  id: string
  action: 'navigate' | 'open_health_check' | 'reload_app' | 'set_room_open' | 'set_no_live_visibility' | 'mark_played' | 'skip_current_song' | 'choose_gig' | 'end_current_gig' | 'commit_and_push'
  route?: '/admin' | '/admin/gigs' | '/admin/gig-control' | '/admin/health-check' | '/admin/create-gig' | '/audience'
  open?: boolean
  visible?: boolean
  gigName?: string
  commitMessage?: string
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
  id: 'copilot'
  name: string
  subtitle: string
}

const STARTERS = [
  'Is the app healthy right now?',
  'What needs fixing?',
  'Fix build-up errors now',
  'Open health-check and suggest fixes',
  'Commit and push latest changes',
]

const MANAGER_OPTIONS: ManagerOption[] = [
  { id: 'copilot', name: 'JukeOps Copilot', subtitle: 'Embedded AI Chief Engineer' },
]

const MANAGER_STORAGE_KEY = 'human-jukebox-ai-manager-profile'
const AI_MANAGER_OPEN_EVENT = 'human-jukebox-ai-manager-open'
const OUTREACH_LOG_STORAGE_KEY = 'human-jukebox-outreach-log'
const OUTREACH_STAGE_STORAGE_KEY = 'human-jukebox-outreach-stage-map'
const OUTREACH_TASKS_STORAGE_KEY = 'human-jukebox-outreach-tasks'
const OUTREACH_SESSION_STORAGE_KEY = 'human-jukebox-outreach-session'
const OUTREACH_CALENDAR_STORAGE_KEY = 'human-jukebox-outreach-calendar'
const CALENDAR_UPDATED_EVENT = 'human-jukebox-calendar-updated'
const AI_MANAGER_ASSIST_MODE_STORAGE_KEY = 'human-jukebox-ai-manager-assist-mode'
const AI_MANAGER_AUTO_RUN_SAFE_ACTIONS_STORAGE_KEY = 'human-jukebox-ai-manager-auto-run-safe-actions'
const AI_MANAGER_FAB_POSITION_STORAGE_KEY = 'human-jukebox-ai-manager-fab-position'

function isSafeAppAction(action: AppAction) {
  return action.action === 'navigate'
    || action.action === 'open_health_check'
    || action.action === 'set_room_open'
    || action.action === 'set_no_live_visibility'
    || action.action === 'choose_gig'
}

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

function normalizeAppActions(value: unknown): AppAction[] {
  if (!Array.isArray(value)) {
    return []
  }

  const allowedRoutes = new Set(['/admin', '/admin/gigs', '/admin/gig-control', '/admin/health-check', '/admin/create-gig', '/audience'])
  const normalized: AppAction[] = []

  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return
    }

    const action = normalizeText(entry.action) as AppAction['action']

    if (![
      'navigate',
      'open_health_check',
      'reload_app',
      'set_room_open',
      'set_no_live_visibility',
      'mark_played',
      'skip_current_song',
      'choose_gig',
      'end_current_gig',
      'commit_and_push',
    ].includes(action)) {
      return
    }

    const route = normalizeText(entry.route)

    normalized.push({
      id: generateId(),
      action,
      route: allowedRoutes.has(route) ? route as AppAction['route'] : undefined,
      open: Boolean(entry.open),
      visible: Boolean(entry.visible),
      gigName: normalizeText(entry.gigName),
      commitMessage: normalizeText(entry.commitMessage),
    })
  })

  return normalized
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
  const navigate = useNavigate()
  const {
    event,
    hostEvents,
    songs,
    audienceConnectionStatus,
    queueOperatingMode,
    queueHealthMessage,
    pendingOfflineSongs,
    setActiveEvent,
    toggleRoomOpen,
    setShowInAudienceNoGig,
    markPlayed,
    removeSong,
    endGig,
  } = useQueueStore()
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDesktopFabDragEnabled, setIsDesktopFabDragEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.innerWidth > 600
  })
  const [fabDragging, setFabDragging] = useState(false)
  const [fabPosition, setFabPosition] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === 'undefined') {
      return null
    }

    const parsed = safeParse(window.localStorage.getItem(AI_MANAGER_FAB_POSITION_STORAGE_KEY)) as { x?: unknown; y?: unknown } | null
    const x = typeof parsed?.x === 'number' ? parsed.x : Number.NaN
    const y = typeof parsed?.y === 'number' ? parsed.y : Number.NaN

    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  })
  const [assistModeEnabled, setAssistModeEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem(AI_MANAGER_ASSIST_MODE_STORAGE_KEY) === '1'
  })
  const [autoRunSafeActions, setAutoRunSafeActions] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem(AI_MANAGER_AUTO_RUN_SAFE_ACTIONS_STORAGE_KEY) === '1'
  })
  const [appActionBusy, setAppActionBusy] = useState(false)
  const [pendingCalendarActions, setPendingCalendarActions] = useState<CalendarAction[]>([])
  const [selectedCalendarActionIds, setSelectedCalendarActionIds] = useState<string[]>([])
  const [pendingAppActions, setPendingAppActions] = useState<AppAction[]>([])
  const [selectedAppActionIds, setSelectedAppActionIds] = useState<string[]>([])
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'not-connected'>('checking')
  const [managerId] = useState<ManagerOption['id']>('copilot')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const suppressFabToggleRef = useRef(false)
  const fabDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    width: number
    height: number
    moved: boolean
  } | null>(null)
  const selectedManager = MANAGER_OPTIONS.find(option => option.id === managerId) ?? MANAGER_OPTIONS[0]
  const avatarSrc = ''
  const avatarFallback = 'JX'

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

    window.localStorage.setItem(AI_MANAGER_ASSIST_MODE_STORAGE_KEY, assistModeEnabled ? '1' : '0')
  }, [assistModeEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(AI_MANAGER_AUTO_RUN_SAFE_ACTIONS_STORAGE_KEY, autoRunSafeActions ? '1' : '0')
  }, [autoRunSafeActions])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!fabPosition) {
      window.localStorage.removeItem(AI_MANAGER_FAB_POSITION_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(AI_MANAGER_FAB_POSITION_STORAGE_KEY, JSON.stringify(fabPosition))
  }, [fabPosition])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const onResize = () => {
      const desktopEnabled = window.innerWidth > 600
      setIsDesktopFabDragEnabled(desktopEnabled)

      if (!desktopEnabled) {
        return
      }

      if (!fabPosition) {
        return
      }

      const width = fabRef.current?.offsetWidth ?? 52
      const height = fabRef.current?.offsetHeight ?? 52
      const minX = 8
      const minY = 8
      const maxX = Math.max(minX, window.innerWidth - width - 8)
      const maxY = Math.max(minY, window.innerHeight - height - 8)

      const clampedX = Math.min(Math.max(fabPosition.x, minX), maxX)
      const clampedY = Math.min(Math.max(fabPosition.y, minY), maxY)

      if (clampedX !== fabPosition.x || clampedY !== fabPosition.y) {
        setFabPosition({ x: clampedX, y: clampedY })
      }
    }

    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [fabPosition])

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    if (!isDesktopFabDragEnabled || !fabPosition) {
      root.style.left = ''
      root.style.top = ''
      root.style.right = ''
      root.style.bottom = ''
      root.style.insetInlineStart = ''
      root.style.insetBlockStart = ''
      root.style.insetInlineEnd = ''
      root.style.insetBlockEnd = ''
      return
    }

    root.style.left = `${fabPosition.x}px`
    root.style.top = `${fabPosition.y}px`
    root.style.right = 'auto'
    root.style.bottom = 'auto'
    root.style.insetInlineStart = `${fabPosition.x}px`
    root.style.insetBlockStart = `${fabPosition.y}px`
    root.style.insetInlineEnd = 'auto'
    root.style.insetBlockEnd = 'auto'
  }, [fabPosition, isDesktopFabDragEnabled])

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
          app: {
            currentGigName: event?.name ?? null,
            roomOpen: event?.roomOpen ?? null,
            showInAudienceNoGig: event?.showInAudienceNoGig ?? null,
            queueLength: songs.length,
            currentSongTitle: songs[0]?.title ?? null,
            queueOperatingMode,
            queueHealthMessage,
            audienceConnectionStatus,
            pendingOfflineSongs: pendingOfflineSongs.length,
            hostGigs: hostEvents.slice(0, 50).map((hostEvent) => ({
              name: hostEvent.name,
              isActive: hostEvent.isActive,
              showInAudienceNoGig: hostEvent.showInAudienceNoGig,
            })),
          },
          managerId,
          assistMode: assistModeEnabled,
        }),
      })

      const data: { reply?: string; error?: string; calendarActions?: unknown; appActions?: unknown } = await res.json()

      if (!res.ok || !data.reply) {
        setError(data.error ?? 'Something went wrong. Try again.')
      } else {
        const actions = normalizeCalendarActions(data.calendarActions)
        const appActions = normalizeAppActions(data.appActions)
        setPendingCalendarActions(actions)
        setSelectedCalendarActionIds(actions.map((action) => action.id))
        setPendingAppActions(appActions)
        setSelectedAppActionIds(appActions.map((action) => action.id))
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

  const runDailySelfCheck = () => {
    if (loading || appActionBusy) {
      return
    }

    void sendMessage('Run a daily self-check now. Verify app health, queue operating mode, connection status, pending offline songs, and live-control readiness. Give me a short green/yellow/red status plus top 3 actions. Open health-check if needed.')
  }

  const runPanicRecovery = async () => {
    if (loading || appActionBusy) {
      return
    }

    await applyAppActions([{ id: generateId(), action: 'open_health_check' }], 'auto')
    void sendMessage('Panic recovery mode: diagnose current app state, prioritise stability, and propose the smallest safe recovery sequence to restore normal operation. Include app actions where appropriate.')
  }

  const selectedCalendarActions = pendingCalendarActions.filter((action) => selectedCalendarActionIds.includes(action.id))
  const selectedAppActions = pendingAppActions.filter((action) => selectedAppActionIds.includes(action.id))

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

  async function applyAppActions(actionsToApply = selectedAppActions, sourceLabel: 'manual' | 'auto' = 'manual') {
    if (actionsToApply.length === 0 || appActionBusy) {
      return
    }

    setAppActionBusy(true)
    const appliedIds = new Set<string>()
    const failures: string[] = []

    for (const action of actionsToApply) {
      try {
        if (action.action === 'navigate') {
          if (!action.route) {
            throw new Error('Missing route for navigate action.')
          }

          navigate(action.route)
          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'open_health_check') {
          navigate('/admin/health-check')
          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'reload_app') {
          if (typeof window !== 'undefined') {
            window.location.reload()
          }

          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'set_room_open') {
          if (!event) {
            throw new Error('No active gig selected.')
          }

          if (event.roomOpen !== Boolean(action.open)) {
            await toggleRoomOpen()
          }

          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'set_no_live_visibility') {
          if (!event) {
            throw new Error('No active gig selected.')
          }

          const nextVisible = Boolean(action.visible)
          if (event.showInAudienceNoGig !== nextVisible) {
            await setShowInAudienceNoGig(nextVisible)
          }

          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'mark_played') {
          if (songs.length === 0) {
            throw new Error('No queued song to mark as played.')
          }

          await markPlayed()
          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'skip_current_song') {
          const currentSong = songs[0]
          if (!currentSong) {
            throw new Error('No queued song to skip.')
          }

          await removeSong(currentSong.id)
          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'choose_gig') {
          const requestedName = (action.gigName || '').trim().toLowerCase()
          const target = requestedName
            ? hostEvents.find((hostEvent) => hostEvent.name.trim().toLowerCase() === requestedName)
              ?? hostEvents.find((hostEvent) => hostEvent.name.trim().toLowerCase().includes(requestedName))
            : null

          if (!target) {
            throw new Error(action.gigName ? `Could not find gig "${action.gigName}".` : 'No gig name provided.')
          }

          await setActiveEvent(target.id)
          navigate('/admin/gig-control')
          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'end_current_gig') {
          if (!event) {
            throw new Error('No active gig selected.')
          }

          await endGig(event.id)
          appliedIds.add(action.id)
          continue
        }

        if (action.action === 'commit_and_push') {
          const message = (action.commitMessage || 'Auto-commit: app improvements').trim()

          const res = await fetch('/api/git-operations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'stage-commit-push', message }),
          })

          const data: { ok?: boolean; error?: string; message?: string; files?: string[] } = await res.json()

          if (!res.ok || !data.ok) {
            throw new Error(data.error ?? 'Git commit/push failed.')
          }

          appliedIds.add(action.id)
          continue
        }
      } catch (actionError) {
        failures.push(actionError instanceof Error ? actionError.message : 'Action failed.')
      }
    }

    const remaining = pendingAppActions.filter((action) => !appliedIds.has(action.id))
    setPendingAppActions(remaining)
    setSelectedAppActionIds(remaining.map((action) => action.id))

    if (appliedIds.size > 0) {
      setMessages((prev) => [...prev, {
        id: generateId(),
        role: 'assistant',
        content: failures.length
          ? `${sourceLabel === 'auto' ? 'Auto-applied' : 'Applied'} ${appliedIds.size} app action(s). Some failed: ${failures.join(' | ')}`
          : `${sourceLabel === 'auto' ? 'Auto-applied' : 'Applied'} ${appliedIds.size} app action(s).`,
      }])
    } else if (failures.length > 0) {
      setError(failures.join(' | '))
    }

    setAppActionBusy(false)
  }

  function dismissSelectedAppActions() {
    if (selectedAppActions.length === 0) {
      return
    }

    const selectedIds = new Set(selectedAppActions.map((action) => action.id))
    const remaining = pendingAppActions.filter((action) => !selectedIds.has(action.id))
    setPendingAppActions(remaining)
    setSelectedAppActionIds(remaining.map((action) => action.id))
  }

  useEffect(() => {
    if (!assistModeEnabled || !autoRunSafeActions || appActionBusy || loading || pendingAppActions.length === 0) {
      return
    }

    const safeActions = pendingAppActions.filter((action) => isSafeAppAction(action))

    if (safeActions.length === 0) {
      return
    }

    void applyAppActions(safeActions, 'auto')
  }, [assistModeEnabled, autoRunSafeActions, appActionBusy, loading, pendingAppActions])

  if (typeof document === 'undefined') {
    return null
  }

  const handleFabPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDesktopFabDragEnabled || open || event.button !== 0) {
      return
    }

    const target = fabRef.current
    const rect = target?.getBoundingClientRect()

    if (!target || !rect) {
      return
    }

    fabDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    }

    target.setPointerCapture(event.pointerId)
    setFabDragging(true)
  }

  const handleFabPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = fabDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY

    if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      drag.moved = true
    }

    if (!drag.moved) {
      return
    }

    const minX = 8
    const minY = 8
    const maxX = Math.max(minX, window.innerWidth - drag.width - 8)
    const maxY = Math.max(minY, window.innerHeight - drag.height - 8)

    const nextX = Math.min(Math.max(drag.originX + dx, minX), maxX)
    const nextY = Math.min(Math.max(drag.originY + dy, minY), maxY)
    setFabPosition({ x: nextX, y: nextY })
  }

  const handleFabPointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = fabDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    if (drag.moved) {
      suppressFabToggleRef.current = true
    }

    if (fabRef.current?.hasPointerCapture(event.pointerId)) {
      fabRef.current.releasePointerCapture(event.pointerId)
    }

    fabDragRef.current = null
    setFabDragging(false)
  }

  return createPortal(
    <div ref={rootRef} className="ai-manager-root" data-ai-manager-root="true" data-open={open ? 'true' : 'false'}>
      {open && (
        <div className="ai-manager-panel" role="dialog" aria-label="JukeOps Copilot">
          <div className="ai-manager-header">
            <div className="ai-manager-header-info">
              <span className="ai-manager-avatar ai-manager-avatar-copilot" aria-hidden="true">
                {!avatarBroken && avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt=""
                    className="ai-manager-avatar-image"
                    onError={() => setAvatarBroken(true)}
                  />
                ) : (
                  <span className="ai-manager-avatar-fallback ai-manager-avatar-fallback-copilot">{avatarFallback}</span>
                )}
              </span>
              <div>
                <p className="ai-manager-name">{selectedManager.name}</p>
                <p className="ai-manager-title">AI Copilot • {selectedManager.subtitle}</p>
              </div>
            </div>
            <span className="ai-manager-profile-badge">Copilot Embedded</span>
            <label className="queue-toggle queue-toggle-compact" title="Allow AI Manager to prepare app control actions.">
              <input
                type="checkbox"
                checked={assistModeEnabled}
                onChange={(event) => setAssistModeEnabled(event.target.checked)}
              />
              <span>Assist Mode</span>
            </label>
            <label className="queue-toggle queue-toggle-compact" title="Auto-run non-destructive AI actions. Risky actions still require manual approval.">
              <input
                type="checkbox"
                checked={autoRunSafeActions}
                disabled={!assistModeEnabled}
                onChange={(event) => setAutoRunSafeActions(event.target.checked)}
              />
              <span>Auto-Run Safe</span>
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
              aria-label="Close JukeOps Copilot"
            >
              ×
            </button>
          </div>

          <div className="ai-manager-messages">
            {messages.length === 0 && (
              <div className="ai-manager-empty">
                <p className="ai-manager-empty-text">Hi, I'm {selectedManager.name}. I help keep the app healthy, diagnose issues, and support live control. What do you need?</p>
                <div className="ai-manager-starters">
                  <button
                    type="button"
                    className="ai-manager-starter"
                    onClick={runDailySelfCheck}
                    disabled={loading || appActionBusy}
                  >
                    Daily Self-Check
                  </button>
                  <button
                    type="button"
                    className="ai-manager-starter"
                    onClick={() => {
                      void runPanicRecovery()
                    }}
                    disabled={loading || appActionBusy}
                  >
                    Panic Recovery
                  </button>
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

            {pendingAppActions.length > 0 && (
              <div className="ai-manager-calendar-actions">
                <p className="ai-manager-empty-text">I prepared {pendingAppActions.length} app assist action(s). Safe actions can auto-run if enabled; risky actions require approval.</p>
                <ul className="ai-manager-calendar-action-list">
                  {pendingAppActions.map((action) => (
                    <li key={action.id} className="ai-manager-calendar-action-item">
                      <label className="queue-toggle queue-toggle-compact">
                        <input
                          type="checkbox"
                          checked={selectedAppActionIds.includes(action.id)}
                          onChange={(event) => {
                            setSelectedAppActionIds((current) => {
                              if (event.target.checked) {
                                return current.includes(action.id) ? current : [...current, action.id]
                              }

                              return current.filter((id) => id !== action.id)
                            })
                          }}
                        />
                        <span>
                          {action.action === 'navigate'
                            ? `Navigate to ${action.route ?? 'unknown route'}`
                            : action.action === 'open_health_check'
                            ? 'Open health-check page'
                            : action.action === 'reload_app'
                            ? 'Reload app'
                            : action.action === 'set_room_open'
                            ? `${action.open ? 'Open' : 'Close'} audience room`
                            : action.action === 'set_no_live_visibility'
                            ? `${action.visible ? 'Show' : 'Hide'} current gig on no-live audience page`
                            : action.action === 'mark_played'
                            ? 'Mark current song as played'
                            : action.action === 'skip_current_song'
                            ? 'Skip current song'
                            : action.action === 'choose_gig'
                            ? `Choose gig${action.gigName ? `: ${action.gigName}` : ''}`
                            : 'End current gig'}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="ai-manager-starters">
                  <button
                    type="button"
                    className="ai-manager-starter"
                    onClick={() => {
                      void applyAppActions()
                    }}
                    disabled={selectedAppActions.length === 0 || appActionBusy}
                  >
                    {appActionBusy ? 'Applying...' : 'Apply selected app actions'}
                  </button>
                  <button type="button" className="ai-manager-starter" onClick={dismissSelectedAppActions} disabled={selectedAppActions.length === 0 || appActionBusy}>Dismiss selected</button>
                  <button
                    type="button"
                    className="ai-manager-starter"
                    onClick={() => {
                      if (appActionBusy) {
                        return
                      }

                      setPendingAppActions([])
                      setSelectedAppActionIds([])
                    }}
                    disabled={appActionBusy}
                  >
                    Clear all
                  </button>
                </div>
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
        ref={fabRef}
        type="button"
        className={`ai-manager-fab ${open ? 'ai-manager-fab-open' : ''}${isDesktopFabDragEnabled && !open ? ' ai-manager-fab-draggable' : ''}${fabDragging ? ' ai-manager-fab-dragging' : ''}`}
        onPointerDown={handleFabPointerDown}
        onPointerMove={handleFabPointerMove}
        onPointerUp={handleFabPointerEnd}
        onPointerCancel={handleFabPointerEnd}
        onClick={() => {
          if (suppressFabToggleRef.current) {
            suppressFabToggleRef.current = false
            return
          }

          setOpen(prev => !prev)
        }}
        aria-label={open ? 'Close JukeOps Copilot' : 'Open JukeOps Copilot'}
      >
        <span className="ai-manager-fab-icon ai-manager-fab-icon-copilot" aria-hidden="true">
          {!avatarBroken && avatarSrc ? (
            <img
              src={avatarSrc}
              alt=""
              className="ai-manager-fab-image"
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <span className="ai-manager-avatar-fallback ai-manager-avatar-fallback-copilot">{avatarFallback}</span>
          )}
        </span>
      </button>
    </div>,
    document.body,
  )
}
