type Mp4TranscodeOptions = {
  inputName?: string
  outputName?: string
  hasAudio: boolean
  onStatus?: (message: string) => void
}

type FfmpegLike = {
  load: (config: { coreURL: string, wasmURL: string }) => Promise<void>
  writeFile: (path: string, data: Uint8Array) => Promise<void>
  on: (event: string, callback: (entry: { message?: string }) => void) => void
  exec: (args: string[]) => Promise<number>
  readFile: (path: string) => Promise<Uint8Array>
  deleteFile: (path: string) => Promise<void>
}

let ffmpegInstancePromise: Promise<{
  ffmpeg: FfmpegLike
}> | null = null

async function getFfmpeg() {
  if (!ffmpegInstancePromise) {
    ffmpegInstancePromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ])

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
      const ffmpeg = new FFmpeg()

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      })

      return { ffmpeg }
    })()
  }

  return ffmpegInstancePromise
}

export async function transcodeWebmToMp4(inputBlob: Blob, options: Mp4TranscodeOptions): Promise<Blob> {
  const ffmpegBundle = await getFfmpeg()
  if (!ffmpegBundle) {
    throw new Error('Could not initialize MP4 export engine.')
  }

  const { ffmpeg } = ffmpegBundle
  const inputName = options.inputName ?? 'input.webm'
  const outputName = options.outputName ?? 'output.mp4'

  options.onStatus?.('Preparing MP4 export engine...')

  const bytes = new Uint8Array(await inputBlob.arrayBuffer())
  await ffmpeg.writeFile(inputName, bytes)

  options.onStatus?.('Encoding MP4...')

  ffmpeg.on('log', (entry: { message?: string }) => {
    if (!entry?.message) {
      return
    }

    if (/frame=|time=|speed=|Error|failed/i.test(entry.message)) {
      options.onStatus?.(entry.message)
    }
  })

  const args = options.hasAudio
    ? [
        '-i',
        inputName,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        outputName,
      ]
    : [
        '-i',
        inputName,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        outputName,
      ]

  const exitCode = await ffmpeg.exec(args)
  if (exitCode !== 0) {
    throw new Error(`MP4 encoding failed with exit code ${exitCode}.`)
  }

  const outputBytes = await ffmpeg.readFile(outputName)

  await Promise.allSettled([
    ffmpeg.deleteFile(inputName),
    ffmpeg.deleteFile(outputName),
  ])

  return new Blob([outputBytes], { type: 'video/mp4' })
}
