const HUMAN_JUKEBOX_BASE_URLS = [
  'https://www.the-human-jukebox.org',
  'https://the-human-jukebox.org',
]

function parseJsonBody(reqBody) {
  if (!reqBody) {
    return null
  }

  if (typeof reqBody === 'string') {
    try {
      return JSON.parse(reqBody)
    } catch {
      return null
    }
  }

  return reqBody
}

function queueFetchTargets(gigId) {
  const encodedGigId = encodeURIComponent(gigId)

  return HUMAN_JUKEBOX_BASE_URLS.flatMap((baseUrl) => [
    `${baseUrl}/api/queue?gig_id=${encodedGigId}`,
    `${baseUrl}/api/queue?gigId=${encodedGigId}`,
    `${baseUrl}/api/live-queue?gig_id=${encodedGigId}`,
    `${baseUrl}/api/gigs/${encodedGigId}/queue`,
    `${baseUrl}/api/song-requests?gig_id=${encodedGigId}`,
  ])
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseJsonBody(req.body)

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Invalid request body.' })
    return
  }

  const apiKey = String(body.apiKey ?? '').trim()
  const gigId = String(body.gigId ?? '').trim()

  if (!apiKey || !gigId) {
    res.status(400).json({ error: 'apiKey and gigId are required.' })
    return
  }

  const targets = queueFetchTargets(gigId)
  const failures = []

  for (const target of targets) {
    try {
      const response = await fetch(target, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
        },
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload) {
        failures.push({ target, status: response.status })
        continue
      }

      res.status(200).json({
        ...payload,
        source: target,
        fetchedAt: new Date().toISOString(),
      })
      return
    } catch {
      failures.push({ target, status: 0 })
    }
  }

  res.status(502).json({
    error: 'Could not fetch queue from Human Jukebox API.',
    attemptedTargets: failures.map((failure) => ({ target: failure.target, status: failure.status })),
  })
}
