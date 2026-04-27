const MAX_IMAGE_DIMENSION = 800
const OUTPUT_QUALITY = 0.70
const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024
// Keep base64 payload well under Supabase PostgREST's ~1 MB request limit
const MAX_DATA_URL_LENGTH = 500_000
const MIN_IMAGE_SCALE = 0.35
const MIN_OUTPUT_QUALITY = 0.45

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Unable to read the selected image.'))
    reader.readAsDataURL(file)
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

function isHeicLikeImage(file: File) {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()

  return type.includes('heic')
    || type.includes('heif')
    || name.endsWith('.heic')
    || name.endsWith('.heif')
}

export async function prepareFeedImage(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }

  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('Image is very large. Choose a photo under 20 MB.')
  }

  const sourceDataUrl = await readFileAsDataUrl(file)
  let image: HTMLImageElement

  try {
    image = await loadImage(sourceDataUrl)
  } catch {
    if (isHeicLikeImage(file)) {
      throw new Error('This phone photo format is not supported here yet. Save/export as JPG and try again.')
    }

    throw new Error('Unable to process the selected image.')
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to prepare the selected image.')
  }

  let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height))
  let quality = OUTPUT_QUALITY

  while (scale >= MIN_IMAGE_SCALE) {
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))

    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality)

    if (compressedDataUrl.length <= MAX_DATA_URL_LENGTH) {
      return compressedDataUrl
    }

    if (quality > MIN_OUTPUT_QUALITY) {
      quality = Math.max(MIN_OUTPUT_QUALITY, quality - 0.08)
      continue
    }

    scale *= 0.85
  }

  throw new Error('Image is too large after compression. Choose a smaller photo.')
}