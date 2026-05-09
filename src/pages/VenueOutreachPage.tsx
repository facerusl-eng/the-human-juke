import { useEffect, useMemo, useState } from 'react'
import '../venue-outreach.css'

type PipelineStage = 'new' | 'contacted' | 'replied' | 'negotiating' | 'confirmed' | 'lost'
type SortMode = 'score' | 'distance' | 'name'
type TemplateMode = 'auto' | 'pub' | 'restaurant' | 'hotel' | 'corporate' | 'custom'
type SendMode = 'concept' | 'offer'
type ComposerMode = 'guided' | 'manual'

type SavedOutreachTemplate = {
  id: string
  name: string
  subject: string
  body: string
  createdAt: string
}

type Venue = {
  id: string
  name: string
  type: string
  address: string
  website: string
  phone: string
  email: string
  lat: number
  lon: number
  selected: boolean
  contactEmail: string
  notes: string
  distanceKm: number
  leadScore: number
  stage: PipelineStage
  useCustomContent: boolean
  customSubject: string
  customMessage: string
}

type OutreachResult = {
  venueName: string
  email: string
  ok: boolean
  error?: string
}

type OutreachLogEntry = {
  id: string
  venueName: string
  email: string
  status: 'sent' | 'failed'
  timestamp: string
  error?: string
  mode: SendMode
  campaign: string
  template: TemplateMode
}

type FollowUpTask = {
  id: string
  venueName: string
  email: string
  dueAt: string
  type: 'follow-up-3d' | 'follow-up-7d'
  completed: boolean
}

type CalendarEntryStatus = 'free' | 'booked'
type PaymentStatus = 'unpaid' | 'partial' | 'paid'

type CalendarEntry = {
  id: string
  date: string
  status: CalendarEntryStatus
  venueName: string
  city: string
  contact: string
  fee: string
  source: 'manual' | 'ai-manager'
  paymentStatus: PaymentStatus
  paymentAmount: string
  paidAt: string
  notes: string
  createdAt: string
  updatedAt: string
}

type CalendarDraft = {
  status: CalendarEntryStatus
  venueName: string
  city: string
  contact: string
  fee: string
  source: 'manual' | 'ai-manager'
  paymentStatus: PaymentStatus
  paymentAmount: string
  paidAt: string
  notes: string
}

const OUTREACH_LOG_STORAGE_KEY = 'human-jukebox-outreach-log'
const OUTREACH_STAGE_STORAGE_KEY = 'human-jukebox-outreach-stage-map'
const OUTREACH_TASKS_STORAGE_KEY = 'human-jukebox-outreach-tasks'
const OUTREACH_SESSION_STORAGE_KEY = 'human-jukebox-outreach-session'
const OUTREACH_TEMPLATE_STORAGE_KEY = 'human-jukebox-outreach-templates'
const OUTREACH_CALENDAR_STORAGE_KEY = 'human-jukebox-outreach-calendar'
const AI_MANAGER_OPEN_EVENT = 'human-jukebox-ai-manager-open'
const CALENDAR_UPDATED_EVENT = 'human-jukebox-calendar-updated'

type OutreachSessionState = {
  locationQuery: string
  radiusKm: number
  sortMode: SortMode
  templateMode: TemplateMode
  composerMode: ComposerMode
  campaignName: string
  manualSubject: string
  conceptText: string
  senderName: string
  senderEmail: string
  taxPercent: number
  venues: Venue[]
  centerInfo: { label: string; address: string; provider: string; lat: number; lon: number } | null
}

function normalizeTaxPercent(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Math.min(100, Math.max(0, parsed))
}

function parseOutreachSession(raw: string | null): OutreachSessionState | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const locationQuery = typeof parsed.locationQuery === 'string' ? parsed.locationQuery : '2200'
    const radius = Number(parsed.radiusKm)
    const radiusKm = Number.isFinite(radius) ? Math.max(1, Math.min(60, radius)) : 8
    const sortMode: SortMode = parsed.sortMode === 'distance' || parsed.sortMode === 'name' ? parsed.sortMode : 'score'
    const templateMode: TemplateMode =
      parsed.templateMode === 'pub'
      || parsed.templateMode === 'restaurant'
      || parsed.templateMode === 'hotel'
      || parsed.templateMode === 'corporate'
      || parsed.templateMode === 'custom'
        ? parsed.templateMode
        : 'auto'
    const composerMode: ComposerMode = parsed.composerMode === 'manual' ? 'manual' : 'guided'
    const taxPercent = normalizeTaxPercent(parsed.taxPercent)

    const center = parsed.centerInfo
    const centerInfo = center && typeof center === 'object'
      && typeof center.label === 'string'
      && typeof center.address === 'string'
      && typeof center.provider === 'string'
      && Number.isFinite(Number(center.lat))
      && Number.isFinite(Number(center.lon))
      ? {
        label: center.label,
        address: center.address,
        provider: center.provider,
        lat: Number(center.lat),
        lon: Number(center.lon),
      }
      : null

    return {
      locationQuery,
      radiusKm,
      sortMode,
      templateMode,
      composerMode,
      campaignName: typeof parsed.campaignName === 'string' ? parsed.campaignName : 'Spring Outreach',
      manualSubject: typeof parsed.manualSubject === 'string' ? parsed.manualSubject : 'Live music concept for your venue',
      conceptText: typeof parsed.conceptText === 'string' ? parsed.conceptText : '',
      senderName: typeof parsed.senderName === 'string' ? parsed.senderName : 'Harald',
      senderEmail: typeof parsed.senderEmail === 'string' ? parsed.senderEmail : 'harald@the-human-jukebox.org',
      taxPercent,
      venues: Array.isArray(parsed.venues) ? parsed.venues as Venue[] : [],
      centerInfo,
    }
  } catch {
    return null
  }
}

const STAGE_ORDER: PipelineStage[] = ['new', 'contacted', 'replied', 'negotiating', 'confirmed', 'lost']

const STAGE_LABELS: Record<PipelineStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  replied: 'Replied',
  negotiating: 'Negotiating',
  confirmed: 'Confirmed',
  lost: 'Lost',
}

const DEFAULT_PUB_OPENING_HOOK = 'I help pubs increase bar spend and keep guests longer with a live host-led music night that feels premium and easy to run.'
const DEFAULT_PUB_ONE_PERSON_LINE = 'It is only me running the concept, and I both host and perform, so you get one accountable person on-site from start to finish.'
const DEFAULT_PUB_APP_EDGE_LINE = 'Our ace up the sleeve is the Human Jukebox app: guests request songs from their phones, vote in real time, and stay engaged all evening.'
const DEFAULT_PUB_CTA_LINE = 'Would you be open to a low-risk test night so we can prove it in your room and measure guest response and bar uplift?'

const TEMPLATE_TEXT: Record<Exclude<TemplateMode, 'auto' | 'custom'>, string> = {
  pub: `${DEFAULT_PUB_OPENING_HOOK}\n\n${DEFAULT_PUB_ONE_PERSON_LINE}\n\n${DEFAULT_PUB_APP_EDGE_LINE}\n\n${DEFAULT_PUB_CTA_LINE}`,
  restaurant: 'We provide a guest-friendly live music concept that adds atmosphere without disrupting service flow. Guests can request songs from their phones and interact in real time.\n\nWould you be interested in trying this on one of your busier evenings?',
  hotel: 'We offer a premium live entertainment concept ideal for hotel bars and event evenings, with interactive song requests, controlled host pacing, and family-friendly flexibility.\n\nCould we explore a pilot event at your hotel venue?',
  corporate: 'We deliver a polished interactive live music concept perfect for company nights and branded events. Guests request songs, vote live, and stay engaged throughout.\n\nWould you like a proposal for an upcoming corporate event?',
}

const SEARCH_RADIUS_OPTIONS = [5, 8, 12, 20, 30, 45, 60]

const SORT_MODE_OPTIONS: Array<{ value: SortMode; label: string; description: string }> = [
  { value: 'score', label: 'Best leads', description: 'Prioritize venues with the strongest fit.' },
  { value: 'distance', label: 'Closest first', description: 'Keep routing tighter around the search center.' },
  { value: 'name', label: 'A-Z', description: 'Scan venues alphabetically.' },
]

const TEMPLATE_MODE_OPTIONS: Array<{ value: TemplateMode; label: string; description: string }> = [
  { value: 'auto', label: 'Auto', description: 'Match the message to each venue type.' },
  { value: 'pub', label: 'Pub / Bar', description: 'High-energy nightlife positioning.' },
  { value: 'restaurant', label: 'Restaurant', description: 'Keep it polished and service-friendly.' },
  { value: 'hotel', label: 'Hotel', description: 'Premium event-night framing.' },
  { value: 'corporate', label: 'Corporate', description: 'Professional private-event angle.' },
  { value: 'custom', label: 'Custom', description: 'Use the exact copy written below.' },
]

const COMPOSER_MODE_OPTIONS: Array<{ value: ComposerMode; label: string; description: string }> = [
  { value: 'guided', label: 'Guided outreach', description: 'Use venue-aware subjects and assisted pitch copy.' },
  { value: 'manual', label: 'Write it myself', description: 'Send the exact subject and email text you type below.' },
]

const TAX_PRESET_OPTIONS = [0, 8, 22, 25, 38, 45, 50]
const PAYMENT_AMOUNT_PRESET_OPTIONS = [1500, 2500, 3500, 4500, 6000]

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function parseStageMap(raw: string | null): Record<string, PipelineStage> {
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed as Record<string, PipelineStage> : {}
  } catch {
    return {}
  }
}

