import { useEffect, useMemo, useState } from 'react'
import { AiManagerPanel } from '../components/AiManagerPanel'
import '../venue-outreach.css'

type PipelineStage = 'new' | 'contacted' | 'replied' | 'negotiating' | 'confirmed' | 'lost'
type SortMode = 'score' | 'distance' | 'name'
type TemplateMode = 'auto' | 'pub' | 'restaurant' | 'hotel' | 'corporate' | 'custom'
type SendMode = 'concept' | 'offer'

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

const OUTREACH_LOG_STORAGE_KEY = 'human-jukebox-outreach-log'
const OUTREACH_STAGE_STORAGE_KEY = 'human-jukebox-outreach-stage-map'
const OUTREACH_TASKS_STORAGE_KEY = 'human-jukebox-outreach-tasks'
const OUTREACH_SESSION_STORAGE_KEY = 'human-jukebox-outreach-session'

type OutreachSessionState = {
  locationQuery: string
  radiusKm: number
  sortMode: SortMode
  templateMode: TemplateMode
  campaignName: string
  conceptText: string
  senderName: string
  senderEmail: string
  venues: Venue[]
  centerInfo: { label: string; address: string; provider: string; lat: number; lon: number } | null
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
      campaignName: typeof parsed.campaignName === 'string' ? parsed.campaignName : 'Spring Outreach',
      conceptText: typeof parsed.conceptText === 'string' ? parsed.conceptText : '',
      senderName: typeof parsed.senderName === 'string' ? parsed.senderName : 'Harald',
      senderEmail: typeof parsed.senderEmail === 'string' ? parsed.senderEmail : '',
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

const TEMPLATE_TEXT: Record<Exclude<TemplateMode, 'auto' | 'custom'>, string> = {
  pub: 'We run an energetic live music and karaoke concept that keeps pub guests engaged all night with mobile song requests and live voting. We handle host flow, crowd energy, and smooth transitions.\n\nWould you be open to a test night at your pub?',
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

function VenueOutreachPage() {
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
  const [campaignName, setCampaignName] = useState(savedSession?.campaignName ?? 'Spring Outreach')
  const [conceptText, setConceptText] = useState(
    savedSession?.conceptText
    || 'We run a modern live music and karaoke concept where your guests can request songs live from their phones and vote in real time. We provide full host-led entertainment, energy, and a smooth setup for your venue.\n\nWould you be open to a test night or a recurring collaboration?',
  )
  const [senderName, setSenderName] = useState(savedSession?.senderName ?? 'Harald')
  const [senderEmail, setSenderEmail] = useState(savedSession?.senderEmail ?? '')
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const sessionState: OutreachSessionState = {
      locationQuery,
      radiusKm,
      sortMode,
      templateMode,
      campaignName,
      conceptText,
      senderName,
      senderEmail,
      venues,
      centerInfo,
    }

    window.localStorage.setItem(OUTREACH_SESSION_STORAGE_KEY, JSON.stringify(sessionState))
  }, [locationQuery, radiusKm, sortMode, templateMode, campaignName, conceptText, senderName, senderEmail, venues, centerInfo])

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

  const buildContactsPayload = (mode: SendMode, selectedVenues: Venue[]) => {
    return selectedVenues
      .map((venue) => {
        const email = venue.contactEmail.trim()

        if (!email) {
          return null
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

        const withVenueName = `${baseMessage}\n\nVenue: ${venue.name}`
        const messageText = mode === 'offer' ? buildOfferMessage(withVenueName) : withVenueName
        const subject = mode === 'offer'
          ? `Offer package for ${venue.name}`
          : `Live music concept for ${venue.name}`

        return {
          venueId: venue.id,
          venueName: venue.name,
          email,
          subject,
          messageText,
        }
      })
      .filter((contact): contact is { venueId: string; venueName: string; email: string; subject: string; messageText: string } => Boolean(contact))
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
          subject: mode === 'offer' ? 'Live offer package' : 'Live music concept',
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
            const venueListPanel = document.querySelector('.venue-outreach-venues-panel')
            if (venueListPanel) {
              venueListPanel.scrollIntoView({ behavior: 'smooth' })
            }
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

      <section className="queue-panel venue-outreach-campaign-panel">
        <div className="panel-head">
          <h2>Search & Campaign</h2>
        </div>
        <div className="venue-outreach-campaign-stack">
          <section className="venue-outreach-control-card" aria-label="Search settings">
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
          </section>

          <section className="venue-outreach-control-card" aria-label="Campaign settings">
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
                <input type="email" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} placeholder="you@example.com" className="queue-input" />
              </label>
            </div>

            <div className="venue-choice-group" aria-label="Template choices">
              <div className="venue-choice-group-head">
                <h4>Template mode</h4>
                <button
                  type="button"
                  className="secondary-button venue-inline-action"
                  onClick={applyTemplateToComposer}
                  disabled={templateMode === 'auto' || templateMode === 'custom'}
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
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="venue-outreach-composer-field">
              Concept message
              <textarea value={conceptText} onChange={(event) => setConceptText(event.target.value)} className="queue-input" rows={7} />
            </label>
          </section>

          <section className="venue-outreach-action-strip" aria-label="Search and send actions">
            <button type="button" className="venue-action-card venue-action-card-search" onClick={() => void runVenueSearch()} disabled={searching || Boolean(sendingMode)}>
              <span className="venue-action-card-title">{searching ? 'Searching…' : 'Find Nearby Venues'}</span>
              <span className="venue-action-card-copy">Refresh the list around {locationQuery} with the current filters.</span>
            </button>
            <button type="button" className="venue-action-card venue-action-card-primary" onClick={() => void runSend('concept')} disabled={searching || Boolean(sendingMode)}>
              <span className="venue-action-card-title">{sendingMode === 'concept' ? 'Sending…' : `Send Concept (${selectedCount})`}</span>
              <span className="venue-action-card-copy">Send the selected concept email to chosen venues.</span>
            </button>
            <button type="button" className="venue-action-card venue-action-card-secondary" onClick={() => void runSend('offer')} disabled={searching || Boolean(sendingMode)}>
              <span className="venue-action-card-title">{sendingMode === 'offer' ? 'Sending Offer…' : `Send Offer Package (${selectedCount})`}</span>
              <span className="venue-action-card-copy">Use the more commercial package pitch when the venue is warm.</span>
            </button>
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

      <section className="queue-panel venue-outreach-analytics-panel" aria-label="Pipeline and analytics">
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
      </section>

      <section className="queue-panel venue-outreach-tasks-panel" aria-label="Follow-up tasks">
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
      </section>

      <section className="queue-panel venue-outreach-venues-panel" aria-label="Nearby venues">
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

      <section className="queue-panel venue-outreach-log-panel" aria-label="Outreach log">
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
      </section>

      <AiManagerPanel
        pipeline={{
          analytics,
          pendingTasks,
          venues: sortedVenues,
        }}
      />
    </section>
  )
}

export default VenueOutreachPage
