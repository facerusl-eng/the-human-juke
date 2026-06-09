import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

const projectRoot = process.cwd()
const inputPath = join(projectRoot, 'public', 'videos', 'human-jukebox-story-promo-concept-hq.webm')
const outputPath = join(projectRoot, 'public', 'videos', 'human-jukebox-story-promo-concept-hq-1080x1920.mp4')

if (!existsSync(inputPath)) {
  console.error(`Input video not found: ${inputPath}`)
  process.exit(1)
}

mkdirSync(dirname(outputPath), { recursive: true })

const args = [
  '-y',
  '-i', inputPath,
  '-vf', 'scale=1080:1920:flags=lanczos,fps=30',
  '-c:v', 'libx264',
  '-profile:v', 'high',
  '-preset', 'slow',
  '-crf', '16',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
  outputPath,
]

console.log('Encoding HD MP4...')
const result = spawnSync(ffmpegPath, args, { stdio: 'inherit' })

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log(`Saved: ${outputPath}`)
