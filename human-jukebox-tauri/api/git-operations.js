import { spawn } from 'child_process'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = dirname(__dirname)

function runCommand(command, args, cwd = PROJECT_ROOT) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      shell: true,
      timeout: 30000,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('error', (error) => {
      reject(new Error(`Command failed: ${error.message}`))
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code })
      } else {
        reject(new Error(`Command exited with code ${code}: ${stderr || stdout}`))
      }
    })
  })
}

async function getGitStatus() {
  try {
    const result = await runCommand('git', ['status', '--porcelain'])
    return result.stdout
  } catch (error) {
    throw new Error(`Git status failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function getGitDiff() {
  try {
    const result = await runCommand('git', ['diff', '--cached', '--name-only'])
    return result.stdout
      .split('\n')
      .filter(line => line.trim())
  } catch (error) {
    throw new Error(`Git diff failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function stageAllChanges() {
  try {
    const status = await getGitStatus()
    if (!status) {
      return { changed: 0, message: 'No changes to stage.' }
    }

    await runCommand('git', ['add', '-A'])
    return { changed: status.split('\n').filter(line => line.trim()).length, message: 'All changes staged.' }
  } catch (error) {
    throw new Error(`Failed to stage changes: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function commitChanges(message) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('Commit message cannot be empty.')
  }

  // Basic commit message validation
  if (message.length > 200) {
    throw new Error('Commit message too long (max 200 chars).')
  }

  try {
    const diffFiles = await getGitDiff()
    if (diffFiles.length === 0) {
      throw new Error('No staged changes to commit.')
    }

    await runCommand('git', ['commit', '-m', message])
    return { files: diffFiles, message: `Committed ${diffFiles.length} file(s).` }
  } catch (error) {
    throw new Error(`Commit failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function pushChanges(branch = 'main') {
  // Validate branch name (alphanumeric, dash, underscore, slash only)
  if (!/^[a-zA-Z0-9\/_-]+$/.test(branch)) {
    throw new Error('Invalid branch name.')
  }

  // Prevent force push
  try {
    await runCommand('git', ['push', 'origin', branch])
    return { branch, message: `Pushed to ${branch}.` }
  } catch (error) {
    throw new Error(`Push failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function stageCommitAndPush(commitMessage, branch = 'main') {
  try {
    const stageResult = await stageAllChanges()
    if (stageResult.changed === 0) {
      return { success: false, message: 'No changes to commit.' }
    }

    const commitResult = await commitChanges(commitMessage)
    const pushResult = await pushChanges(branch)

    return {
      success: true,
      message: `Successfully staged, committed, and pushed. (${commitResult.files.length} files, branch: ${branch})`,
      files: commitResult.files,
      branch,
    }
  } catch (error) {
    throw new Error(`Stage/commit/push failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export default async function handler(req, res) {
  const { method, body } = req

  if (method === 'GET') {
    try {
      const status = await getGitStatus()
      res.status(200).json({
        ok: true,
        status: status || 'No changes.',
        hasChanges: Boolean(status),
      })
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to get git status.',
      })
    }
    return
  }

  if (method === 'POST') {
    const { action, message, branch } = body

    try {
      if (action === 'stage') {
        const result = await stageAllChanges()
        res.status(200).json({ ok: true, ...result })
      } else if (action === 'commit') {
        const result = await commitChanges(message)
        res.status(200).json({ ok: true, ...result })
      } else if (action === 'push') {
        const result = await pushChanges(branch)
        res.status(200).json({ ok: true, ...result })
      } else if (action === 'stage-commit-push') {
        const result = await stageCommitAndPush(message, branch)
        res.status(200).json({ ok: true, ...result })
      } else {
        res.status(400).json({ ok: false, error: 'Unknown action.' })
      }
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Git operation failed.',
      })
    }
  }
}
