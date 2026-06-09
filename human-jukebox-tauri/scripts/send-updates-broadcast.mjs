import 'dotenv/config'

function parseArgs(argv) {
  const result = {}

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      continue
    }

    const key = token.slice(2)
    const next = argv[i + 1]

    if (!next || next.startsWith('--')) {
      result[key] = true
      continue
    }

    result[key] = next
    i += 1
  }

  return result
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const apiUrl = String(args['api-url'] || process.env.UPDATES_BROADCAST_API_URL || 'https://www.the-human-jukebox.org/api/send-updates-broadcast').trim()
  const token = String(process.env.UPDATES_BROADCAST_TOKEN || '').trim()

  if (!token) {
    console.error('Missing UPDATES_BROADCAST_TOKEN in environment.')
    process.exit(1)
  }

  const body = {}
  if (args.subject) {
    body.subject = String(args.subject)
  }
  if (args.heading) {
    body.heading = String(args.heading)
  }
  if (args.message) {
    body.message = String(args.message)
  }
  if (args.lang) {
    body.lang = String(args.lang) === 'da' ? 'da' : 'en'
  }
  if (args['cta-url']) {
    body.ctaUrl = String(args['cta-url'])
  }
  if (args['cta-text']) {
    body.ctaText = String(args['cta-text'])
  }
  if (args.footer) {
    body.footer = String(args.footer)
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-broadcast-token': token,
    },
    body: JSON.stringify(body),
  })

  const responseText = await response.text()
  let responseBody = responseText

  try {
    responseBody = JSON.parse(responseText)
  } catch {
    // keep plain text response
  }

  console.log('Broadcast endpoint:', apiUrl)
  console.log('HTTP status:', response.status)
  console.log('Response:', responseBody)

  if (!response.ok) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Failed to trigger updates broadcast:', error)
  process.exit(1)
})
