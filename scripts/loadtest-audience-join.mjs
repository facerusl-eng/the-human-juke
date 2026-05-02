import { createClient } from '@supabase/supabase-js'

const args = new Map()
for (const rawArg of process.argv.slice(2)) {
  const [key, value] = rawArg.split('=')
  if (key?.startsWith('--')) {
    args.set(key.slice(2), value ?? 'true')
  }
}

const concurrency = Math.max(1, Number(args.get('concurrency') ?? '25'))
const rounds = Math.max(1, Number(args.get('rounds') ?? '2'))
const eventIdArg = (args.get('eventId') ?? '').trim() || null

const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim() || ''
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''

if (!supabaseUrl || !publishableKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY environment variables.')
  process.exit(1)
}

const metrics = {
  users: 0,
  successful: 0,
  failed: 0,
  authFailures: 0,
  eventLookupFailures: 0,
  queueFailures: 0,
  timingsMs: [],
}

async function runVirtualAudienceJoin(userNumber) {
  const startedAt = Date.now()
  const client = createClient(supabaseUrl, publishableKey, {
    auth: {
      storage: {
        getItem() { return null },
        setItem() {},
        removeItem() {},
      },
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  try {
    const { data: authData, error: authError } = await client.auth.signInAnonymously()

    if (authError || !authData.user) {
      metrics.authFailures += 1
      throw new Error(authError?.message ?? 'Anonymous auth failed')
    }

    let targetEventId = eventIdArg

    if (!targetEventId) {
      const { data: eventRow, error: eventError } = await client
        .from('events')
        .select('id')
        .eq('is_active', true)
        .eq('room_open', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (eventError) {
        metrics.eventLookupFailures += 1
        throw new Error(`Active event lookup failed: ${eventError.message}`)
      }

      if (!eventRow?.id) {
        metrics.eventLookupFailures += 1
        throw new Error('No active live event found')
      }

      targetEventId = eventRow.id
    }

    const { error: queueError } = await client
      .from('queue_songs')
      .select('id, title, votes_count')
      .eq('event_id', targetEventId)
      .eq('is_removed', false)
      .limit(50)

    if (queueError) {
      metrics.queueFailures += 1
      throw new Error(`Queue snapshot failed: ${queueError.message}`)
    }

    metrics.successful += 1
  } catch (error) {
    metrics.failed += 1
    console.warn(`[VU ${userNumber}] ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    metrics.users += 1
    metrics.timingsMs.push(Date.now() - startedAt)
    try {
      await client.auth.signOut()
    } catch {
      // Ignore sign-out cleanup failures.
    }
  }
}

async function runRound(roundNumber) {
  console.log(`\nRound ${roundNumber}/${rounds} with concurrency=${concurrency}`)
  const start = Date.now()

  await Promise.all(
    Array.from({ length: concurrency }, (_, index) => runVirtualAudienceJoin((roundNumber - 1) * concurrency + index + 1)),
  )

  console.log(`Round ${roundNumber} complete in ${Date.now() - start}ms`)
}

for (let round = 1; round <= rounds; round += 1) {
  await runRound(round)
}

const sortedTimings = [...metrics.timingsMs].sort((a, b) => a - b)
const percentile = (p) => {
  if (sortedTimings.length === 0) return 0
  const index = Math.min(sortedTimings.length - 1, Math.floor((p / 100) * sortedTimings.length))
  return sortedTimings[index] ?? 0
}

const p50 = percentile(50)
const p95 = percentile(95)
const avg = metrics.timingsMs.length
  ? Math.round(metrics.timingsMs.reduce((sum, value) => sum + value, 0) / metrics.timingsMs.length)
  : 0

console.log('\n=== Audience Join Load Test Summary ===')
console.log(`Users attempted: ${metrics.users}`)
console.log(`Successful joins: ${metrics.successful}`)
console.log(`Failed joins: ${metrics.failed}`)
console.log(`Auth failures: ${metrics.authFailures}`)
console.log(`Event lookup failures: ${metrics.eventLookupFailures}`)
console.log(`Queue load failures: ${metrics.queueFailures}`)
console.log(`Avg latency: ${avg}ms`) 
console.log(`P50 latency: ${p50}ms`)
console.log(`P95 latency: ${p95}ms`)

const failureRate = metrics.users > 0 ? (metrics.failed / metrics.users) * 100 : 0
if (failureRate > 5 || p95 > 8000) {
  console.error(`Load test failed threshold: failureRate=${failureRate.toFixed(2)}%, p95=${p95}ms`)
  process.exit(2)
}

console.log('Load test passed thresholds.')
