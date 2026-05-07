const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

const SYSTEM_PROMPT = `You are Brian Epstein, the AI booking manager for The Human Jukebox — a live interactive music and karaoke entertainment act run by Harald.

Your job is to help Harald book more gigs by coaching him through venue outreach. You have access to his current pipeline data and venue list. You speak like a real, experienced music industry manager: direct, warm, practical, and encouraging. Never robotic.

When giving advice:
- Be specific about venues by name when possible
- Prioritise the most actionable next step
- Keep replies concise — 2-4 short paragraphs max
- If Harald asks you to draft an email, write a complete ready-to-send email
- If the pipeline data shows follow-ups are overdue, flag that first

You never make up venue data — only reference what's in the context provided.`

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

  return lines.join('\n')
}

export default async function handler(req, res) {
  const apiKey = process.env.OPENAI_API_KEY?.trim() || ''

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    res.status(204).end()
    return
  }

  if (req.method === 'GET') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    res.status(200).json({ connected: Boolean(apiKey) })
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
  if (!apiKey) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() ?? ''
    let fallback = "I'm Brian Epstein, your booking manager. I'm not fully connected yet - ask Harald to add an OpenAI API key to get AI-powered advice. In the meantime: check your follow-up tasks and prioritise venues with a lead score above 50 that haven't been contacted yet."
    if (lastUserMsg.includes('email') || lastUserMsg.includes('draft')) {
      fallback = "I'd love to draft that for you — I just need an OpenAI API key to be configured first. Ask Harald to add OPENAI_API_KEY to the Vercel environment variables."
    }
    res.status(200).json({ reply: fallback, connected: false })
    return
  }

  const pipelineContext = buildPipelineContext(pipeline)
  const systemWithContext = pipelineContext
    ? `${SYSTEM_PROMPT}\n\n--- CURRENT PIPELINE DATA ---\n${pipelineContext}\n--- END PIPELINE DATA ---`
    : SYSTEM_PROMPT

  const openAiMessages = [
    { role: 'system', content: systemWithContext },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ]

  let openAiRes
  try {
    openAiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: openAiMessages,
        max_tokens: 600,
        temperature: 0.7,
      }),
    })
  } catch {
    res.status(502).json({ error: 'Failed to reach OpenAI. Try again.' })
    return
  }

  if (!openAiRes.ok) {
    const errText = await openAiRes.text().catch(() => '')
    if (openAiRes.status === 401) {
      res.status(502).json({ error: 'OpenAI API key is invalid or expired.' })
    } else if (openAiRes.status === 429) {
      res.status(429).json({ error: 'OpenAI rate limit hit. Try again in a moment.' })
    } else {
      res.status(502).json({ error: `OpenAI error ${openAiRes.status}: ${errText.slice(0, 200)}` })
    }
    return
  }

  let data
  try {
    data = await openAiRes.json()
  } catch {
    res.status(502).json({ error: 'Invalid response from OpenAI.' })
    return
  }

  const reply = data?.choices?.[0]?.message?.content?.trim()
  if (!reply) {
    res.status(502).json({ error: 'Empty response from OpenAI.' })
    return
  }

  res.status(200).json({ reply, connected: true })
}
