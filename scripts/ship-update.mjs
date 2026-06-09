import { execSync } from 'node:child_process'

const commitMessage = process.argv.slice(2).join(' ').trim()

if (!commitMessage) {
  console.error('Usage: npm run ship:update -- "your commit message"')
  process.exit(1)
}

function runCommand(command) {
  execSync(command, { stdio: 'inherit' })
}

function hasGitDiff() {
  const output = execSync('git status --porcelain', { encoding: 'utf8' })
  return output.trim().length > 0
}

function quoteForShell(value) {
  return `"${value.replace(/"/g, '\\"')}"`
}

async function run() {
  runCommand('npm run sync:variants')
  runCommand('npm run sync:variants:check')
  runCommand('npm run verify:consistency')
  runCommand('npm run build:apps')

  runCommand('git add -A')

  if (!hasGitDiff()) {
    console.log('No changes detected after sync/verify/build. Nothing to commit.')
    return
  }

  runCommand(`git commit -m ${quoteForShell(commitMessage)}`)
  runCommand('git push origin main')
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
