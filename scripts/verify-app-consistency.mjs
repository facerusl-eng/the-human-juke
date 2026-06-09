import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const checks = []

function addCheck(name, pass, details) {
  checks.push({ name, pass, details })
}

async function run() {
  const audienceSupabaseClientPath = path.join(repoRoot, 'audience-app/src/lib/supabaseClient.ts')
  const audienceSupabaseClientSource = await readFile(audienceSupabaseClientPath, 'utf8')

  addCheck(
    'Audience app uses shared Supabase client',
    audienceSupabaseClientSource.includes("from '../../../shared/supabase/supabaseClient'"),
    'Expected audience app to import createSharedSupabaseClient from shared/supabase/supabaseClient.',
  )

  const webIndexCssPath = path.join(repoRoot, 'src/index.css')
  const webIndexCssSource = await readFile(webIndexCssPath, 'utf8')
  addCheck(
    'Web app has mobile responsive rules',
    /@media\s*\(max-width\s*:\s*[^)]+\)/.test(webIndexCssSource),
    'Expected mobile @media rules in src/index.css.',
  )

  const audienceCssPath = path.join(repoRoot, 'audience-app/src/app.css')
  const audienceCssSource = await readFile(audienceCssPath, 'utf8')
  addCheck(
    'Audience app has mobile responsive rules',
    /@media\s*\(max-width\s*:\s*[^)]+\)/.test(audienceCssSource),
    'Expected mobile @media rules in audience-app/src/app.css.',
  )

  const failedChecks = checks.filter((check) => !check.pass)

  for (const check of checks) {
    const label = check.pass ? 'PASS' : 'FAIL'
    console.log(`[${label}] ${check.name}`)
  }

  if (failedChecks.length > 0) {
    console.error('\nConsistency verification failed:')
    for (const failedCheck of failedChecks) {
      console.error(`- ${failedCheck.details}`)
    }
    process.exit(1)
  }

  console.log('\nConsistency verification passed.')
}

run().catch((error) => {
  console.error('Failed to verify app consistency.', error)
  process.exit(1)
})