function toContactKey(name: string, email: string) {
  return `${name.trim().toLowerCase()}::${email.trim().toLowerCase()}`
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function inferTemplateModeFromVenueType(venueType: string): Exclude<TemplateMode, 'auto' | 'custom'> {
  if (/hotel|hostel|resort/i.test(venueType)) return 'hotel'
  if (/restaurant|cafe|bistro/i.test(venueType)) return 'restaurant'
  if (/pub|bar|nightclub|biergarten/i.test(venueType)) return 'pub'
  return 'corporate'
}

function scoreVenue(venue: Pick<Venue, 'type' | 'distanceKm' | 'website' | 'phone' | 'email'>, previouslyContacted: boolean) {
  let score = 0

  if (venue.email) score += 25
  if (venue.website) score += 15
  if (venue.phone) score += 10
  if (/pub|bar|nightclub|biergarten/i.test(venue.type)) score += 15

  const distanceScore = Math.max(0, 20 - Math.round(venue.distanceKm * 2))
  score += distanceScore

  if (!previouslyContacted) {
    score += 15
  }

  return Math.max(0, Math.min(100, score))
}

function estimateDriveTimeMinutes(distanceKm: number) {
  return Math.max(5, Math.round((distanceKm / 55) * 60))
}

function buildOfferMessage(baseConcept: string) {
  return `${baseConcept}\n\nOffer package:\n• 1 x host-led live set + karaoke flow\n• Mobile audience requests + voting\n• Full show control and engagement pacing\n• Setup and sound-check guidance included\n\nIf useful, we can also send a custom package for your exact audience profile and time slot.`
}

function formatVenueAddress(venue: Venue) {
  const address = venue.address.trim()
  if (address) {
    return address
  }

  return `Location: ${venue.lat.toFixed(5)}, ${venue.lon.toFixed(5)}`
}

function buildBaseDraft({
  venue,
  mode,
  composerMode,
  templateMode,
  manualSubject,
  conceptText,
  senderName,
  senderEmail,
}: {
  venue: Venue
  mode: SendMode
  composerMode: ComposerMode
  templateMode: TemplateMode
  manualSubject: string
  conceptText: string
  senderName: string
  senderEmail: string
}) {
  if (composerMode === 'manual') {
    return {
      subject: manualSubject.trim(),
      messageText: conceptText.trim(),
    }
  }

  const resolvedTemplate = templateMode === 'auto'
    ? inferTemplateModeFromVenueType(venue.type)
    : templateMode === 'custom'
    ? 'pub'
    : templateMode

  const baseMessage = templateMode === 'custom'
    ? conceptText
    : templateMode === 'auto'
    ? TEMPLATE_TEXT[resolvedTemplate]
    : TEMPLATE_TEXT[resolvedTemplate]

  const signatureName = senderName.trim() || 'Harald'
  const signatureEmail = senderEmail.trim() || 'harald@the-human-jukebox.org'
  const withVenueName = `${baseMessage}\n\nVenue: ${venue.name}\n\nBest regards,\n${signatureName}\n${signatureEmail}`
  const messageText = mode === 'offer' ? buildOfferMessage(withVenueName) : withVenueName
  const isPubTemplate = resolvedTemplate === 'pub'
  const subject = mode === 'offer'
    ? `Offer package for ${venue.name}`
    : isPubTemplate
    ? `Idea to increase guest spend at ${venue.name}`
    : `Live music concept for ${venue.name}`

  return {
    subject,
    messageText,
  }
}

function buildVenueDraft({
  venue,
  mode,
  composerMode,
  templateMode,
  manualSubject,
  conceptText,
  senderName,
  senderEmail,
}: {
  venue: Venue
  mode: SendMode
  composerMode: ComposerMode
  templateMode: TemplateMode
  manualSubject: string
  conceptText: string
  senderName: string
  senderEmail: string
}) {
  const baseDraft = buildBaseDraft({ venue, mode, composerMode, templateMode, manualSubject, conceptText, senderName, senderEmail })

  if (!venue.useCustomContent) {
    return baseDraft
  }

  return {
    subject: venue.customSubject.trim() || baseDraft.subject,
    messageText: venue.customMessage.trim() || baseDraft.messageText,
  }
}

function buildTemplateId() {
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function toDayIso(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toMonthIso(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function addDays(baseDate: Date, days: number) {
  const next = new Date(baseDate)
  next.setDate(baseDate.getDate() + days)
  return next
}

function buildCalendarEntryId(date: string) {
  return `calendar-${date}`
}

function getMonthGridDays(monthIso: string) {
  const [yearRaw, monthRaw] = monthIso.split('-')
  const year = Number(yearRaw)
  const monthIndex = Number(monthRaw) - 1

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return [] as Array<{ dateIso: string; dayOfMonth: number; inMonth: boolean }>
  }

  const monthStart = new Date(year, monthIndex, 1)
  const monthEnd = new Date(year, monthIndex + 1, 0)
  const startWeekday = monthStart.getDay()
  const gridStart = new Date(year, monthIndex, 1 - startWeekday)

  const days: Array<{ dateIso: string; dayOfMonth: number; inMonth: boolean }> = []
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + i)
    days.push({
      dateIso: toDayIso(day),
      dayOfMonth: day.getDate(),
      inMonth: day >= monthStart && day <= monthEnd,
    })
  }

  return days
}

function shiftMonthIso(monthIso: string, delta: number) {
  const [yearRaw, monthRaw] = monthIso.split('-')
  const year = Number(yearRaw)
  const monthIndex = Number(monthRaw) - 1

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return toMonthIso(new Date())
  }

  return toMonthIso(new Date(year, monthIndex + delta, 1))
}

