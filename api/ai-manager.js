const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

const CORE_PROMPT = `You are the technical operations assistant for The Human Jukebox app - a live interactive music and karaoke entertainment system run by Harald.

Your job is to keep the app running smoothly, diagnose issues, and help Harald control and optimize the live experience.

Primary responsibilities:
- App health and diagnostics: monitor queue health, connection status, error patterns, and degradation signals.
- Live gig operations: assist with queue management, room state control, song flow, and real-time decisions.
- System reliability: identify error build-up, suggest fixes, and support recovery actions.
- Code management: commit improvements, track changes, and maintain code quality.

When giving advice:
- Prioritize the most actionable next step to improve app stability or control flow.
- Keep replies concise - 2-4 short paragraphs max.
- If app health shows degraded state, highlight that first before secondary suggestions.
- Focus on technical diagnostics and operational fixes, not administrative or booking tasks.
- Only include calendar info if Harald explicitly asks about dates or availability.

Guardrails:
- Never invent app metrics, queue state, or runtime facts - only use provided context.
- Keep humor light and occasional, focused on technical situations.
- Prefer safe actions first; treat destructive actions as high risk and explicit.
- Do not coach on email outreach, venue relationships, or booking strategy - Harald handles those.

Calendar operations (lower priority):
- Only include calendar actions if Harald explicitly asks to update dates/availability.
- Keep your normal human reply, then append exactly one final line if needed:
  CALENDAR_ACTIONS_JSON:[{"action":"upsert|delete","date":"YYYY-MM-DD","status":"free|booked","venueName":"","city":"","contact":"","fee":"","paymentStatus":"unpaid|partial|paid","paymentAmount":"","paidAt":"YYYY-MM-DD","notes":""}]
- Use action=delete with date only when removing a date.`

const APP_ACTIONS_PROMPT = `
App assist operations:
- If assist mode is enabled and Harald clearly asks you to control the app, include machine-readable actions.
- Keep your normal human reply, then append exactly one final line:
  APP_ACTIONS_JSON:[{"action":"navigate|open_health_check|reload_app|set_room_open|set_no_live_visibility|mark_played|skip_current_song|choose_gig|end_current_gig|commit_and_push","route":"","open":true,"visible":true,"gigName":"","commitMessage":""}]
- Only output actions that are strictly needed for the request.
- Prefer action=open_health_check when Harald asks to fix runtime/build-up errors.
- Use only these routes when action=navigate: /admin, /admin/gigs, /admin/gig-control, /admin/health-check, /admin/create-gig, /audience
- For commit_and_push action: use the commitMessage field. Generate conventional commit format if possible (e.g., "feat: description" or "fix: description").
- If assist mode is disabled or no app control is requested, do not include APP_ACTIONS_JSON.`

function normalizeCalendarText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function extractFirstJsonArray(text) {
  if (typeof text !== 'string') {
    return null
  }

  const start = text.indexOf('[')
  if (start === -1) {
    return null
  }

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '[') {
      depth += 1
    } else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

function normalizeParsedCalendarActions(parsed) {
  const list = Array.isArray(parsed) ? parsed : []

  return list
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const action = entry.action === 'delete' ? 'delete' : 'upsert'
      const date = normalizeCalendarText(entry.date)

      if (!isIsoDate(date)) {
        return null
      }

      const status = entry.status === 'booked' ? 'booked' : 'free'

      return {
        action,
        date,
        status,
        venueName: normalizeCalendarText(entry.venueName),
        city: normalizeCalendarText(entry.city),
        contact: normalizeCalendarText(entry.contact),
        fee: normalizeCalendarText(entry.fee),
        paymentStatus: normalizeCalendarText(entry.paymentStatus),
        paymentAmount: normalizeCalendarText(entry.paymentAmount),
        paidAt: normalizeCalendarText(entry.paidAt),
        notes: normalizeCalendarText(entry.notes),
      }
    })
    .filter(Boolean)
}

