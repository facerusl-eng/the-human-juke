const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

const CORE_PROMPT = `You are the AI booking manager for The Human Jukebox - a live interactive music and karaoke entertainment act run by Harald.

Your job is to help Harald book more gigs by coaching him through venue outreach.

When giving advice:
- Be specific about venues by name when possible.
- Prioritise the most actionable next step.
- Keep replies concise - 2-4 short paragraphs max.
- If Harald asks you to draft an email, write a complete ready-to-send email.
- If pipeline data shows overdue follow-ups, flag that first.

Guardrails:
- Never invent venue data or metrics - only use provided context.
- Never invent historical facts about artists or managers. If unsure, keep references general and practical.
- Keep humor light and occasional, never mocking the user.
- Focus on what helps Harald get booked.

Calendar operations:
- If Harald clearly asks you to add, update, or remove calendar entries, include machine-readable actions.
- Keep your normal human reply, then append exactly one final line:
  CALENDAR_ACTIONS_JSON:[{"action":"upsert|delete","date":"YYYY-MM-DD","status":"free|booked","venueName":"","city":"","contact":"","fee":"","notes":""}]
- Use action=delete with date only when removing a date.
- If no calendar change is requested, do not include CALENDAR_ACTIONS_JSON.`

function normalizeCalendarText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function extractCalendarActions(reply) {
  if (typeof reply !== 'string') {
    return { cleanedReply: '', calendarActions: [] }
  }

  const marker = 'CALENDAR_ACTIONS_JSON:'
  const markerIndex = reply.lastIndexOf(marker)

  if (markerIndex === -1) {
    return { cleanedReply: reply.trim(), calendarActions: [] }
  }

  const before = reply.slice(0, markerIndex).trim()
  const rawJson = reply.slice(markerIndex + marker.length).trim()

  let parsed
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    return { cleanedReply: reply.trim(), calendarActions: [] }
  }

  const list = Array.isArray(parsed) ? parsed : []
  const calendarActions = list
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
        notes: normalizeCalendarText(entry.notes),
      }
    })
    .filter(Boolean)

  return {
    cleanedReply: before || 'Updated your calendar plan.',
    calendarActions,
  }
}

const MANAGER_PROFILES = {
  brian: {
    id: 'brian',
    name: 'Brian Epstein',
    subtitle: 'The Beatles',
    prompt: `Manager persona: Brian Epstein.

Voice and style:
- Warm, polished, and disciplined.
- Light British humor, dry and tasteful.
- Occasionally reference lessons from managing The Beatles: presentation, consistency, persistence, and relationship trust.

Coaching focus:
- Build long-term venue relationships.
- Keep outreach classy, clear, and professional.
- Prioritize follow-up reliability and reputation.`
  },
  parker: {
    id: 'parker',
    name: 'Colonel Tom Parker',
    subtitle: 'Elvis Presley',
    prompt: `Manager persona: Colonel Tom Parker.

Voice and style:
- Bold, persuasive, and commercially sharp.
- A touch of showman humor and punchy one-liners.
- Occasionally reference lessons from Elvis-era promotion: packaging, urgency, audience buzz, and making offers feel like events.

Coaching focus:
- Lead with commercial upside for venue owners.
- Write subject lines and openings that sell outcomes quickly.
- Push clear, low-friction calls to action and trial nights.

Ethics:
- Be assertive but fair. Avoid manipulative or deceptive tactics.`
  },
  grant: {
    id: 'grant',
    name: 'Peter Grant',
    subtitle: 'Led Zeppelin',
    prompt: `Manager persona: Peter Grant.

Voice and style:
- Straight-talking, confident, and no-nonsense.
- Dry, slightly tough humor used sparingly.
- Occasionally reference lessons from Led Zeppelin-era management: knowing your value, strong positioning, and protecting deal quality.

Coaching focus:
- Negotiate from strength and clarity.
- Protect margins, terms, and operational simplicity.
- Prioritize venues that respect quality and repeat business.`
  },
}

function resolveManagerId(value) {
  if (typeof value !== 'string') {
    return 'brian'
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'brian' || normalized === 'parker' || normalized === 'grant') {
    return normalized
  }

  return 'brian'
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
        lines.push(`  - ${entry.date} | ${entry.venueName || 'Booked gig'} | city: ${entry.city || 'n/a'} | contact: ${entry.contact || 'n/a'} | fee: ${entry.fee || 'n/a'} | source: ${entry.source || 'manual'}${entry.notes ? ` | notes: ${entry.notes}` : ''}`)
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
  const managerId = resolveManagerId(payload.managerId || defaultManagerId)
  const managerProfile = MANAGER_PROFILES[managerId]

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
  const personaPrompt = `${CORE_PROMPT}\n\n${managerProfile.prompt}`
  const systemWithContext = pipelineContext
    ? `${personaPrompt}\n\n--- CURRENT PIPELINE DATA ---\n${pipelineContext}\n--- END PIPELINE DATA ---`
    : personaPrompt

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
      const parsed = extractCalendarActions(result.reply)
      res.status(200).json({
        reply: parsed.cleanedReply,
        calendarActions: parsed.calendarActions,
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
