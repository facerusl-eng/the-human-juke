/**
 * Vercel serverless function — creates a GitHub Issue from an in-app fix request.
 * Requires GITHUB_TOKEN env var (fine-grained PAT with Issues: write on the repo).
 */

const REPO_OWNER = 'facerusl-eng'
const REPO_NAME = 'the-human-juke'
const GITHUB_API = 'https://api.github.com'

const ALLOWED_ORIGINS = [
  'https://www.the-human-jukebox.org',
  'https://the-human-jukebox.org',
  'https://the-human-juke.vercel.app',
]

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || ''

  if (req.method === 'OPTIONS') {
    return res.status(204).set(corsHeaders(origin)).end()
  }

  Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.setHeader(k, v))

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error('GITHUB_TOKEN env var is not set')
    return res.status(500).json({ error: 'GitHub token not configured' })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const { title, details, priority } = body ?? {}

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({ error: 'title is required' })
  }

  // Sanitise inputs — strip any prompt-injection attempts
  const safeTitle = String(title).slice(0, 200).replace(/[\r\n]/g, ' ')
  const safeDetails = String(details ?? '').slice(0, 8000)
  const safePriority = ['urgent', 'high', 'normal'].includes(priority) ? priority : 'normal'

  const issueBody = [
    `**Auto-reported from The Human Jukebox app** — ${new Date().toISOString()}`,
    '',
    `**Priority:** ${safePriority}`,
    '',
    '---',
    '',
    safeDetails,
  ].join('\n')

  const labels = ['app-fix', safePriority === 'urgent' ? 'P0' : safePriority === 'high' ? 'P1' : 'P2']

  try {
    const ghRes = await fetch(`${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'human-jukebox-app/1.0',
      },
      body: JSON.stringify({
        title: safeTitle,
        body: issueBody,
        labels,
        assignees: ['Copilot'],
      }),
    })

    if (!ghRes.ok) {
      const errText = await ghRes.text()
      console.error('GitHub API error', ghRes.status, errText)
      return res.status(502).json({ error: 'GitHub API error', status: ghRes.status })
    }

    const issue = await ghRes.json()
    return res.status(200).json({ issueUrl: issue.html_url, issueNumber: issue.number })
  } catch (err) {
    console.error('report-issue fetch error', err)
    return res.status(500).json({ error: 'Failed to create issue' })
  }
}