function parseCalendarActionsFromUserIntent(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return []
  }

  const dates = [...new Set(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])]
  if (dates.length === 0) {
    return []
  }

  const lower = text.toLowerCase()
  const action = /\b(delete|remove|clear|cancel)\b/.test(lower) ? 'delete' : 'upsert'
  const status = /\b(booked|book|event|gig|confirmed)\b/.test(lower) ? 'booked' : 'free'
  const venueMatch = text.match(/\b(?:at|@)\s+([^,\n]+)(?:,|$)/i)
  const venueName = normalizeCalendarText(venueMatch?.[1] || '')

  return dates.map((date) => ({
    action,
    date,
    status,
    venueName,
    city: '',
    contact: '',
    fee: '',
    paymentStatus: 'unpaid',
    paymentAmount: '',
    paidAt: '',
    notes: '',
  }))
}

function extractCalendarActions(reply) {
  if (typeof reply !== 'string') {
    return { cleanedReply: '', calendarActions: [] }
  }

  const markerMatch = reply.match(/CALENDAR_ACTIONS_JSON\s*:\s*([\s\S]*)$/i)
  const markerIndex = markerMatch?.index ?? -1

  if (markerIndex === -1 || !markerMatch) {
    return { cleanedReply: reply.trim(), calendarActions: [] }
  }

  const before = reply.slice(0, markerIndex).trim()
  const rawTail = markerMatch[1].trim()
  const normalizedTail = rawTail
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const arrayCandidate = extractFirstJsonArray(normalizedTail) || extractFirstJsonArray(rawTail)

  if (!arrayCandidate) {
    return { cleanedReply: before || reply.trim(), calendarActions: [] }
  }

  let parsed
  try {
    parsed = JSON.parse(arrayCandidate)
  } catch {
    return { cleanedReply: before || reply.trim(), calendarActions: [] }
  }

  const calendarActions = normalizeParsedCalendarActions(parsed)

  return {
    cleanedReply: before || 'Updated your calendar plan.',
    calendarActions,
  }
}

function normalizeParsedAppActions(parsed) {
  const list = Array.isArray(parsed) ? parsed : []
  const allowedRoutes = new Set(['/admin', '/admin/gigs', '/admin/gig-control', '/admin/health-check', '/admin/create-gig', '/audience'])

  return list
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const action = normalizeCalendarText(entry.action)

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
        return null
      }

      const route = normalizeCalendarText(entry.route)

      if (action === 'navigate' && !allowedRoutes.has(route)) {
        return null
      }

      return {
        action,
        route,
        open: Boolean(entry.open),
        visible: Boolean(entry.visible),
        gigName: normalizeCalendarText(entry.gigName),
        commitMessage: normalizeCalendarText(entry.commitMessage),
      }
    })
    .filter(Boolean)
}

function extractAppActions(reply) {
  if (typeof reply !== 'string') {
    return { cleanedReply: '', appActions: [] }
  }

  const markerMatch = reply.match(/APP_ACTIONS_JSON\s*:\s*([\s\S]*)$/i)
  const markerIndex = markerMatch?.index ?? -1

  if (markerIndex === -1 || !markerMatch) {
    return { cleanedReply: reply.trim(), appActions: [] }
  }

  const before = reply.slice(0, markerIndex).trim()
  const rawTail = markerMatch[1].trim()
  const normalizedTail = rawTail
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const arrayCandidate = extractFirstJsonArray(normalizedTail) || extractFirstJsonArray(rawTail)

  if (!arrayCandidate) {
    return { cleanedReply: before || reply.trim(), appActions: [] }
  }

  let parsed
  try {
    parsed = JSON.parse(arrayCandidate)
  } catch {
    return { cleanedReply: before || reply.trim(), appActions: [] }
  }

  const appActions = normalizeParsedAppActions(parsed)

  return {
    cleanedReply: before || 'Prepared app assist actions.',
    appActions,
  }
}

