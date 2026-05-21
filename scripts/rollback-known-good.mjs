#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process'

const PROJECT = 'the-human-juke'

const PRESETS = {
  'stable-2d': 'https://the-human-juke-3ujvmefax-facerusl-6818s-projects.vercel.app',
  'stable-yesterday': 'https://the-human-juke-cbhyh45wi-facerusl-6818s-projects.vercel.app',
}

function run(command) {
  execSync(command, { stdio: 'inherit' })
}

function runCapture(command) {
  const result = spawnSync(command, {
    encoding: 'utf8',
    shell: true,
  })

  const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  if (result.status !== 0) {
    throw new Error(combinedOutput.trim() || `Command failed: ${command}`)
  }

  return combinedOutput
}

function parseAgeToHours(ageToken) {
  const match = String(ageToken).trim().match(/^(\d+)([mhd])$/i)
  if (!match) {
    return Number.NaN
  }

  const value = Number(match[1])
  const unit = match[2].toLowerCase()

  if (unit === 'm') {
    return value / 60
  }

  if (unit === 'h') {
    return value
  }

  return value * 24
}

function parseDeploymentRows(output) {
  const rows = []
  const lines = output.split(/\r?\n/)

  for (const line of lines) {
    if (!line.includes('facerusl-6818s-projects/the-human-juke')) {
      continue
    }

    const parts = line.trim().split(/\s+/)
    if (parts.length < 7) {
      continue
    }

    const age = parts[0]
    const url = parts[2]
    const status = parts[3] === '●' ? parts[4] : parts[3]
    const environment = parts[3] === '●' ? parts[5] : parts[4]

    rows.push({
      age,
      ageHours: parseAgeToHours(age),
      url,
      status,
      environment,
    })
  }

  return rows
}

function findNextCursor(output) {
  const match = output.match(/--next\s+(\d+)/)
  return match?.[1] ?? null
}

function findLatestReadyProductionOlderThanHours(hours) {
  const maxPages = 10
  let nextCursor = null

  for (let page = 0; page < maxPages; page += 1) {
    const command = nextCursor
      ? `vercel list ${PROJECT} --next ${nextCursor}`
      : `vercel list ${PROJECT}`

    const output = runCapture(command)
    const rows = parseDeploymentRows(output)
    const candidate = rows.find((row) => {
      return row.status.toLowerCase() === 'ready'
        && row.environment.toLowerCase() === 'production'
        && Number.isFinite(row.ageHours)
        && row.ageHours >= hours
    })

    if (candidate) {
      return candidate
    }

    nextCursor = findNextCursor(output)
    if (!nextCursor) {
      break
    }
  }

  return null
}

function printUsage() {
  console.log('Usage: node scripts/rollback-known-good.mjs <preset> [--apply]')
  console.log('       node scripts/rollback-known-good.mjs --older-than-hours <hours> [--apply]')
  console.log('')
  console.log('Presets:')
  Object.entries(PRESETS).forEach(([name, url]) => {
    console.log(`  ${name} -> ${url}`)
  })
  console.log('')
  console.log('Examples:')
  console.log('  node scripts/rollback-known-good.mjs stable-2d')
  console.log('  node scripts/rollback-known-good.mjs stable-2d --apply')
  console.log('  node scripts/rollback-known-good.mjs --older-than-hours 24')
  console.log('  node scripts/rollback-known-good.mjs --older-than-hours 24 --apply')
}

const args = process.argv.slice(2)
const preset = args.find((arg) => !arg.startsWith('--'))
const shouldApply = args.includes('--apply')
const shouldList = args.includes('--list')
const olderThanHoursFlagIndex = args.indexOf('--older-than-hours')
const hasOlderThanHoursFlag = olderThanHoursFlagIndex >= 0
const olderThanHours = hasOlderThanHoursFlag ? Number(args[olderThanHoursFlagIndex + 1]) : Number.NaN

if (shouldList) {
  printUsage()
  process.exit(0)
}

if (hasOlderThanHoursFlag && (!Number.isFinite(olderThanHours) || olderThanHours < 0)) {
  console.error('Invalid value for --older-than-hours. Use a non-negative number.')
  process.exit(1)
}

if (hasOlderThanHoursFlag) {
  const candidate = findLatestReadyProductionOlderThanHours(olderThanHours)

  if (!candidate) {
    console.error(`No ready production deployment found that is older than ${olderThanHours} hours.`)
    process.exit(1)
  }

  if (!shouldApply) {
    console.log(`[dry-run] Found deployment older than ${olderThanHours} hours:`)
    console.log(`[dry-run] Age: ${candidate.age}`)
    console.log(`[dry-run] Deployment: ${candidate.url}`)
    console.log('[dry-run] Re-run with --apply to execute rollback.')
    process.exit(0)
  }

  console.log(`Rolling back ${PROJECT} to latest ready production deployment older than ${olderThanHours} hours`)
  run(`vercel rollback ${candidate.url}`)
  console.log('')
  console.log('Verifying production alias:')
  run('vercel inspect www.the-human-jukebox.org')
  process.exit(0)
}

if (!preset || !PRESETS[preset]) {
  printUsage()
  process.exit(1)
}

const target = PRESETS[preset]

if (!shouldApply) {
  console.log(`[dry-run] Target preset: ${preset}`)
  console.log(`[dry-run] Deployment: ${target}`)
  console.log('[dry-run] Re-run with --apply to execute rollback.')
  process.exit(0)
}

console.log(`Rolling back ${PROJECT} to ${preset}`)
run(`vercel rollback ${target}`)
console.log('')
console.log('Verifying production alias:')
run(`vercel inspect www.the-human-jukebox.org`)
