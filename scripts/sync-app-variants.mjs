import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const SHARED_FILE_PATHS = [
  'src/pages/GigControlPage.tsx',
  'src/components/SpotifyPlayerWithSDK.jsx',
  'src/state/queueStore.tsx',
  'src/lib/playbackState.ts',
  'src/lib/supabase.ts',
  'src/hooks/useGigActions.ts',
  'src/index.css',
  'src/App.css',
  'src/audience-karafun.css',
]

const VARIANT_ROOTS = [
  'human-jukebox-web',
  'human-jukebox-tauri',
]

const checkOnly = process.argv.includes('--check')

async function fileContents(filePath) {
  return readFile(filePath, 'utf8')
}

async function ensureParentDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true })
}

async function run() {
  const updates = []
  const mismatches = []

  for (const relativeFilePath of SHARED_FILE_PATHS) {
    const sourcePath = path.join(repoRoot, relativeFilePath)
    const sourceContent = await fileContents(sourcePath)

    for (const variantRoot of VARIANT_ROOTS) {
      const targetPath = path.join(repoRoot, variantRoot, relativeFilePath)
      const targetContent = await fileContents(targetPath)

      if (targetContent === sourceContent) {
        continue
      }

      if (checkOnly) {
        mismatches.push({
          variantRoot,
          relativeFilePath,
        })
        continue
      }

      await ensureParentDir(targetPath)
      await writeFile(targetPath, sourceContent, 'utf8')
      updates.push({
        variantRoot,
        relativeFilePath,
      })
    }
  }

  if (checkOnly) {
    if (mismatches.length > 0) {
      console.error('Shared file mismatches detected between root app and variants:')
      for (const mismatch of mismatches) {
        console.error(`- ${mismatch.variantRoot}/${mismatch.relativeFilePath}`)
      }
      process.exitCode = 1
      return
    }

    console.log('Shared file sync check passed for web and tauri variants.')
    return
  }

  if (updates.length === 0) {
    console.log('No shared file updates were needed.')
    return
  }

  console.log('Updated variant files from root source:')
  for (const update of updates) {
    console.log(`- ${update.variantRoot}/${update.relativeFilePath}`)
  }
}

run().catch((error) => {
  console.error('Failed to sync app variants.', error)
  process.exit(1)
})