function parseAppActionsFromUserIntent(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return []
  }

  const lower = text.toLowerCase()

  if (/\b(daily|self[-\s]?check|health check)\b/.test(lower) && /\b(run|check|status|verify)\b/.test(lower)) {
    return [{ action: 'open_health_check', route: '', open: false, visible: false, gigName: '' }]
  }

  if (/\b(panic|emergency|recover|recovery)\b/.test(lower) && /\b(mode|now|fix|errors?|issues?)\b/.test(lower)) {
    return [{ action: 'open_health_check', route: '', open: false, visible: false, gigName: '' }]
  }

  if (/\b(open|go to|navigate)\b/.test(lower) && /\bgig control\b/.test(lower)) {
    return [{ action: 'navigate', route: '/admin/gig-control', open: false, visible: false, gigName: '' }]
  }

  if (/\b(open|go to|navigate|check)\b/.test(lower) && /\b(health|errors?)\b/.test(lower)) {
    return [{ action: 'open_health_check', route: '', open: false, visible: false, gigName: '' }]
  }

  if (/\b(fix|repair|recover)\b/.test(lower) && /\b(error|issues?|build[-\s]?up)\b/.test(lower)) {
    return [{ action: 'open_health_check', route: '', open: false, visible: false, gigName: '' }]
  }

  if (/\b(open|go to|navigate)\b/.test(lower) && /\bgigs\b/.test(lower)) {
    return [{ action: 'navigate', route: '/admin/gigs', open: false, visible: false, gigName: '' }]
  }

  if (/\b(mark|set)\b/.test(lower) && /\bplayed\b/.test(lower)) {
    return [{ action: 'mark_played', route: '', open: false, visible: false, gigName: '' }]
  }

  if (/\bskip\b/.test(lower) && /\bsong\b/.test(lower)) {
    return [{ action: 'skip_current_song', route: '', open: false, visible: false, gigName: '' }]
  }

  if (/\b(commit|save|push|sync|upload)\b/.test(lower) && /\b(changes?|code|repo|git)\b/.test(lower)) {
    return [{ action: 'commit_and_push', route: '', open: false, visible: false, gigName: '', commitMessage: 'Auto-commit: app improvements' }]
  }

  return []
}

const MANAGER_PROFILES = {
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    subtitle: 'AI App Helper',
    prompt: `Technical ops persona: GitHub Copilot app helper.

Voice and style:
- Direct, practical, and precise.
- Focus on concrete next actions and safe execution.
- Keep answers concise and operational.

Focus areas:
- App diagnostics and runtime stability.
- Live control actions and recovery workflows.
- Code-change validation, commit quality, and deployment confidence.
- Acting like an embedded technical helper for Harald.`
  },
  brian: {
    id: 'brian',
    name: 'Brian Epstein',
    subtitle: 'Systems Architect',
    prompt: `Technical ops persona: Systems architect mindset.

Voice and style:
- Clear, methodical, and detail-oriented.
- Light British humor, dry and tasteful.
- Approach problems like designing a robust system: prioritize stability, anticipate failure modes, document decisions.

Focus areas:
- App health monitoring and proactive diagnostics.
- Queue flow optimization and queue state management.
- Error recovery and system resilience patterns.
- Code quality and maintainability.`
  },
  parker: {
    id: 'parker',
    name: 'Colonel Tom Parker',
    subtitle: 'Live Operations Lead',
    prompt: `Technical ops persona: Live operations mindset.

Voice and style:
- Bold, decisive, and action-oriented.
- Punchy humor in fast-paced situations.
- Approach problems like running a live event: adapt quickly, prioritize the immediate fix, keep the show moving.

Focus areas:
- Real-time gig control and quick decision-making.
- Queue management during live shows.
- Quick diagnostics and emergency recovery.
- Operational flexibility and recovery under pressure.`
  },
  grant: {
    id: 'grant',
    name: 'Peter Grant',
    subtitle: 'Performance Engineer',
    prompt: `Technical ops persona: Performance engineer mindset.

Voice and style:
- Straight-talking, confident, no-nonsense.
- Dry humor used sparingly, focused on technical edge cases.
- Approach problems like optimizing a system under constraints: measure, identify bottlenecks, optimize ruthlessly.

Focus areas:
- Performance diagnostics and bottleneck identification.
- Code quality and technical debt management.
- System reliability metrics and monitoring.
- Long-term stability over quick fixes.`
  },
}

