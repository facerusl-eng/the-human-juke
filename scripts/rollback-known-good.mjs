#!/usr/bin/env node
import { execSync } from 'node:child_process'

const PROJECT = 'the-human-juke'

const PRESETS = {
  'stable-2d': 'https://the-human-juke-3ujvmefax-facerusl-6818s-projects.vercel.app',
  'stable-yesterday': 'https://the-human-juke-cbhyh45wi-facerusl-6818s-projects.vercel.app',
}

function run(command) {
  execSync(command, { stdio: 'inherit' })
}

function printUsage() {
  console.log('Usage: node scripts/rollback-known-good.mjs <preset> [--apply]')
  console.log('')
  console.log('Presets:')
  Object.entries(PRESETS).forEach(([name, url]) => {
    console.log(`  ${name} -> ${url}`)
  })
  console.log('')
  console.log('Examples:')
  console.log('  node scripts/rollback-known-good.mjs stable-2d')
  console.log('  node scripts/rollback-known-good.mjs stable-2d --apply')
}

const args = process.argv.slice(2)
const preset = args.find((arg) => !arg.startsWith('--'))
const shouldApply = args.includes('--apply')
const shouldList = args.includes('--list')

if (shouldList) {
  printUsage()
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
