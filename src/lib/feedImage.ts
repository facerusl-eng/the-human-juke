const MAX_IMAGE_DIMENSION = 800
const OUTPUT_QUALITY = 0.70
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024
// Keep base64 payload well under Supabase PostgREST's ~1 MB request limit
const MAX_DATA_URL_LENGTH = 850_000
const MIN_IMAGE_SCALE = 0.08
const MIN_OUTPUT_QUALITY = 0.20
const FALLBACK_IMAGE_DIMENSION = 480
const FALLBACK_OUTPUT_QUALITY = 0.28
const FALLBACK_MIN_IMAGE_SCALE = 0.12
const FALLBACK_MIN_OUTPUT_QUALITY = 0.16
const EMERGENCY_IMAGE_DIMENSION = 320
const EMERGENCY_OUTPUT_QUALITY = 0.18
const EMERGENCY_MIN_IMAGE_SCALE = 0.2
const EMERGENCY_MIN_OUTPUT_QUALITY = 0.1
const LAST_RESORT_IMAGE_DIMENSION = 160
const LAST_RESORT_OUTPUT_QUALITY = 0.08
const POST_RETRY_IMAGE_DIMENSION = 480
const POST_RETRY_OUTPUT_QUALITY = 0.42
const POST_RETRY_MIN_IMAGE_SCALE = 0.18
const POST_RETRY_MIN_OUTPUT_QUALITY = 0.14

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Unable to read the selected image.'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to process the selected image.'))
    image.src = source
  })
}

type RasterSource = {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

function isHeicLikeImage(file: File) {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()

  return type.includes('heic')
    || type.includes('heif')
    || name.endsWith('.heic')
    || name.endsWith('.heif')
}

async function convertHeicToJpegBlob(file: File) {
  const converterModule = await import('heic2any')
  const converter = converterModule.default

  const resultBlob = await converter({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.85,
  })

  const normalizedBlob = Array.isArray(resultBlob) ? resultBlob[0] : resultBlob

  if (!(normalizedBlob instanceof Blob)) {
    throw new Error('Unable to process this HEIC photo.')
  }

  return normalizedBlob
}

async function loadRasterSourceFromBlob(blob: Blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const imageBitmap = await createImageBitmap(blob)

      return {
        source: imageBitmap,
        width: imageBitmap.width,
        height: imageBitmap.height,
        close: () => imageBitmap.close(),
      } satisfies RasterSource
    } catch {
      // Fall through to object URL/image decoding.
    }
  }

  const objectUrl = URL.createObjectURL(blob)

  try {
    const image = await loadImage(objectUrl)

    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    } satisfies RasterSource
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function compressToDataUrl(options: {
  raster: RasterSource
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  maxDimension: number
  startQuality: number
  minQuality: number
  minScale: number
  cropSquare?: boolean
}) {
  const { raster, canvas, context, maxDimension, startQuality, minQuality, minScale, cropSquare = false } = options
  let scale = Math.min(1, maxDimension / Math.max(raster.width, raster.height))
  let quality = startQuality
  const sourceSize = Math.min(raster.width, raster.height)
  const sourceOffsetX = Math.floor((raster.width - sourceSize) / 2)
  const sourceOffsetY = Math.floor((raster.height - sourceSize) / 2)

  while (scale >= minScale) {
    const baseWidth = cropSquare ? sourceSize : raster.width
    const baseHeight = cropSquare ? sourceSize : raster.height
    const width = Math.max(1, Math.round(baseWidth * scale))
    const height = Math.max(1, Math.round(baseHeight * scale))

    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)

    if (cropSquare) {
      context.drawImage(raster.source, sourceOffsetX, sourceOffsetY, sourceSize, sourceSize, 0, 0, width, height)
    } else {
      context.drawImage(raster.source, 0, 0, width, height)
    }

    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality)

    if (compressedDataUrl.length <= MAX_DATA_URL_LENGTH) {
      return compressedDataUrl
    }

    if (quality > minQuality) {
      quality = Math.max(minQuality, quality - 0.08)
      continue
    }

    scale *= 0.85
  }

  return null
}