function resolveManagerId(value) {
  if (typeof value !== 'string') {
    return 'copilot'
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'copilot' || normalized === 'brian' || normalized === 'parker' || normalized === 'grant') {
    return normalized
  }

  return 'copilot'
}

function toJsonBody(body) {
  if (!body) return {}
  if (typeof body === 'string') {
    try { return JSON.parse(body) } catch { return {} }
  }
  if (typeof body === 'object') return body
  return {}
}

function buildPipelineContext(pipeline) {
  if (!pipeline || typeof pipeline !== 'object') return ''

  const lines = []

  if (pipeline.analytics) {
    const a = pipeline.analytics
    lines.push(`Pipeline summary: ${a.sentCount ?? 0} emails sent, ${a.contacted ?? 0} venues contacted, ${a.replyStages ?? 0} have replied or are in negotiation, ${a.confirmed ?? 0} confirmed gigs.`)
  }

  if (Array.isArray(pipeline.pendingTasks) && pipeline.pendingTasks.length) {
    const overdue = pipeline.pendingTasks.filter(t => t.dueAt && new Date(t.dueAt) < new Date())
    lines.push(`Follow-up tasks: ${pipeline.pendingTasks.length} pending, ${overdue.length} overdue.`)
    overdue.slice(0, 3).forEach(t => {
      lines.push(`  - Overdue: ${t.venueName} (${t.type.replace(/-/g, ' ')}, due ${t.dueAt})`)
    })
  }

  if (Array.isArray(pipeline.venues) && pipeline.venues.length) {
    lines.push(`\nVenue pipeline (up to 20 venues):`)
    pipeline.venues.slice(0, 20).forEach(v => {
      lines.push(`  - ${v.name} | type: ${v.type} | stage: ${v.stage} | score: ${v.leadScore} | dist: ${v.distanceKm?.toFixed(1)}km | email: ${v.contactEmail || v.email || 'none'}`)
    })
  }

  if (pipeline.calendar && typeof pipeline.calendar === 'object') {
    const booked = Array.isArray(pipeline.calendar.booked) ? pipeline.calendar.booked : []
    const free = Array.isArray(pipeline.calendar.free) ? pipeline.calendar.free : []

    lines.push(`\nAvailability calendar: ${booked.length} booked dates, ${free.length} marked free dates.`)

    if (booked.length) {
      lines.push('Booked dates (up to 20):')
      booked.slice(0, 20).forEach((entry) => {
        lines.push(`  - ${entry.date} | ${entry.venueName || 'Booked gig'} | city: ${entry.city || 'n/a'} | contact: ${entry.contact || 'n/a'} | fee: ${entry.fee || 'n/a'} | payment: ${entry.paymentStatus || 'unpaid'} ${entry.paymentAmount || ''}${entry.paidAt ? ` (paidAt ${entry.paidAt})` : ''} | source: ${entry.source || 'manual'}${entry.notes ? ` | notes: ${entry.notes}` : ''}`)
      })
    }

    if (free.length) {
      lines.push('Free dates (up to 20):')
      free.slice(0, 20).forEach((entry) => {
        lines.push(`  - ${entry.date}${entry.notes ? ` | notes: ${entry.notes}` : ''}`)
      })
    }
  }

  return lines.join('\n')
}