function formatMonthIsoLabel(monthIso: string) {
  const [yearRaw, monthRaw] = monthIso.split('-')
  const year = Number(yearRaw)
  const monthIndex = Number(monthRaw) - 1

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return monthIso
  }

  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function parseCurrencyAmount(value: unknown) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    return null
  }

  let normalized = trimmed.replace(/[^\d,.-]/g, '')
  if (!normalized) {
    return null
  }

  const hasComma = normalized.includes(',')
  const hasDot = normalized.includes('.')

  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = normalized.replace(/,/g, '')
    }
  } else if (hasComma) {
    const parts = normalized.split(',')
    const decimals = parts[parts.length - 1] || ''
    normalized = decimals.length > 0 && decimals.length <= 2
      ? normalized.replace(',', '.')
      : normalized.replace(/,/g, '')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function formatDkk(amount: number) {
  return new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: 'DKK',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDkkInputPreset(amount: number) {
  return `DKK ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount)}`
}

function summarizeBookedFinancials(bookedEntries: CalendarEntry[], taxPercent: number) {
  let outstandingAmount = 0
  let paidAmount = 0
  let unknownOutstandingCount = 0
  let paidCount = 0
  let partialCount = 0
  let unpaidCount = 0

  bookedEntries.forEach((entry) => {
    const expectedAmount = parseCurrencyAmount(entry.fee) ?? parseCurrencyAmount(entry.paymentAmount)
    const paidEntryAmount = parseCurrencyAmount(entry.paymentAmount)

    if (entry.paymentStatus === 'paid') {
      paidCount += 1
      if (paidEntryAmount != null) {
        paidAmount += paidEntryAmount
      } else if (expectedAmount != null) {
        paidAmount += expectedAmount
      } else {
        unknownOutstandingCount += 1
      }
      return
    }

    if (entry.paymentStatus === 'partial') {
      partialCount += 1
      if (paidEntryAmount != null) {
        paidAmount += paidEntryAmount
      }

      if (expectedAmount != null) {
        outstandingAmount += Math.max(expectedAmount - (paidEntryAmount ?? 0), 0)
      } else {
        unknownOutstandingCount += 1
      }
      return
    }

    unpaidCount += 1
    if (expectedAmount != null) {
      outstandingAmount += expectedAmount
    } else {
      unknownOutstandingCount += 1
    }
  })

  const knownTotalAmount = outstandingAmount + paidAmount
  const paidCoveragePercent = knownTotalAmount > 0 ? Math.round((paidAmount / knownTotalAmount) * 100) : 0
  const estimatedTaxOnPaid = paidAmount * (taxPercent / 100)
  const netPaidAfterTax = Math.max(paidAmount - estimatedTaxOnPaid, 0)
  const projectedTaxOnKnownTotal = knownTotalAmount * (taxPercent / 100)
  const projectedNetAfterTax = Math.max(knownTotalAmount - projectedTaxOnKnownTotal, 0)

  return {
    bookedCount: bookedEntries.length,
    outstandingGigs: partialCount + unpaidCount,
    paidCount,
    partialCount,
    unpaidCount,
    outstandingAmount,
    paidAmount,
    unknownOutstandingCount,
    paidCoveragePercent,
    estimatedTaxOnPaid,
    netPaidAfterTax,
    knownTotalAmount,
    projectedTaxOnKnownTotal,
    projectedNetAfterTax,
  }
}

function VenueOutreachPage() {
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia('(max-width: 600px)').matches
  })

  const savedSession = useMemo(() => {
    if (typeof window === 'undefined') {
      return null
    }

    return parseOutreachSession(window.localStorage.getItem(OUTREACH_SESSION_STORAGE_KEY))
  }, [])

  const [locationQuery, setLocationQuery] = useState(savedSession?.locationQuery ?? '2200')
  const [radiusKm, setRadiusKm] = useState(savedSession?.radiusKm ?? 8)
  const [sortMode, setSortMode] = useState<SortMode>(savedSession?.sortMode ?? 'score')
  const [templateMode, setTemplateMode] = useState<TemplateMode>(savedSession?.templateMode ?? 'auto')
  const [composerMode, setComposerMode] = useState<ComposerMode>(savedSession?.composerMode ?? 'guided')
  const [campaignName, setCampaignName] = useState(savedSession?.campaignName ?? 'Spring Outreach')
  const [manualSubject, setManualSubject] = useState(savedSession?.manualSubject ?? 'Live music concept for your venue')
  const [conceptText, setConceptText] = useState(
    savedSession?.conceptText
    || 'We run a modern live music and karaoke concept where your guests can request songs live from their phones and vote in real time. We provide full host-led entertainment, energy, and a smooth setup for your venue.\n\nWould you be open to a test night or a recurring collaboration?',
  )
  const [pubOpeningHook, setPubOpeningHook] = useState(DEFAULT_PUB_OPENING_HOOK)
  const [pubOnePersonLine, setPubOnePersonLine] = useState(DEFAULT_PUB_ONE_PERSON_LINE)
  const [pubAppEdgeLine, setPubAppEdgeLine] = useState(DEFAULT_PUB_APP_EDGE_LINE)
  const [pubCtaLine, setPubCtaLine] = useState(DEFAULT_PUB_CTA_LINE)
  const [senderName, setSenderName] = useState(savedSession?.senderName ?? 'Harald')
  const [senderEmail, setSenderEmail] = useState(savedSession?.senderEmail ?? 'harald@the-human-jukebox.org')
  const [taxPercent, setTaxPercent] = useState(savedSession?.taxPercent ?? 0)
  const [venues, setVenues] = useState<Venue[]>(savedSession?.venues ?? [])
  const [searching, setSearching] = useState(false)
  const [sendingMode, setSendingMode] = useState<SendMode | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [centerInfo, setCenterInfo] = useState<{ label: string; address: string; provider: string; lat: number; lon: number } | null>(savedSession?.centerInfo ?? null)

  const [logEntries, setLogEntries] = useState<OutreachLogEntry[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }

    return parseJsonArray<OutreachLogEntry>(window.localStorage.getItem(OUTREACH_LOG_STORAGE_KEY))
  })

  const [stageMap, setStageMap] = useState<Record<string, PipelineStage>>(() => {
    if (typeof window === 'undefined') {
      return {}
    }

    return parseStageMap(window.localStorage.getItem(OUTREACH_STAGE_STORAGE_KEY))
  })

  const [followUpTasks, setFollowUpTasks] = useState<FollowUpTask[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }

    return parseJsonArray<FollowUpTask>(window.localStorage.getItem(OUTREACH_TASKS_STORAGE_KEY))
  })
  const [savedTemplates, setSavedTemplates] = useState<SavedOutreachTemplate[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }

    return parseJsonArray<SavedOutreachTemplate>(window.localStorage.getItem(OUTREACH_TEMPLATE_STORAGE_KEY))
  })
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>(() => {
    if (typeof window === 'undefined') {
      return []
    }

    return parseJsonArray<CalendarEntry>(window.localStorage.getItem(OUTREACH_CALENDAR_STORAGE_KEY))
      .filter((entry) => normalizeIsoDate(entry.date))
  })
  const [calendarMonth, setCalendarMonth] = useState(() => toMonthIso(new Date()))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => toDayIso(new Date()))
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft>({
    status: 'free',
    venueName: '',
    city: '',
    contact: '',
    fee: '',
    source: 'manual',
    paymentStatus: 'unpaid',
    paymentAmount: '',
    paidAt: '',
    notes: '',
  })
  const [templateName, setTemplateName] = useState('')
  const [previewVenueId, setPreviewVenueId] = useState<string>('')

  const selectedCount = useMemo(() => venues.filter((venue) => venue.selected).length, [venues])

  const sortedVenues = useMemo(() => {
    const copy = [...venues]

    if (sortMode === 'distance') {
      copy.sort((a, b) => a.distanceKm - b.distanceKm)
      return copy
    }

    if (sortMode === 'name') {
      copy.sort((a, b) => a.name.localeCompare(b.name))
      return copy
    }

    copy.sort((a, b) => b.leadScore - a.leadScore || a.distanceKm - b.distanceKm)
    return copy
  }, [venues, sortMode])

  const analytics = useMemo(() => {
    const sent = logEntries.filter((entry) => entry.status === 'sent')
    const failed = logEntries.filter((entry) => entry.status === 'failed')
    const pipelineCounts = STAGE_ORDER.reduce((acc, stage) => {
      acc[stage] = 0
      return acc
    }, {} as Record<PipelineStage, number>)

    Object.values(stageMap).forEach((stage) => {
      pipelineCounts[stage] += 1
    })

    const contacted = pipelineCounts.contacted + pipelineCounts.replied + pipelineCounts.negotiating + pipelineCounts.confirmed + pipelineCounts.lost
    const confirmed = pipelineCounts.confirmed
    const replyStages = pipelineCounts.replied + pipelineCounts.negotiating + pipelineCounts.confirmed

    return {
      sentCount: sent.length,
      failedCount: failed.length,
      successRate: sent.length + failed.length === 0 ? 0 : Math.round((sent.length / (sent.length + failed.length)) * 100),
      contacted,
      confirmed,
      replyStages,
      conversionRate: contacted === 0 ? 0 : Math.round((confirmed / contacted) * 100),
    }
  }, [logEntries, stageMap])

  const pendingTasks = useMemo(
    () => followUpTasks.filter((task) => !task.completed).sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    [followUpTasks],
  )

  const calendarEntryByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry>()
    calendarEntries.forEach((entry) => {
      if (normalizeIsoDate(entry.date)) {
        map.set(entry.date, entry)
      }
    })
    return map
  }, [calendarEntries])

  const selectedCalendarEntry = calendarEntryByDate.get(selectedCalendarDate) ?? null

  const calendarMonthDays = useMemo(
    () => getMonthGridDays(calendarMonth),
    [calendarMonth],
  )

  const upcomingCalendarEntries = useMemo(() => {
    const todayIso = toDayIso(new Date())
    return [...calendarEntries]
      .filter((entry) => normalizeIsoDate(entry.date) && entry.date >= todayIso)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [calendarEntries])

  const upcomingBooked = useMemo(
    () => upcomingCalendarEntries.filter((entry) => entry.status === 'booked').slice(0, 12),
    [upcomingCalendarEntries],
  )

  const paymentInsights = useMemo(() => {
    const upcomingBookedAll = upcomingCalendarEntries.filter((entry) => entry.status === 'booked')
    return {
      upcomingBookedCount: upcomingBookedAll.length,
      ...summarizeBookedFinancials(upcomingBookedAll, taxPercent),
    }
  }, [upcomingCalendarEntries, taxPercent])

  const monthlyPaymentInsights = useMemo(() => {
    const bookedInMonth = calendarEntries.filter((entry) => entry.status === 'booked' && entry.date.startsWith(`${calendarMonth}-`))
    return summarizeBookedFinancials(bookedInMonth, taxPercent)
  }, [calendarEntries, calendarMonth, taxPercent])

  const previousMonthPaymentInsights = useMemo(() => {
    const previousMonth = shiftMonthIso(calendarMonth, -1)
    const bookedInPreviousMonth = calendarEntries.filter((entry) => entry.status === 'booked' && entry.date.startsWith(`${previousMonth}-`))
    return summarizeBookedFinancials(bookedInPreviousMonth, taxPercent)
  }, [calendarEntries, calendarMonth, taxPercent])

  const monthNetDelta = useMemo(() => {
    return monthlyPaymentInsights.netPaidAfterTax - previousMonthPaymentInsights.netPaidAfterTax
  }, [monthlyPaymentInsights.netPaidAfterTax, previousMonthPaymentInsights.netPaidAfterTax])

  const pastBookedCount = useMemo(() => {
    const todayIso = toDayIso(new Date())
    return calendarEntries.filter((entry) => entry.status === 'booked' && entry.date < todayIso).length
  }, [calendarEntries])

  const upcomingFree = useMemo(
    () => upcomingCalendarEntries.filter((entry) => entry.status === 'free').slice(0, 12),
    [upcomingCalendarEntries],
  )

  const calendarInsights = useMemo(() => {
    const today = new Date()
    const horizon = addDays(today, 30)
    const todayIso = toDayIso(today)
    const horizonIso = toDayIso(horizon)

    const nextThirty = calendarEntries.filter((entry) => entry.date >= todayIso && entry.date <= horizonIso)
    const bookedNextThirty = nextThirty.filter((entry) => entry.status === 'booked').length
    const freeNextThirty = nextThirty.filter((entry) => entry.status === 'free').length
    const totalTagged = bookedNextThirty + freeNextThirty
    const utilization = totalTagged > 0 ? Math.round((bookedNextThirty / totalTagged) * 100) : 0

    return {
      bookedNextThirty,
      freeNextThirty,
      utilization,
      totalTagged,
    }
  }, [calendarEntries])

  const previewVenue = useMemo(() => {
    return venues.find((venue) => venue.id === previewVenueId)
      || venues.find((venue) => venue.selected)
      || sortedVenues[0]
      || null
  }, [previewVenueId, venues, sortedVenues])

  const previewDraft = useMemo(() => {
    if (!previewVenue) {
      return null
    }

    return buildVenueDraft({
      venue: previewVenue,
      mode: composerMode === 'manual' ? 'concept' : 'concept',
      composerMode,
      templateMode,
      manualSubject,
      conceptText,
      senderName,
      senderEmail,
    })
  }, [previewVenue, composerMode, templateMode, manualSubject, conceptText, senderName, senderEmail])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 600px)')
    const onViewportChange = (event: MediaQueryListEvent) => setIsMobileViewport(event.matches)

    setIsMobileViewport(mediaQuery.matches)
    mediaQuery.addEventListener('change', onViewportChange)

    return () => {
      mediaQuery.removeEventListener('change', onViewportChange)
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    document.body.classList.add('venue-outreach-page-active')

    return () => {
      document.body.classList.remove('venue-outreach-page-active')
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const sessionState: OutreachSessionState = {
      locationQuery,
      radiusKm,
      sortMode,
      templateMode,
      composerMode,
      campaignName,
      manualSubject,
      conceptText,
      senderName,
      senderEmail,
      taxPercent,
      venues,
      centerInfo,
    }

    window.localStorage.setItem(OUTREACH_SESSION_STORAGE_KEY, JSON.stringify(sessionState))
  }, [locationQuery, radiusKm, sortMode, templateMode, composerMode, campaignName, manualSubject, conceptText, senderName, senderEmail, taxPercent, venues, centerInfo])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(OUTREACH_CALENDAR_STORAGE_KEY, JSON.stringify(calendarEntries))
  }, [calendarEntries])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const onCalendarUpdated = () => {
      const entries = parseJsonArray<CalendarEntry>(window.localStorage.getItem(OUTREACH_CALENDAR_STORAGE_KEY))
        .filter((entry) => normalizeIsoDate(entry.date))
      setCalendarEntries(entries)
    }

    window.addEventListener(CALENDAR_UPDATED_EVENT, onCalendarUpdated)

    return () => {
      window.removeEventListener(CALENDAR_UPDATED_EVENT, onCalendarUpdated)
    }
  }, [])

  useEffect(() => {
    if (!selectedCalendarEntry) {
      setCalendarDraft({
        status: 'free',
        venueName: '',
        city: '',
        contact: '',
        fee: '',
        source: 'manual',
        paymentStatus: 'unpaid',
        paymentAmount: '',
        paidAt: '',
        notes: '',
      })
      return
    }

    setCalendarDraft({
      status: selectedCalendarEntry.status,
      venueName: selectedCalendarEntry.venueName || '',
      city: selectedCalendarEntry.city || '',
      contact: selectedCalendarEntry.contact || '',
      fee: selectedCalendarEntry.fee || '',
      source: selectedCalendarEntry.source || 'manual',
      paymentStatus: selectedCalendarEntry.paymentStatus || 'unpaid',
      paymentAmount: selectedCalendarEntry.paymentAmount || '',
      paidAt: selectedCalendarEntry.paidAt || '',
      notes: selectedCalendarEntry.notes || '',
    })
  }, [selectedCalendarDate, selectedCalendarEntry])

  const withSavedLog = (entries: OutreachLogEntry[]) => {
    setLogEntries(entries)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OUTREACH_LOG_STORAGE_KEY, JSON.stringify(entries))
    }
  }

  const withSavedStageMap = (nextMap: Record<string, PipelineStage>) => {
    setStageMap(nextMap)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OUTREACH_STAGE_STORAGE_KEY, JSON.stringify(nextMap))
    }
  }

  const withSavedTasks = (entries: FollowUpTask[]) => {
    setFollowUpTasks(entries)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OUTREACH_TASKS_STORAGE_KEY, JSON.stringify(entries))
    }
  }

  const withSavedTemplates = (entries: SavedOutreachTemplate[]) => {
    setSavedTemplates(entries)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OUTREACH_TEMPLATE_STORAGE_KEY, JSON.stringify(entries))
    }
  }

  const withSavedCalendarEntries = (entries: CalendarEntry[]) => {
    setCalendarEntries(entries)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(OUTREACH_CALENDAR_STORAGE_KEY, JSON.stringify(entries))
    }
  }

  const runVenueSearch = async () => {
    setSearching(true)
    setSearchError(null)
    setStatusText(null)

    try {
      const query = new URLSearchParams({
        location: locationQuery,
        radiusKm: String(radiusKm),
        limit: '50',
      })

      const response = await fetch(`/api/venue-search?${query.toString()}`)
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Venue search failed.')
      }

      const center = payload?.center
      const centerLat = Number(center?.lat)
      const centerLon = Number(center?.lon)
      const hasCenter = Number.isFinite(centerLat) && Number.isFinite(centerLon)

      if (hasCenter) {
        setCenterInfo({
          label: String(center?.location || locationQuery),
          address: String(center?.address || center?.location || locationQuery),
          provider: String(center?.provider || 'Nominatim (OpenStreetMap)'),
          lat: centerLat,
          lon: centerLon,
        })
      }

      const contactedKeys = new Set(
        logEntries
          .filter((entry) => entry.status === 'sent')
          .map((entry) => toContactKey(entry.venueName, entry.email)),
      )

      const nextVenues: Venue[] = Array.isArray(payload?.venues)
        ? payload.venues.map((venue: Omit<Venue, 'selected' | 'contactEmail' | 'notes' | 'distanceKm' | 'leadScore' | 'stage'>) => {
          const contactEmail = venue.email || ''
          const distanceKm = hasCenter ? haversineKm(centerLat, centerLon, venue.lat, venue.lon) : 0
          const key = toContactKey(venue.name, contactEmail)
          const stage = stageMap[key] || 'new'
          const leadScore = scoreVenue({
            type: venue.type,
            distanceKm,
            website: venue.website,
            phone: venue.phone,
            email: contactEmail,
          }, contactedKeys.has(key))

          return {
            ...venue,
            selected: false,
            contactEmail,
            notes: '',
            distanceKm,
            leadScore,
            stage,
            useCustomContent: false,
            customSubject: '',
            customMessage: '',
          }
        })
        : []

      setVenues(nextVenues)
      setStatusText(`Found ${nextVenues.length} nearby places.`)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Failed to search nearby places.')
    } finally {
      setSearching(false)
    }
  }

  const updateVenue = (venueId: string, updates: Partial<Venue>) => {
    setVenues((current) => current.map((venue) => (
      venue.id === venueId
        ? { ...venue, ...updates }
        : venue
    )))
  }

  const setVenueStage = (venue: Venue, stage: PipelineStage) => {
    const key = toContactKey(venue.name, venue.contactEmail)
    withSavedStageMap({
      ...stageMap,
      [key]: stage,
    })

    updateVenue(venue.id, { stage })
  }

  const toggleSelectAll = () => {
    const shouldSelectAll = venues.some((venue) => !venue.selected)
    setVenues((current) => current.map((venue) => ({ ...venue, selected: shouldSelectAll })))
  }

  const applyTemplateToComposer = () => {
    if (templateMode === 'custom' || templateMode === 'auto') {
      return
    }

    setConceptText(TEMPLATE_TEXT[templateMode])
  }

  const applyPubSalesForm = () => {
    const sections = [
      pubOpeningHook.trim(),
      pubOnePersonLine.trim(),
      pubAppEdgeLine.trim(),
      pubCtaLine.trim(),
    ].filter(Boolean)

    if (sections.length < 3) {
      setSendError('Add at least opening, app edge, and a call-to-action in the pub sales form.')
      return
    }

    setComposerMode('guided')
    setTemplateMode('pub')
    setConceptText(sections.join('\n\n'))
    setStatusText('Applied pub sales form to guided outreach copy.')
    setSendError(null)
  }

  const createFollowUpTasks = (successful: Array<{ venueName: string; email: string }>) => {
    const now = new Date()
    const next = [...followUpTasks]

    for (const item of successful) {
      for (const dayOffset of [3, 7]) {
        const due = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000)
        const type = dayOffset === 3 ? 'follow-up-3d' : 'follow-up-7d'
        const taskId = `${item.venueName.toLowerCase()}::${item.email.toLowerCase()}::${type}::${due.toISOString().slice(0, 10)}`

        if (next.some((task) => task.id === taskId)) {
          continue
        }

        next.push({
          id: taskId,
          venueName: item.venueName,
          email: item.email,
          dueAt: due.toISOString(),
          type,
          completed: false,
        })
      }
    }

    withSavedTasks(next)
  }

  const saveCurrentTemplate = () => {
    const name = templateName.trim()
    const subject = manualSubject.trim()
    const body = conceptText.trim()

    if (!name) {
      setSendError('Give the template a name before saving it.')
      return
    }

    if (!subject || !body) {
      setSendError('Subject and message are required before saving a template.')
      return
    }

    const nextTemplate: SavedOutreachTemplate = {
      id: buildTemplateId(),
      name,
      subject,
      body,
      createdAt: new Date().toISOString(),
    }

    withSavedTemplates([nextTemplate, ...savedTemplates].slice(0, 40))
    setTemplateName('')
    setStatusText(`Saved template “${name}”.`)
    setSendError(null)
  }

  const loadSavedTemplate = (template: SavedOutreachTemplate) => {
    setComposerMode('manual')
    setManualSubject(template.subject)
    setConceptText(template.body)
    setStatusText(`Loaded template “${template.name}”.`)
    setSendError(null)
  }

  const deleteSavedTemplate = (templateId: string) => {
    withSavedTemplates(savedTemplates.filter((template) => template.id !== templateId))
  }

  const buildContactsPayload = (mode: SendMode, selectedVenues: Venue[]) => {
    return selectedVenues
      .map((venue) => {
        const email = venue.contactEmail.trim()

        if (!email) {
          return null
        }
        const draft = buildVenueDraft({
          venue,
          mode,
          composerMode,
          templateMode,
          manualSubject,
          conceptText,
          senderName,
          senderEmail,
        })

        return {
          venueId: venue.id,
          venueName: venue.name,
          email,
          subject: draft.subject,
          messageText: draft.messageText,
        }
      })
      .filter((contact): contact is { venueId: string; venueName: string; email: string; subject: string; messageText: string } => Boolean(contact))
  }

  const runSendTestEmail = async () => {
    setSendError(null)
    setStatusText(null)

    if (!senderEmail.trim()) {
      setSendError('Sender email is required before sending a test email to yourself.')
      return
    }

    if (!previewVenue || !previewDraft) {
      setSendError('Pick or load a venue first so the test email has content to preview and send.')
      return
    }

    if (!previewDraft.subject.trim() || !previewDraft.messageText.trim()) {
      setSendError('Subject and message are required before sending a test email.')
      return
    }

    setSendingMode('concept')

    try {
      const response = await fetch('/api/send-outreach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          senderName,
          senderEmail,
          emailMode: 'concept',
          subject: `[Test] ${previewDraft.subject}`,
          messageText: previewDraft.messageText,
          contacts: [{
            venueId: previewVenue.id,
            venueName: `${previewVenue.name} (test)`,
            email: senderEmail.trim(),
            subject: `[Test] ${previewDraft.subject}`,
            messageText: previewDraft.messageText,
          }],
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to send test email.')
      }

      setStatusText(`Sent a test email to ${senderEmail.trim()}.`)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Failed to send test email.')
    } finally {
      setSendingMode(null)
    }
  }

  const runSend = async (mode: SendMode) => {
    setSendError(null)
    setStatusText(null)

    const selectedVenues = venues.filter((venue) => venue.selected)

    if (!selectedVenues.length) {
      setSendError('Choose at least one venue to send.')
      return
    }

    if (!senderEmail.trim()) {
      setSendError('Sender email is required so venues can reply to you.')
      return
    }

    if (!conceptText.trim()) {
      setSendError(composerMode === 'manual' ? 'Write your email before sending.' : 'Message text is required before sending.')
      return
    }

    if (composerMode === 'manual' && !manualSubject.trim()) {
      setSendError('Add an email subject before sending your manual email.')
      return
    }

    const contacts = buildContactsPayload(mode, selectedVenues)

    if (!contacts.length) {
      setSendError('Add at least one contact email before sending.')
      return
    }

    const duplicateSet = new Set<string>()
    const duplicates = contacts.filter((contact) => {
      const key = contact.email.toLowerCase()
      if (duplicateSet.has(key)) {
        return true
      }
      duplicateSet.add(key)
      return false
    })

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const recentlyContacted = contacts.filter((contact) => (
      logEntries.some((entry) => (
        entry.status === 'sent'
        && entry.email.toLowerCase() === contact.email.toLowerCase()
        && new Date(entry.timestamp).getTime() >= thirtyDaysAgo
      ))
    ))

    const lowConfidence = selectedVenues.filter((venue) => venue.leadScore < 40)

    if (duplicates.length || recentlyContacted.length || lowConfidence.length) {
      const warning = [
        duplicates.length ? `Duplicates in selection: ${duplicates.length}` : '',
        recentlyContacted.length ? `Recently contacted (30d): ${recentlyContacted.length}` : '',
        lowConfidence.length ? `Low confidence leads: ${lowConfidence.length}` : '',
        '',
        'Send anyway?',
      ].filter(Boolean).join('\n')

      if (!window.confirm(warning)) {
        return
      }
    }

    setSendingMode(mode)

    try {
      const response = await fetch('/api/send-outreach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          senderName,
          senderEmail,
          emailMode: mode,
          subject: composerMode === 'manual'
            ? manualSubject
            : mode === 'offer'
            ? 'Live offer package'
            : 'Live music concept',
          messageText: conceptText,
          contacts,
        }),
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to send outreach emails.')
      }

      const results = Array.isArray(payload?.results) ? payload.results as OutreachResult[] : []
      const nowIso = new Date().toISOString()

      const freshLogs: OutreachLogEntry[] = results.map((result) => ({
        id: `${result.venueName}-${result.email}-${nowIso}-${mode}`,
        venueName: result.venueName,
        email: result.email,
        status: result.ok ? 'sent' : 'failed',
        timestamp: nowIso,
        error: result.error,
        mode,
        campaign: campaignName,
        template: templateMode,
      }))

      withSavedLog([...freshLogs, ...logEntries].slice(0, 800))

      const successful = results.filter((result) => result.ok)
      const failedEmailSet = new Set(
        results
          .filter((result) => !result.ok)
          .map((result) => `${result.venueName.toLowerCase()}::${result.email.toLowerCase()}`),
      )

      const nextStageMap = { ...stageMap }
      successful.forEach((item) => {
        const key = toContactKey(item.venueName, item.email)
        if (!nextStageMap[key] || nextStageMap[key] === 'new') {
          nextStageMap[key] = 'contacted'
        }
      })
      withSavedStageMap(nextStageMap)

      createFollowUpTasks(successful.map((item) => ({ venueName: item.venueName, email: item.email })))

      setVenues((current) => current.map((venue) => {
        const key = `${venue.name.toLowerCase()}::${venue.contactEmail.trim().toLowerCase()}`
        const stageKey = toContactKey(venue.name, venue.contactEmail)
        return {
          ...venue,
          selected: failedEmailSet.has(key),
          stage: nextStageMap[stageKey] || venue.stage,
        }
      }))

      setStatusText(`Sent ${payload.successCount ?? 0} ${mode} email(s). Failed: ${payload.failureCount ?? 0}.`)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Failed to send outreach emails.')
    } finally {
      setSendingMode(null)
    }
  }

  const markTaskDone = (taskId: string, done: boolean) => {
    withSavedTasks(followUpTasks.map((task) => (
      task.id === taskId ? { ...task, completed: done } : task
    )))
  }

  const openAiManager = () => {
    if (typeof window === 'undefined') {
      return
    }

    window.dispatchEvent(new CustomEvent(AI_MANAGER_OPEN_EVENT))
  }

  const saveCalendarDay = () => {
    if (!normalizeIsoDate(selectedCalendarDate)) {
      setSendError('Pick a valid date in the calendar first.')
      return
    }

    if (calendarDraft.status === 'booked' && !calendarDraft.venueName.trim()) {
      setSendError('Booked dates need a venue name so your AI manager can use the booking details.')
      return
    }

    const now = new Date().toISOString()
    const nextEntry: CalendarEntry = {
      id: selectedCalendarEntry?.id || buildCalendarEntryId(selectedCalendarDate),
      date: selectedCalendarDate,
      status: calendarDraft.status,
      venueName: calendarDraft.venueName.trim(),
      city: calendarDraft.city.trim(),
      contact: calendarDraft.contact.trim(),
      fee: calendarDraft.fee.trim(),
      source: calendarDraft.source,
      paymentStatus: calendarDraft.status === 'booked' ? calendarDraft.paymentStatus : 'unpaid',
      paymentAmount: calendarDraft.status === 'booked' ? calendarDraft.paymentAmount.trim() : '',
      paidAt: calendarDraft.status === 'booked' ? calendarDraft.paidAt.trim() : '',
      notes: calendarDraft.notes.trim(),
      createdAt: selectedCalendarEntry?.createdAt || now,
      updatedAt: now,
    }

    const next = [
      ...calendarEntries.filter((entry) => entry.date !== selectedCalendarDate),
      nextEntry,
    ].sort((a, b) => a.date.localeCompare(b.date))

    withSavedCalendarEntries(next)
    setStatusText(`Saved ${nextEntry.status} day on ${selectedCalendarDate}.`)
    setSendError(null)
  }

  const clearCalendarDay = () => {
    if (!selectedCalendarEntry) {
      return
    }

    withSavedCalendarEntries(calendarEntries.filter((entry) => entry.date !== selectedCalendarDate))
    setStatusText(`Cleared calendar day ${selectedCalendarDate}.`)
    setSendError(null)
  }

  const upsertCalendarEntry = (date: string, draft: CalendarDraft, nextSource: CalendarEntry['source']) => {
    const now = new Date().toISOString()
    const current = calendarEntryByDate.get(date)
    const nextEntry: CalendarEntry = {
      id: current?.id || buildCalendarEntryId(date),
      date,
      status: draft.status,
      venueName: draft.venueName.trim(),
      city: draft.city.trim(),
      contact: draft.contact.trim(),
      fee: draft.fee.trim(),
      source: nextSource,
      paymentStatus: draft.status === 'booked' ? draft.paymentStatus : 'unpaid',
      paymentAmount: draft.status === 'booked' ? draft.paymentAmount.trim() : '',
      paidAt: draft.status === 'booked' ? draft.paidAt.trim() : '',
      notes: draft.notes.trim(),
      createdAt: current?.createdAt || now,
      updatedAt: now,
    }

    const nextEntries = [
      ...calendarEntries.filter((entry) => entry.date !== date),
      nextEntry,
    ].sort((a, b) => a.date.localeCompare(b.date))

    withSavedCalendarEntries(nextEntries)
    return nextEntry
  }

  const markWeekendsFree = () => {
    const start = new Date()
    const nextEntries = [...calendarEntries]
    const existingByDate = new Map(nextEntries.map((entry) => [entry.date, entry]))
    const touched: string[] = []

    for (let i = 0; i < 56; i += 1) {
      const day = addDays(start, i)
      const weekday = day.getDay()
      if (weekday !== 5 && weekday !== 6) {
        continue
      }

      const dayIso = toDayIso(day)
      const existing = existingByDate.get(dayIso)
      if (existing?.status === 'booked') {
        continue
      }

      const now = new Date().toISOString()
      const updated: CalendarEntry = {
        id: existing?.id || buildCalendarEntryId(dayIso),
        date: dayIso,
        status: 'free',
        venueName: existing?.venueName || '',
        city: existing?.city || '',
        contact: existing?.contact || '',
        fee: existing?.fee || '',
        source: existing?.source || 'manual',
        paymentStatus: existing?.paymentStatus || 'unpaid',
        paymentAmount: existing?.paymentAmount || '',
        paidAt: existing?.paidAt || '',
        notes: existing?.notes || 'Weekend slot marked free',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }

      existingByDate.set(dayIso, updated)
      touched.push(dayIso)
    }

    const merged = [...existingByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
    withSavedCalendarEntries(merged)
    setStatusText(`Marked ${touched.length} weekend date(s) as free for the next 8 weeks.`)
    setSendError(null)
  }

  const clearPastFreeDates = () => {
    const todayIso = toDayIso(new Date())
    const beforeCount = calendarEntries.length
    const nextEntries = calendarEntries.filter((entry) => !(entry.status === 'free' && entry.date < todayIso))
    const removed = beforeCount - nextEntries.length
    withSavedCalendarEntries(nextEntries)
    setStatusText(removed > 0 ? `Removed ${removed} past free date(s).` : 'No past free dates to remove.')
    setSendError(null)
  }

  const exportCalendarCsv = () => {
    if (typeof window === 'undefined') {
      return
    }

    const rows = [
      ['date', 'status', 'venue_name', 'city', 'contact', 'fee', 'payment_status', 'payment_amount', 'paid_at', 'source', 'notes'],
      ...[...calendarEntries]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((entry) => [
          entry.date,
          entry.status,
          entry.venueName,
          entry.city,
          entry.contact,
          entry.fee,
          entry.paymentStatus,
          entry.paymentAmount,
          entry.paidAt,
          entry.source,
          entry.notes,
        ]),
    ]

    const escapeCell = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const csv = rows.map((row) => row.map(escapeCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `outreach-calendar-${toDayIso(new Date())}.csv`
    anchor.click()
    window.URL.revokeObjectURL(url)
    setStatusText('Exported calendar CSV.')
    setSendError(null)
  }

  const quickBookVenueOnSelectedDate = (venue: Venue) => {
    if (!normalizeIsoDate(selectedCalendarDate)) {
      setSendError('Pick a date in the calendar first, then use quick book from a venue card.')
      return
    }

    const cityGuess = venue.address.split(',').map((part) => part.trim()).filter(Boolean).pop() || ''
    const contact = venue.contactEmail || venue.phone || ''
    const draft: CalendarDraft = {
      status: 'booked',
      venueName: venue.name,
      city: cityGuess,
      contact,
      fee: '',
      source: 'manual',
      paymentStatus: 'unpaid',
      paymentAmount: '',
      paidAt: '',
      notes: `Booked from outreach lead · stage: ${STAGE_LABELS[venue.stage]}`,
    }

    const saved = upsertCalendarEntry(selectedCalendarDate, draft, 'manual')
    setCalendarDraft(draft)
    setCalendarMonth(selectedCalendarDate.slice(0, 7))
    setStatusText(`Booked ${saved.venueName || 'venue'} on ${saved.date} from outreach lead.`)
    setSendError(null)
    scrollToSection('outreach-calendar')
  }

  const scrollToSection = (id: string) => {
    if (typeof document === 'undefined') {
      return
    }

    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="create-gig-shell venue-outreach-shell" aria-label="Venue outreach manager">
      {/* Header Section */}
      <header className="venue-outreach-header">
        <div className="venue-outreach-header-content">
          <h1 className="venue-outreach-header-title">Venue Outreach</h1>
          <p className="venue-outreach-header-subtitle">Grow your gigs. Contact venues. Track your progress.</p>
        </div>
      </header>

      {/* Quick Actions Bar */}
      <nav className="venue-outreach-quick-actions">
        <button
          type="button"
          className="venue-outreach-action-btn primary-button"
          onClick={() => {
            scrollToSection('outreach-venues')
          }}
        >
          ➕ Add Venue
        </button>
        <button
          type="button"
          className="venue-outreach-action-btn primary-button"
          onClick={() => void runSend('concept')}
          disabled={searching || Boolean(sendingMode) || !venues.length}
        >
          ✉️ Send Email
        </button>
        <button
          type="button"
          className="venue-outreach-action-btn primary-button"
          onClick={() => {
            const modes: TemplateMode[] = ['auto', 'pub', 'restaurant', 'hotel', 'corporate', 'custom']
            const current = modes.indexOf(templateMode)
            const next = (current + 1) % modes.length
            setTemplateMode(modes[next])
          }}
        >
          📋 Manage Templates
        </button>
        <button
          type="button"
          className="venue-outreach-action-btn secondary-button venue-outreach-mobile-ai-button"
          onClick={openAiManager}
        >
          Open AI Manager
        </button>
      </nav>

      {/* Info Box */}
      <article className="venue-outreach-info-box">
        <h3 className="venue-outreach-info-title">💡 What is Venue Outreach?</h3>
        <p className="venue-outreach-info-text">
          Use this tool to contact venues, track replies, and grow your Human Jukebox gigs. Search for nearby venues, send personalized concepts, and manage your pipeline all in one place.
        </p>
      </article>

      <section className="queue-panel venue-outreach-kpi-panel" aria-label="Outreach summary">
        <article className="venue-kpi-card">
          <span className="venue-kpi-label">Venues found</span>
          <strong>{venues.length}</strong>
        </article>
        <article className="venue-kpi-card">
          <span className="venue-kpi-label">Selected to send</span>
          <strong>{selectedCount}</strong>
        </article>
        <article className="venue-kpi-card">
          <span className="venue-kpi-label">Sent emails</span>
          <strong>{analytics.sentCount}</strong>
        </article>
        <article className="venue-kpi-card">
          <span className="venue-kpi-label">Success rate</span>
          <strong>{analytics.successRate}%</strong>
        </article>
      </section>

      <section className="queue-panel venue-outreach-campaign-panel venue-outreach-major-card" id="outreach-search">
        <div className="panel-head">
          <h2>Search & Campaign</h2>
        </div>
        <div className="venue-outreach-campaign-stack">
          <section className="venue-outreach-control-card venue-outreach-major-card" aria-label="Search settings" id="outreach-search-settings">
            <details className="venue-outreach-collapsible" {...(!isMobileViewport ? { open: true } : {})}>
              <summary className="venue-outreach-collapsible-summary">Search</summary>
              <div className="venue-outreach-collapsible-body">
            <div className="venue-outreach-section-lead">
              <span className="venue-outreach-section-tag">Venue discovery</span>
              <h3>Search area and filters</h3>
              <p>Use a Danish post nr or zip code, then set radius and ranking before pulling a fresh venue list.</p>
            </div>

            <div className="form-grid two-col venue-outreach-form-grid">
              <label>
                Danish post nr / zip code
                <input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="e.g. 2200" inputMode="numeric" className="queue-input" />
              </label>
              <label>
                Custom radius (km, up to 60)
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={radiusKm}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    const normalized = Number.isFinite(value) ? value : 1
                    setRadiusKm(Math.max(1, Math.min(60, normalized)))
                  }}
                  className="queue-input"
                />
              </label>
            </div>

            <div className="venue-choice-group" aria-label="Radius quick choices">
              <div className="venue-choice-group-head">
                <h4>Radius quick pick (up to 60 km)</h4>
                <span>{radiusKm} km selected</span>
              </div>
              <div className="venue-choice-pills">
                {SEARCH_RADIUS_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`venue-choice-pill ${radiusKm === option ? 'is-active' : ''}`}
                    onClick={() => setRadiusKm(option)}
                  >
                    {option} km
                  </button>
                ))}
              </div>
            </div>

            <div className="venue-choice-group" aria-label="Venue sort choices">
              <div className="venue-choice-group-head">
                <h4>Sort venues by</h4>
                <span>{SORT_MODE_OPTIONS.find((option) => option.value === sortMode)?.label}</span>
              </div>
              <div className="venue-choice-grid venue-choice-grid-compact">
                {SORT_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`venue-choice-card ${sortMode === option.value ? 'is-active' : ''}`}
                    onClick={() => setSortMode(option.value)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
              </div>
            </details>
          </section>

          <section className="venue-outreach-control-card venue-outreach-major-card" aria-label="Campaign settings" id="outreach-campaign">
            <details className="venue-outreach-collapsible" {...(!isMobileViewport ? { open: true } : {})}>
              <summary className="venue-outreach-collapsible-summary">Campaign Setup</summary>
              <div className="venue-outreach-collapsible-body">
            <div className="venue-outreach-section-lead">
              <span className="venue-outreach-section-tag">Campaign setup</span>
              <h3>Message and sender details</h3>
              <p>Choose the angle, define the sender, and prepare the outreach copy.</p>
            </div>

            <div className="form-grid two-col venue-outreach-form-grid">
              <label>
                Campaign name
                <input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} className="queue-input" />
              </label>
              <label>
                Your name
                <input value={senderName} onChange={(event) => setSenderName(event.target.value)} className="queue-input" />
              </label>
              <label className="venue-outreach-form-span-full">
                Reply-to email
                <input type="email" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} placeholder="harald@the-human-jukebox.org" className="queue-input" />
              </label>
            </div>

            <div className="venue-choice-group" aria-label="Composer mode choices">
              <div className="venue-choice-group-head">
                <h4>How do you want to write the email?</h4>
                <span>{COMPOSER_MODE_OPTIONS.find((option) => option.value === composerMode)?.label}</span>
              </div>
              <div className="venue-choice-grid venue-choice-grid-compact">
                {COMPOSER_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`venue-choice-card ${composerMode === option.value ? 'is-active' : ''}`}
                    onClick={() => setComposerMode(option.value)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="venue-choice-group" aria-label="Template choices">
              <div className="venue-choice-group-head">
                <h4>Template mode</h4>
                <button
                  type="button"
                  className="secondary-button venue-inline-action"
                  onClick={applyTemplateToComposer}
                  disabled={composerMode === 'manual' || templateMode === 'auto' || templateMode === 'custom'}
                >
                  Load template copy
                </button>
              </div>
              <div className="venue-choice-grid">
                {TEMPLATE_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`venue-choice-card ${templateMode === option.value ? 'is-active' : ''}`}
                    onClick={() => setTemplateMode(option.value)}
                    disabled={composerMode === 'manual'}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {composerMode === 'guided' ? (
              <section className="queue-panel venue-outreach-major-card" aria-label="Pub sales pitch form" id="outreach-pub-sales">
                <details className="venue-outreach-collapsible" {...(!isMobileViewport ? { open: true } : {})}>
                  <summary className="venue-outreach-collapsible-summary">Pub Sales Form</summary>
                  <div className="venue-outreach-collapsible-body">
                <div className="panel-head">
                  <h2>Pub Sales Form</h2>
                  <span className="meta-badge">Owner-focused pitch</span>
                </div>
                <div className="form-grid two-col venue-outreach-form-grid">
                  <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                    Opening hook (business result first)
                    <textarea
                      value={pubOpeningHook}
                      onChange={(event) => setPubOpeningHook(event.target.value)}
                      className="queue-input"
                      rows={2}
                    />
                  </label>
                  <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                    Why you (one-person host + performer)
                    <textarea
                      value={pubOnePersonLine}
                      onChange={(event) => setPubOnePersonLine(event.target.value)}
                      className="queue-input"
                      rows={2}
                    />
                  </label>
                  <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                    Your app advantage (the ace up your sleeve)
                    <textarea
                      value={pubAppEdgeLine}
                      onChange={(event) => setPubAppEdgeLine(event.target.value)}
                      className="queue-input"
                      rows={2}
                    />
                  </label>
                  <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                    Call to action
                    <textarea
                      value={pubCtaLine}
                      onChange={(event) => setPubCtaLine(event.target.value)}
                      className="queue-input"
                      rows={2}
                    />
                  </label>
                </div>
                <div className="hero-actions no-margin-bottom">
                  <button type="button" className="primary-button" onClick={applyPubSalesForm}>
                    Apply To Guided Pub Email
                  </button>
                </div>
                  </div>
                </details>
              </section>
            ) : null}

            {composerMode === 'manual' ? (
              <div className="form-grid two-col venue-outreach-form-grid">
                <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                  Email subject
                  <input
                    value={manualSubject}
                    onChange={(event) => setManualSubject(event.target.value)}
                    className="queue-input"
                    placeholder="Write the subject line venues should receive"
                  />
                </label>
                <label>
                  Save current draft as template
                  <input
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    className="queue-input"
                    placeholder="e.g. Warm intro for pubs"
                  />
                </label>
                <div className="venue-actions-end hero-actions no-margin-bottom">
                  <button type="button" className="secondary-button" onClick={saveCurrentTemplate}>
                    Save Template
                  </button>
                </div>
              </div>
            ) : null}

            <label className="venue-outreach-composer-field">
              {composerMode === 'manual' ? 'Email message' : 'Concept message'}
              <textarea value={conceptText} onChange={(event) => setConceptText(event.target.value)} className="queue-input" rows={7} />
            </label>
            <p className="subcopy no-margin-bottom">
              {composerMode === 'manual'
                ? 'Manual mode sends the subject and email text exactly as you write them.'
                : 'Guided mode keeps the existing assisted outreach flow and adjusts subjects per venue.'}
            </p>

            {composerMode === 'manual' ? (
              <section className="queue-panel" aria-label="Saved templates">
                <div className="panel-head">
                  <h2>Saved Templates</h2>
                  <span className="meta-badge">{savedTemplates.length}</span>
                </div>
                {savedTemplates.length === 0 ? (
                  <p className="subcopy no-margin-bottom">Save a manual draft once and reuse it later.</p>
                ) : (
                  <ul className="gig-management-list venue-outreach-list">
                    {savedTemplates.map((template) => (
                      <li key={template.id} className="gig-management-entry venue-outreach-item">
                        <div className="gig-management-main">
                          <div className="gig-management-title-row">
                            <p className="gig-management-title">{template.name}</p>
                            <span className="meta-badge">{new Date(template.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="gig-management-meta">{template.subject}</p>
                          <div className="hero-actions venue-link-row">
                            <button type="button" className="secondary-button" onClick={() => loadSavedTemplate(template)}>Load</button>
                            <button type="button" className="secondary-button" onClick={() => deleteSavedTemplate(template.id)}>Delete</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <section className="queue-panel venue-outreach-major-card" aria-label="Live email preview" id="outreach-preview">
              <details className="venue-outreach-collapsible" {...(!isMobileViewport ? { open: true } : {})}>
                <summary className="venue-outreach-collapsible-summary">Live Preview</summary>
                <div className="venue-outreach-collapsible-body">
              <div className="panel-head">
                <h2>Live Preview</h2>
                <span className="meta-badge">{previewVenue ? previewVenue.name : 'No venue yet'}</span>
              </div>
              {venues.length > 0 ? (
                <label className="venue-outreach-composer-field">
                  Preview as venue
                  <select value={previewVenue?.id ?? ''} onChange={(event) => setPreviewVenueId(event.target.value)} className="queue-input">
                    {sortedVenues.map((venue) => (
                      <option key={venue.id} value={venue.id}>{venue.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {previewDraft && previewVenue ? (
                <div className="form-grid two-col venue-outreach-form-grid">
                  <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                    Subject preview
                    <input value={previewDraft.subject} readOnly className="queue-input" />
                  </label>
                  <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                    Body preview
                    <textarea value={previewDraft.messageText} readOnly className="queue-input" rows={8} />
                  </label>
                </div>
              ) : (
                <p className="subcopy no-margin-bottom">Pick a venue or run a search to preview the final email.</p>
              )}
                </div>
              </details>
            </section>
              </div>
            </details>
          </section>

          <section className="venue-outreach-action-strip" aria-label="Search and send actions">
            <button type="button" className="venue-action-card venue-action-card-search" onClick={() => void runVenueSearch()} disabled={searching || Boolean(sendingMode)}>
              <span className="venue-action-card-title">{searching ? 'Searching…' : 'Find Nearby Venues'}</span>
              <span className="venue-action-card-copy">Refresh the list around {locationQuery} with the current filters.</span>
            </button>
            <button type="button" className="venue-action-card venue-action-card-secondary" onClick={() => void runSendTestEmail()} disabled={searching || Boolean(sendingMode)}>
              <span className="venue-action-card-title">{sendingMode === 'concept' ? 'Sending Test…' : 'Send Test To Myself'}</span>
              <span className="venue-action-card-copy">Send the current preview draft to your own reply-to email before contacting venues.</span>
            </button>
            <button type="button" className="venue-action-card venue-action-card-primary" onClick={() => void runSend('concept')} disabled={searching || Boolean(sendingMode)}>
              <span className="venue-action-card-title">
                {sendingMode === 'concept'
                  ? 'Sending…'
                  : composerMode === 'manual'
                  ? `Send Custom Email (${selectedCount})`
                  : `Send Concept (${selectedCount})`}
              </span>
              <span className="venue-action-card-copy">
                {composerMode === 'manual'
                  ? 'Send your own subject and message to the selected venues.'
                  : 'Send the selected concept email to chosen venues.'}
              </span>
            </button>
            {composerMode === 'guided' ? (
              <button type="button" className="venue-action-card venue-action-card-secondary" onClick={() => void runSend('offer')} disabled={searching || Boolean(sendingMode)}>
                <span className="venue-action-card-title">{sendingMode === 'offer' ? 'Sending Offer…' : `Send Offer Package (${selectedCount})`}</span>
                <span className="venue-action-card-copy">Use the more commercial package pitch when the venue is warm.</span>
              </button>
            ) : null}
            <button type="button" className="venue-action-card venue-action-card-muted" onClick={toggleSelectAll} disabled={!venues.length || searching || Boolean(sendingMode)}>
              <span className="venue-action-card-title">Toggle Select All</span>
              <span className="venue-action-card-copy">Quickly include or clear every result in the current list.</span>
            </button>
          </section>
        </div>

        {centerInfo ? (
          <div>
            <p className="subcopy">Search provider: {centerInfo.provider}</p>
            <p className="subcopy">Search center: {centerInfo.address}</p>
          </div>
        ) : null}
        {searchError ? <p className="error-text">{searchError}</p> : null}
        {sendError ? <p className="error-text">{sendError}</p> : null}
        {statusText ? <p className="subcopy">{statusText}</p> : null}
      </section>

      <section className="queue-panel venue-outreach-analytics-panel venue-outreach-major-card" aria-label="Pipeline and analytics" id="outreach-pipeline">
        <details className="venue-outreach-collapsible" {...(!isMobileViewport ? { open: true } : {})}>
          <summary className="venue-outreach-collapsible-summary">Pipeline</summary>
          <div className="venue-outreach-collapsible-body">
        <div className="panel-head">
          <h2>Pipeline & Analytics</h2>
        </div>
        <div className="hero-actions venue-stage-row">
          {STAGE_ORDER.map((stage) => (
            <span key={stage} className="meta-badge">{STAGE_LABELS[stage]}: {Object.values(stageMap).filter((value) => value === stage).length}</span>
          ))}
        </div>
        <p className="subcopy">
          Sent: {analytics.sentCount} | Failed: {analytics.failedCount} | Success rate: {analytics.successRate}% | Replies+: {analytics.replyStages} | Confirmed: {analytics.confirmed} | Conversion: {analytics.conversionRate}%
        </p>
          </div>
        </details>
      </section>

      <section className="queue-panel venue-outreach-tasks-panel venue-outreach-major-card" aria-label="Follow-up tasks" id="outreach-followups">
        <details className="venue-outreach-collapsible" {...(!isMobileViewport ? { open: true } : {})}>
          <summary className="venue-outreach-collapsible-summary">Follow-ups</summary>
          <div className="venue-outreach-collapsible-body">
        <div className="panel-head">
          <h2>Follow-up Tasks</h2>
          <span className="meta-badge">{pendingTasks.length} open</span>
        </div>

        {pendingTasks.length === 0 ? (
          <p className="subcopy no-margin-bottom">No pending follow-ups.</p>
        ) : (
          <ul className="gig-management-list venue-outreach-list">
            {pendingTasks.slice(0, 60).map((task) => {
              const overdue = new Date(task.dueAt).getTime() < Date.now()
              return (
                <li key={task.id} className="gig-management-entry venue-outreach-item">
                  <div className="gig-management-main">
                    <div className="gig-management-title-row">
                      <p className="gig-management-title">{task.venueName}</p>
                      <span className="meta-badge">{task.type === 'follow-up-3d' ? '3-day follow-up' : '7-day follow-up'}</span>
                      {overdue ? <span className="meta-badge">Overdue</span> : null}
                    </div>
                    <p className="gig-management-meta">Due: {new Date(task.dueAt).toLocaleString()}</p>
                    <div className="hero-actions venue-link-row">
                      <a className="secondary-button" href={`mailto:${encodeURIComponent(task.email)}`}>Email</a>
                      <button type="button" className="secondary-button" onClick={() => markTaskDone(task.id, true)}>Mark Done</button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
          </div>
        </details>
      </section>

      <section className="queue-panel venue-outreach-calendar-panel venue-outreach-major-card" aria-label="Availability and bookings calendar" id="outreach-calendar">
        <details className="venue-outreach-collapsible" {...(!isMobileViewport ? { open: true } : {})}>
          <summary className="venue-outreach-collapsible-summary">Availability Calendar</summary>
          <div className="venue-outreach-collapsible-body">
            <div className="panel-head">
              <h2>Availability & Bookings</h2>
              <span className="meta-badge">Booked: {upcomingBooked.length} · Free: {upcomingFree.length} · 30d util: {calendarInsights.utilization}%</span>
            </div>

            <p className="subcopy">Mark days you are free, add booked gigs with key details, and keep the schedule ready for your AI manager.</p>

            <div className="venue-calendar-grid">
              <section className="venue-calendar-month" aria-label="Calendar month view">
                <div className="venue-calendar-month-head">
                  <div className="venue-calendar-month-picker">
                    <span>Month</span>
                    <strong>{formatMonthIsoLabel(calendarMonth)}</strong>
                  </div>
                  <div className="hero-actions venue-link-row no-margin-bottom">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setCalendarMonth((current) => shiftMonthIso(current, -1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setCalendarMonth((current) => shiftMonthIso(current, 1))}
                    >
                      Next
                    </button>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const today = new Date()
                      setCalendarMonth(toMonthIso(today))
                      setSelectedCalendarDate(toDayIso(today))
                    }}
                  >
                    Today
                  </button>
                </div>

                <div className="venue-calendar-weekdays" aria-hidden="true">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName) => (
                    <span key={dayName}>{dayName}</span>
                  ))}
                </div>

                <div className="venue-calendar-days">
                  {calendarMonthDays.map((day) => {
                    const entry = calendarEntryByDate.get(day.dateIso)
                    const isSelected = selectedCalendarDate === day.dateIso
                    const isToday = day.dateIso === toDayIso(new Date())
                    const stateClass = entry
                      ? entry.status === 'booked'
                        ? 'is-booked'
                        : 'is-free'
                      : 'is-empty'

                    return (
                      <button
                        key={day.dateIso}
                        type="button"
                        className={`venue-calendar-day ${stateClass} ${day.inMonth ? 'in-month' : 'outside-month'} ${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`}
                        onClick={() => setSelectedCalendarDate(day.dateIso)}
                      >
                        <span className="venue-calendar-day-number">{day.dayOfMonth}</span>
                        {entry ? (
                          <span className="venue-calendar-day-label">{entry.status === 'booked' ? 'Booked' : 'Free'}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="venue-calendar-editor" aria-label="Selected date details">
                <h3>Selected day: {selectedCalendarDate}</h3>

                <div className="venue-choice-group" aria-label="Day status choice">
                  <div className="venue-choice-group-head">
                    <h4>Status</h4>
                  </div>
                  <div className="venue-choice-pills">
                    <button
                      type="button"
                      className={`venue-choice-pill ${calendarDraft.status === 'free' ? 'is-active' : ''}`}
                      onClick={() => setCalendarDraft((current) => ({ ...current, status: 'free' }))}
                    >
                      Free
                    </button>
                    <button
                      type="button"
                      className={`venue-choice-pill ${calendarDraft.status === 'booked' ? 'is-active' : ''}`}
                      onClick={() => setCalendarDraft((current) => ({ ...current, status: 'booked' }))}
                    >
                      Booked
                    </button>
                  </div>
                </div>

                <div className="form-grid two-col venue-outreach-form-grid">
                  <label>
                    Venue / Event name
                    <input
                      value={calendarDraft.venueName}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, venueName: event.target.value }))}
                      className="queue-input"
                      placeholder="Den Engelske Pub"
                    />
                  </label>
                  <label>
                    City / Area
                    <input
                      value={calendarDraft.city}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, city: event.target.value }))}
                      className="queue-input"
                      placeholder="Kolding"
                    />
                  </label>
                  <label>
                    Contact
                    <input
                      value={calendarDraft.contact}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, contact: event.target.value }))}
                      className="queue-input"
                      placeholder="booking@venue.com / +45..."
                    />
                  </label>
                  <label>
                    Fee / Deal
                    <input
                      value={calendarDraft.fee}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, fee: event.target.value }))}
                      className="queue-input"
                      placeholder="DKK 4,500 + bar bonus"
                    />
                  </label>
                  {calendarDraft.status === 'booked' ? (
                    <>
                      <label>
                        Payment Status
                        <select
                          value={calendarDraft.paymentStatus}
                          onChange={(event) => setCalendarDraft((current) => ({
                            ...current,
                            paymentStatus: event.target.value === 'paid' || event.target.value === 'partial' ? event.target.value : 'unpaid',
                          }))}
                          className="queue-input"
                        >
                          <option value="unpaid">Unpaid</option>
                          <option value="partial">Partial</option>
                          <option value="paid">Paid</option>
                        </select>
                      </label>
                      <label>
                        Payment Amount
                        <input
                          value={calendarDraft.paymentAmount}
                          onChange={(event) => setCalendarDraft((current) => ({ ...current, paymentAmount: event.target.value }))}
                          className="queue-input"
                          placeholder="DKK 4,500"
                        />
                        <div className="venue-choice-pills" aria-label="Payment amount quick presets">
                          {PAYMENT_AMOUNT_PRESET_OPTIONS.map((amount) => {
                            const label = formatDkkInputPreset(amount)
                            const isActive = calendarDraft.paymentAmount.trim() === label

                            return (
                              <button
                                key={amount}
                                type="button"
                                className={`venue-choice-pill ${isActive ? 'is-active' : ''}`}
                                onClick={() => setCalendarDraft((current) => ({ ...current, paymentAmount: label }))}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      </label>
                      <label>
                        Paid Date
                        <input
                          type="date"
                          value={calendarDraft.paidAt}
                          onChange={(event) => setCalendarDraft((current) => ({ ...current, paidAt: event.target.value }))}
                          className="queue-input"
                        />
                      </label>
                    </>
                  ) : null}
                  <label>
                    Source
                    <select
                      value={calendarDraft.source}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, source: event.target.value === 'ai-manager' ? 'ai-manager' : 'manual' }))}
                      className="queue-input"
                    >
                      <option value="manual">Manual</option>
                      <option value="ai-manager">AI manager</option>
                    </select>
                  </label>
                  <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                    Notes
                    <textarea
                      value={calendarDraft.notes}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, notes: event.target.value }))}
                      className="queue-input"
                      rows={4}
                      placeholder="Important notes, setup needs, timings, who confirmed, etc."
                    />
                  </label>
                </div>

                <div className="hero-actions venue-link-row">
                  <button type="button" className="primary-button" onClick={saveCalendarDay}>Save Day</button>
                  <button type="button" className="secondary-button" onClick={clearCalendarDay} disabled={!selectedCalendarEntry}>Clear Day</button>
                </div>
              </section>
            </div>

            <div className="venue-calendar-lists">
              <article className="venue-calendar-list-card">
                <h3>Calendar Power Tools</h3>
                <p className="subcopy">Use quick actions to plan availability faster and keep your booking ops tidy.</p>
                <div className="hero-actions venue-link-row">
                  <button type="button" className="secondary-button" onClick={markWeekendsFree}>Mark Fri/Sat Free (8 weeks)</button>
                  <button type="button" className="secondary-button" onClick={clearPastFreeDates}>Clear Past Free Dates</button>
                  <button type="button" className="secondary-button" onClick={exportCalendarCsv}>Export CSV</button>
                </div>
                <p className="subcopy no-margin-bottom">Next 30 days: {calendarInsights.bookedNextThirty} booked · {calendarInsights.freeNextThirty} free · {calendarInsights.totalTagged} tagged days.</p>
              </article>

              <article className="venue-calendar-list-card venue-payment-card">
                <h3>Payment Summary (Upcoming)</h3>
                {paymentInsights.upcomingBookedCount === 0 ? (
                  <p className="subcopy no-margin-bottom">No upcoming booked gigs to track yet.</p>
                ) : (
                  <>
                    <div className="venue-payment-controls">
                      <label>
                        Tax Percent
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          value={taxPercent}
                          onChange={(event) => setTaxPercent(normalizeTaxPercent(event.target.value))}
                          className="queue-input"
                          placeholder="0"
                        />
                      </label>
                      <div className="venue-choice-pills" aria-label="Tax quick presets">
                        {TAX_PRESET_OPTIONS.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={`venue-choice-pill ${Math.abs(taxPercent - value) < 0.01 ? 'is-active' : ''}`}
                            onClick={() => setTaxPercent(value)}
                          >
                            {value}%
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="venue-payment-metric-grid" aria-label="Payment financial snapshot">
                      <div className="venue-payment-metric">
                        <span className="venue-payment-metric-label">Outstanding</span>
                        <strong className="venue-payment-metric-value">{formatDkk(paymentInsights.outstandingAmount)}</strong>
                      </div>
                      <div className="venue-payment-metric">
                        <span className="venue-payment-metric-label">Paid</span>
                        <strong className="venue-payment-metric-value">{formatDkk(paymentInsights.paidAmount)}</strong>
                      </div>
                      <div className="venue-payment-metric">
                        <span className="venue-payment-metric-label">Tax On Paid</span>
                        <strong className="venue-payment-metric-value">{formatDkk(paymentInsights.estimatedTaxOnPaid)}</strong>
                      </div>
                      <div className="venue-payment-metric">
                        <span className="venue-payment-metric-label">Net After Tax</span>
                        <strong className="venue-payment-metric-value">{formatDkk(paymentInsights.netPaidAfterTax)}</strong>
                      </div>
                    </div>

                    <div className="venue-payment-progress" aria-label="Payment coverage">
                      <progress className="venue-payment-progress-meter" value={paymentInsights.paidCoveragePercent} max={100} />
                    </div>

                    <p className="subcopy">Coverage: {paymentInsights.paidCoveragePercent}% paid · Outstanding gigs: {paymentInsights.outstandingGigs} · Paid gigs: {paymentInsights.paidCount}</p>
                    <p className="subcopy venue-payment-trend">Projected upcoming outcome ({taxPercent}% tax): {formatDkk(paymentInsights.projectedNetAfterTax)} net from {formatDkk(paymentInsights.knownTotalAmount)} gross</p>
                    <p className="subcopy">{formatMonthIsoLabel(calendarMonth)}: {formatDkk(monthlyPaymentInsights.paidAmount)} paid · {formatDkk(monthlyPaymentInsights.outstandingAmount)} outstanding · {formatDkk(monthlyPaymentInsights.netPaidAfterTax)} net after tax</p>
                    <p className="subcopy">Projected month outcome ({taxPercent}% tax): {formatDkk(monthlyPaymentInsights.projectedNetAfterTax)} net from {formatDkk(monthlyPaymentInsights.knownTotalAmount)} gross</p>
                    <p className="subcopy venue-payment-trend">MoM net change: {monthNetDelta >= 0 ? '+' : '-'}{formatDkk(Math.abs(monthNetDelta))} vs {formatMonthIsoLabel(shiftMonthIso(calendarMonth, -1))}</p>
                    <p className="subcopy">Month gigs: {monthlyPaymentInsights.bookedCount} booked · Estimated tax this month: {formatDkk(monthlyPaymentInsights.estimatedTaxOnPaid)}</p>
                    <p className="subcopy no-margin-bottom">Status split: {paymentInsights.unpaidCount} unpaid · {paymentInsights.partialCount} partial · {paymentInsights.paidCount} paid</p>
                    {paymentInsights.unknownOutstandingCount > 0 ? (
                      <p className="subcopy no-margin-bottom">{paymentInsights.unknownOutstandingCount} outstanding gig(s) have no readable numeric amount yet.</p>
                    ) : null}
                    {monthlyPaymentInsights.unknownOutstandingCount > 0 ? (
                      <p className="subcopy no-margin-bottom">{monthlyPaymentInsights.unknownOutstandingCount} month gig(s) have no readable numeric amount yet.</p>
                    ) : null}
                  </>
                )}
              </article>

              <article className="venue-calendar-list-card">
                <h3>Upcoming Booked Dates</h3>
                {upcomingBooked.length === 0 ? (
                  <>
                    <p className="subcopy no-margin-bottom">No booked dates yet.</p>
                    {pastBookedCount > 0 ? <p className="subcopy no-margin-bottom">You have {pastBookedCount} booked date(s) in the past. Add or update future dates to show them here.</p> : null}
                  </>
                ) : (
                  <ul className="gig-management-list venue-outreach-list">
                    {upcomingBooked.map((entry) => (
                      <li key={entry.id} className="gig-management-entry venue-outreach-item">
                        <div className="gig-management-main">
                          <div className="gig-management-title-row">
                            <p className="gig-management-title">{entry.date} · {entry.venueName || 'Booked gig'}</p>
                            <span className="meta-badge">{entry.city || 'No city'}</span>
                            <span className="meta-badge">{entry.paymentStatus === 'paid' ? 'Paid' : entry.paymentStatus === 'partial' ? 'Part-paid' : 'Unpaid'}</span>
                          </div>
                          <p className="gig-management-meta">Contact: {entry.contact || 'N/A'} · Fee: {entry.fee || 'N/A'} · Payment: {entry.paymentAmount || 'N/A'}{entry.paidAt ? ` · Paid on ${entry.paidAt}` : ''}</p>
                          {entry.notes ? <p className="gig-management-meta">{entry.notes}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="venue-calendar-list-card">
                <h3>Upcoming Free Dates</h3>
                {upcomingFree.length === 0 ? <p className="subcopy no-margin-bottom">No free dates marked yet.</p> : (
                  <ul className="gig-management-list venue-outreach-list">
                    {upcomingFree.map((entry) => (
                      <li key={entry.id} className="gig-management-entry venue-outreach-item">
                        <div className="gig-management-main">
                          <div className="gig-management-title-row">
                            <p className="gig-management-title">{entry.date}</p>
                            <span className="meta-badge">Free</span>
                          </div>
                          {entry.notes ? <p className="gig-management-meta">{entry.notes}</p> : <p className="gig-management-meta">Ready to book.</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          </div>
        </details>
      </section>

      <section className="queue-panel venue-outreach-venues-panel venue-outreach-major-card" aria-label="Nearby venues" id="outreach-venues">
        <div className="panel-head">
          <h2>Nearby Venues</h2>
          <span className="meta-badge">{venues.length} found</span>
        </div>

        {sortedVenues.length === 0 ? (
          <p className="subcopy no-margin-bottom">Run a search to load nearby pubs and places.</p>
        ) : (
          <ul className="gig-management-list venue-outreach-list">
            {sortedVenues.map((venue) => {
              const mapUrl = `https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lon}#map=15/${venue.lat}/${venue.lon}`
              const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lon}`
              return (
                <li key={venue.id} className="gig-management-entry venue-outreach-item venue-outreach-venue-item">
                  <div className="gig-management-main">
                    <div className="gig-management-title-row">
                      <label className="queue-toggle queue-toggle-compact">
                        <input
                          type="checkbox"
                          checked={venue.selected}
                          onChange={(event) => updateVenue(venue.id, { selected: event.target.checked })}
                        />
                        <span className="gig-management-title">{venue.name}</span>
                      </label>
                      <span className="meta-badge">{venue.type}</span>
                      <span className="meta-badge">Score {venue.leadScore}</span>
                      <span className="meta-badge">{venue.distanceKm.toFixed(1)} km</span>
                      <span className="meta-badge">~{estimateDriveTimeMinutes(venue.distanceKm)} min drive</span>
                    </div>
                    <p className="gig-management-meta">{formatVenueAddress(venue)}</p>
                    <p className="gig-management-meta">
                      {venue.website ? <a href={venue.website} target="_blank" rel="noreferrer">Website</a> : 'No website listed'}
                      {venue.phone ? ` · ${venue.phone}` : ''}
                    </p>

                    <div className="form-grid two-col">
                      <label>
                        Contact email
                        <input
                          type="email"
                          value={venue.contactEmail}
                          onChange={(event) => updateVenue(venue.id, { contactEmail: event.target.value })}
                          placeholder="booking@venue.com"
                          className="queue-input"
                        />
                      </label>
                      <label>
                        Pipeline stage
                        <select
                          value={venue.stage}
                          onChange={(event) => setVenueStage(venue, event.target.value as PipelineStage)}
                          className="queue-input"
                        >
                          {STAGE_ORDER.map((stage) => (
                            <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Note (optional)
                        <input
                          value={venue.notes}
                          onChange={(event) => updateVenue(venue.id, { notes: event.target.value })}
                          placeholder="Best day to call"
                          className="queue-input"
                        />
                      </label>
                    </div>

                    <div className="hero-actions venue-link-row">
                      <label className="queue-toggle queue-toggle-compact">
                        <input
                          type="checkbox"
                          checked={venue.useCustomContent}
                          onChange={(event) => updateVenue(venue.id, { useCustomContent: event.target.checked })}
                        />
                        <span>Custom email for this venue</span>
                      </label>
                    </div>

                    {venue.useCustomContent ? (
                      <div className="form-grid two-col">
                        <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                          Custom subject
                          <input
                            value={venue.customSubject}
                            onChange={(event) => updateVenue(venue.id, { customSubject: event.target.value })}
                            placeholder="Override the subject for this venue"
                            className="queue-input"
                          />
                        </label>
                        <label className="venue-outreach-form-span-full venue-outreach-composer-field">
                          Custom message
                          <textarea
                            value={venue.customMessage}
                            onChange={(event) => updateVenue(venue.id, { customMessage: event.target.value })}
                            placeholder="Write a venue-specific variation here"
                            className="queue-input"
                            rows={6}
                          />
                        </label>
                      </div>
                    ) : null}

                    <div className="hero-actions venue-link-row">
                      <button type="button" className="secondary-button" onClick={() => quickBookVenueOnSelectedDate(venue)}>Book Selected Day</button>
                      <a className="secondary-button" href={mapUrl} target="_blank" rel="noreferrer">Map</a>
                      <a className="secondary-button" href={directionsUrl} target="_blank" rel="noreferrer">Route</a>
                      {venue.phone ? <a className="secondary-button" href={`tel:${venue.phone}`}>Call</a> : null}
                      {venue.contactEmail ? <a className="secondary-button" href={`mailto:${encodeURIComponent(venue.contactEmail)}`}>Email</a> : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="queue-panel venue-outreach-log-panel venue-outreach-major-card" aria-label="Outreach log" id="outreach-log">
        <details className="venue-outreach-collapsible" {...(!isMobileViewport ? { open: true } : {})}>
          <summary className="venue-outreach-collapsible-summary">Outreach Log</summary>
          <div className="venue-outreach-collapsible-body">
        <div className="panel-head">
          <h2>Outreach Log</h2>
          <div className="hero-actions no-margin-bottom">
            <button type="button" className="secondary-button" onClick={() => withSavedLog([])} disabled={!logEntries.length}>
              Clear Log
            </button>
          </div>
        </div>

        {logEntries.length === 0 ? (
          <p className="subcopy no-margin-bottom">No outreach sent yet.</p>
        ) : (
          <ul className="gig-management-list venue-outreach-list">
            {logEntries.slice(0, 120).map((entry) => (
              <li key={entry.id} className="gig-management-entry venue-outreach-item">
                <div className="gig-management-main">
                  <div className="gig-management-title-row">
                    <p className="gig-management-title">{entry.venueName}</p>
                    <span className="meta-badge">{entry.status === 'sent' ? 'Sent' : 'Failed'}</span>
                    <span className="meta-badge">{entry.mode === 'offer' ? 'Offer' : 'Concept'}</span>
                    <span className="meta-badge">{entry.campaign}</span>
                  </div>
                  <p className="gig-management-meta">{entry.email}</p>
                  <p className="gig-management-meta">{new Date(entry.timestamp).toLocaleString()}</p>
                  {entry.error ? <p className="error-text">{entry.error}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
          </div>
        </details>
      </section>

      <nav className="venue-outreach-mobile-nav" aria-label="Mobile outreach shortcuts">
        <button type="button" className="venue-outreach-mobile-nav-button" onClick={() => scrollToSection('outreach-search-settings')}>Search</button>
        <button type="button" className="venue-outreach-mobile-nav-button" onClick={() => scrollToSection('outreach-campaign')}>Campaign</button>
        <button type="button" className="venue-outreach-mobile-nav-button" onClick={() => scrollToSection('outreach-calendar')}>Calendar</button>
        <button type="button" className="venue-outreach-mobile-nav-button" onClick={() => scrollToSection('outreach-preview')}>Preview</button>
        <button type="button" className="venue-outreach-mobile-nav-button" onClick={openAiManager}>AI Manager</button>
      </nav>
    </section>
  )
}

export default VenueOutreachPage