export async function shrinkPreparedFeedImage(dataUrl: string) {
  const trimmedDataUrl = dataUrl.trim()

  if (!trimmedDataUrl) {
    throw new Error('Unable to prepare this photo on this device. Please try again with a different photo.')
  }

  const image = await loadImage(trimmedDataUrl)
  const raster: RasterSource = {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to prepare the selected image.')
  }

  const retryPassResult = compressToDataUrl({
    raster,
    canvas,
    context,
    maxDimension: POST_RETRY_IMAGE_DIMENSION,
    startQuality: POST_RETRY_OUTPUT_QUALITY,
    minQuality: POST_RETRY_MIN_OUTPUT_QUALITY,
    minScale: POST_RETRY_MIN_IMAGE_SCALE,
  })

  if (retryPassResult) {
    return retryPassResult
  }

  const lastResortResult = compressToDataUrl({
    raster,
    canvas,
    context,
    maxDimension: LAST_RESORT_IMAGE_DIMENSION,
    startQuality: LAST_RESORT_OUTPUT_QUALITY,
    minQuality: LAST_RESORT_OUTPUT_QUALITY,
    minScale: 1,
    cropSquare: true,
  })

  if (lastResortResult) {
    return lastResortResult
  }

  throw new Error('Unable to prepare this photo on this device. Please try again with a different photo.')
}

export async function prepareFeedImage(file: File) {
  if (file.size === 0) {
    throw new Error('Please choose an image file.')
  }

  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('Image is very large. Choose a photo under 20 MB.')
  }

  let normalizedBlob: Blob = file
  let sourceDataUrl = ''

  if (isHeicLikeImage(file)) {
    try {
      normalizedBlob = await convertHeicToJpegBlob(file)
    } catch {
      // Some iOS/Safari combinations fail HEIC conversion; continue with original capture.
    }
  }

  let raster: RasterSource | null = null

  try {
    raster = await loadRasterSourceFromBlob(normalizedBlob)
  } catch (error) {
    sourceDataUrl = await readBlobAsDataUrl(normalizedBlob)

    try {
      const image = await loadImage(sourceDataUrl)
      raster = {
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      }
    } catch {
      raster = null
    }

    if (raster) {
      // Recovered through data URL decoding.
    } else if (sourceDataUrl.length <= MAX_DATA_URL_LENGTH) {
      return sourceDataUrl
    }

    if (raster) {
      // Continue to compression below.
    } else if (isHeicLikeImage(file)) {
      throw new Error('iPhone photo could not be processed. In Settings > Camera > Formats, choose Most Compatible, then try again.', {
        cause: error,
      })
    } else {
      throw new Error('Unable to process the selected image. Try a different photo.', { cause: error })
    }
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to prepare the selected image.')
  }

  if (!raster) {
    throw new Error('Unable to prepare this photo on this device. Please try again with a different photo.')
  }

  try {
    const firstPassResult = compressToDataUrl({
      raster,
      canvas,
      context,
      maxDimension: MAX_IMAGE_DIMENSION,
      startQuality: OUTPUT_QUALITY,
      minQuality: MIN_OUTPUT_QUALITY,
      minScale: MIN_IMAGE_SCALE,
    })

    if (firstPassResult) {
      return firstPassResult
    }

    const secondPassResult = compressToDataUrl({
      raster,
      canvas,
      context,
      maxDimension: FALLBACK_IMAGE_DIMENSION,
      startQuality: FALLBACK_OUTPUT_QUALITY,
      minQuality: FALLBACK_MIN_OUTPUT_QUALITY,
      minScale: FALLBACK_MIN_IMAGE_SCALE,
    })

    if (secondPassResult) {
      return secondPassResult
    }

    const thirdPassResult = compressToDataUrl({
      raster,
      canvas,
      context,
      maxDimension: EMERGENCY_IMAGE_DIMENSION,
      startQuality: EMERGENCY_OUTPUT_QUALITY,
      minQuality: EMERGENCY_MIN_OUTPUT_QUALITY,
      minScale: EMERGENCY_MIN_IMAGE_SCALE,
      cropSquare: true,
    })

    if (thirdPassResult) {
      return thirdPassResult
    }

    const lastResortResult = compressToDataUrl({
      raster,
      canvas,
      context,
      maxDimension: LAST_RESORT_IMAGE_DIMENSION,
      startQuality: LAST_RESORT_OUTPUT_QUALITY,
      minQuality: LAST_RESORT_OUTPUT_QUALITY,
      minScale: 1,
      cropSquare: true,
    })

    if (lastResortResult) {
      return lastResortResult
    }
  } finally {
    raster.close?.()
  }

  throw new Error('Unable to prepare this photo on this device. Please try again with a different photo.')
}