function buildAppContext(app) {
  if (!app || typeof app !== 'object') {
    return ''
  }

  const lines = []
  lines.push(`Current app state: gig=${app.currentGigName || 'none'} | roomOpen=${String(app.roomOpen)} | showInAudienceNoGig=${String(app.showInAudienceNoGig)} | queueLength=${Number(app.queueLength || 0)} | currentSong=${app.currentSongTitle || 'none'}`)
  lines.push(`Queue health: operatingMode=${app.queueOperatingMode || 'unknown'} | connection=${app.audienceConnectionStatus || 'unknown'} | pendingOfflineSongs=${Number(app.pendingOfflineSongs || 0)}${app.queueHealthMessage ? ` | message=${app.queueHealthMessage}` : ''}`)

  if (Array.isArray(app.hostGigs) && app.hostGigs.length) {
    lines.push('Host gigs (up to 30):')
    app.hostGigs.slice(0, 30).forEach((gig) => {
      lines.push(`  - ${gig.name} | active: ${gig.isActive ? 'yes' : 'no'} | shownNoLive: ${gig.showInAudienceNoGig ? 'yes' : 'no'}`)
    })
  }

  return lines.join('\n')
}

function resolveProviderCandidates(preferredProvider, groqApiKey, openAiApiKey) {
  const hasGroq = Boolean(groqApiKey)
  const hasOpenAi = Boolean(openAiApiKey)

  if (preferredProvider === 'groq') {
    return [
      ...(hasGroq ? ['groq'] : []),
      ...(hasOpenAi ? ['openai'] : []),
    ]
  }

  if (preferredProvider === 'openai') {
    return [
      ...(hasOpenAi ? ['openai'] : []),
      ...(hasGroq ? ['groq'] : []),
    ]
  }

  return [
    ...(hasGroq ? ['groq'] : []),
    ...(hasOpenAi ? ['openai'] : []),
  ]
}

async function callProvider({ provider, apiKey, model, messages }) {
  const apiUrl = provider === 'groq' ? GROQ_API_URL : OPENAI_API_URL

  let upstreamRes
  try {
    upstreamRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 600,
        temperature: 0.7,
      }),
    })
  } catch {
    return {
      ok: false,
      status: 502,
      message: `Failed to reach ${provider}. Try again.`,
    }
  }

  if (!upstreamRes.ok) {
    const errText = await upstreamRes.text().catch(() => '')
    if (upstreamRes.status === 401) {
      return {
        ok: false,
        status: 502,
        message: `${provider} API key is invalid or expired.`,
      }
    }

    if (upstreamRes.status === 429) {
      return {
        ok: false,
        status: 429,
        message: `${provider} rate limit hit. Try again in a moment.`,
      }
    }

    return {
      ok: false,
      status: 502,
      message: `${provider} error ${upstreamRes.status}: ${errText.slice(0, 200)}`,
    }
  }

  let data
  try {
    data = await upstreamRes.json()
  } catch {
    return {
      ok: false,
      status: 502,
      message: `Invalid response from ${provider}.`,
    }
  }

  const reply = data?.choices?.[0]?.message?.content?.trim()
  if (!reply) {
    return {
      ok: false,
      status: 502,
      message: `Empty response from ${provider}.`,
    }
  }

  return {
    ok: true,
    reply,
  }
}

export default async function handler(req, res) {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || ''
  const groqApiKey = process.env.GROQ_API_KEY?.trim() || ''
  const preferredProvider = (process.env.AI_PROVIDER?.trim().toLowerCase() || 'auto')
  const providerCandidates = resolveProviderCandidates(preferredProvider, groqApiKey, openAiApiKey)
  const provider = providerCandidates[0] || 'openai'
  const model = process.env.AI_MODEL?.trim() || (provider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o')
  const defaultManagerId = resolveManagerId(process.env.AI_MANAGER_DEFAULT || 'brian')

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    res.status(204).end()
    return
  }

  if (req.method === 'GET') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    res.status(200).json({
      connected: providerCandidates.length > 0,
      provider,
      model,
      fallbackCount: Math.max(0, providerCandidates.length - 1),
      defaultManagerId,
      managers: Object.values(MANAGER_PROFILES).map((manager) => ({
        id: manager.id,
        name: manager.name,
        subtitle: manager.subtitle,
      })),
    })
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const payload = toJsonBody(req.body)

  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const pipeline = payload.pipeline ?? null
  const app = payload.app ?? null
  const managerId = resolveManagerId(payload.managerId || defaultManagerId)
  const assistModeEnabled = payload.assistMode === true
  const managerProfile = MANAGER_PROFILES[managerId]
  const latestUserMessage = [...messages].reverse().find((msg) => msg.role === 'user')?.content ?? ''

  if (!messages.length) {
    res.status(400).json({ error: 'messages array is required.' })
    return
  }

  // Validate message structure
  for (const msg of messages) {
    if (typeof msg.role !== 'string' || typeof msg.content !== 'string') {
      res.status(400).json({ error: 'Each message must have role and content strings.' })
      return
    }
    if (!['user', 'assistant'].includes(msg.role)) {
      res.status(400).json({ error: 'Message role must be user or assistant.' })
      return
    }
    if (msg.content.length > 4000) {
      res.status(400).json({ error: 'Message content too long.' })
      return
    }
  }

  if (messages.length > 40) {
    res.status(400).json({ error: 'Too many messages in history.' })
    return
  }

  // Graceful fallback when no API key is configured
  if (providerCandidates.length === 0) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() ?? ''
    let fallback = `I'm ${managerProfile.name}, your booking manager. I'm not fully connected yet - add a free-tier GROQ_API_KEY (recommended) or OPENAI_API_KEY to enable AI replies. In the meantime: check your follow-up tasks and prioritise venues with a lead score above 50 that haven't been contacted yet.`
    if (lastUserMsg.includes('email') || lastUserMsg.includes('draft')) {
      fallback = "I'd love to draft that for you - I just need AI provider credentials first. Add GROQ_API_KEY (free-tier) or OPENAI_API_KEY in Vercel environment variables."
    }
    res.status(200).json({ reply: fallback, connected: false, provider, model, managerId, managerName: managerProfile.name })
    return
  }

  const pipelineContext = buildPipelineContext(pipeline)
  const appContext = buildAppContext(app)
  const personaPrompt = `${CORE_PROMPT}\n\n${managerProfile.prompt}${assistModeEnabled ? APP_ACTIONS_PROMPT : ''}`
  const sections = [personaPrompt]

  if (pipelineContext) {
    sections.push(`--- CURRENT PIPELINE DATA ---\n${pipelineContext}\n--- END PIPELINE DATA ---`)
  }

  if (appContext) {
    sections.push(`--- CURRENT APP DATA ---\n${appContext}\n--- END CURRENT APP DATA ---`)
  }

  const systemWithContext = sections.join('\n\n')

  const openAiMessages = [
    { role: 'system', content: systemWithContext },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ]

  let lastError = { status: 502, message: 'AI provider unavailable.' }

  for (const candidate of providerCandidates) {
    const candidateApiKey = candidate === 'groq' ? groqApiKey : openAiApiKey
    const candidateModel = process.env.AI_MODEL?.trim() || (candidate === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o')

    const result = await callProvider({
      provider: candidate,
      apiKey: candidateApiKey,
      model: candidateModel,
      messages: openAiMessages,
    })

    if (result.ok) {
      const appParsed = extractAppActions(result.reply)
      const parsed = extractCalendarActions(appParsed.cleanedReply)
      const fallbackActions = parsed.calendarActions.length === 0
        ? parseCalendarActionsFromUserIntent(latestUserMessage)
        : []
      const fallbackAppActions = assistModeEnabled && appParsed.appActions.length === 0
        ? parseAppActionsFromUserIntent(latestUserMessage)
        : []
      res.status(200).json({
        reply: parsed.cleanedReply,
        calendarActions: parsed.calendarActions.length > 0 ? parsed.calendarActions : fallbackActions,
        appActions: appParsed.appActions.length > 0 ? appParsed.appActions : fallbackAppActions,
        connected: true,
        provider: candidate,
        model: candidateModel,
        managerId,
        managerName: managerProfile.name,
      })
      return
    }

    lastError = { status: result.status, message: result.message }
  }

  res.status(lastError.status).json({ error: lastError.message })
}
