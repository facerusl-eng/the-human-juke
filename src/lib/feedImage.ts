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

function isHeicLikeImage(file: File) {
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()

  return type.includes('heic')
    || type.includes('heif')
    || name.endsWith('.heic')
    || name.endsWith('.heif')
}

function hasLikelyImageName(file: File) {
  const name = file.name.toLowerCase()

  return name.endsWith('.jpg')
    || name.endsWith('.jpeg')
    || name.endsWith('.png')
    || name.endsWith('.webp')
    || name.endsWith('.gif')
    || name.endsWith('.bmp')
    || name.endsWith('.heic')
    || name.endsWith('.heif')
}

async function convertHeicToJpegDataUrl(file: File) {
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

  return readBlobAsDataUrl(normalizedBlob)
}

export async function prepareFeedImage(file: File) {
  console.log('prepareFeedImage: started', { name: file.name, size: file.size, type: file.type })

  if (file.size === 0) {
    console.log('prepareFeedImage: file is empty')
    throw new Error('Please choose an image file.')
  }

  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    console.log('prepareFeedImage: file too large', { size: file.size, max: MAX_SOURCE_IMAGE_BYTES })
    throw new Error('Image is very large. Choose a photo under 20 MB.')
  }

  let sourceDataUrl = await readFileAsDataUrl(file)
  console.log('prepareFeedImage: file read complete', { dataUrlLength: sourceDataUrl.length })

  if (isHeicLikeImage(file)) {
    console.log('prepareFeedImage: detected HEIC/HEIF, converting...')
    try {
      sourceDataUrl = await convertHeicToJpegDataUrl(file)
      console.log('prepareFeedImage: HEIC conversion success')
    } catch {
      console.log('prepareFeedImage: HEIC conversion failed')
      throw new Error('This phone photo format could not be converted. In Camera settings, choose Most Compatible (JPG), then try again.')
    }
  }

  let image: HTMLImageElement

  try {
    console.log('prepareFeedImage: loading image from data URL...')
    image = await loadImage(sourceDataUrl)
    console.log('prepareFeedImage: image loaded', { width: image.width, height: image.height })
  } catch (error) {
    console.log('prepareFeedImage: image load failed', { error: String(error) })
    if (isHeicLikeImage(file)) {
      throw new Error('This phone photo format is not supported here yet. Save/export as JPG and try again.')
    }

    throw new Error('Unable to process the selected image. Try a different photo.')
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    console.log('prepareFeedImage: canvas context creation failed')
    throw new Error('Unable to prepare the selected image.')
  }

  let scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height))
  let quality = OUTPUT_QUALITY
  console.log('prepareFeedImage: compression loop starting', { initialScale: scale })

  while (scale >= MIN_IMAGE_SCALE) {
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))

    canvas.width = width
    canvas.height = height
    context.clearRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const compressedDataUrl = canvas.toDataURL('image/jpeg', quality)

    if (compressedDataUrl.length <= MAX_DATA_URL_LENGTH) {
      console.log('prepareFeedImage: compression successful', { finalScale: scale, finalQuality: quality, dataUrlLength: compressedDataUrl.length })
      return compressedDataUrl
    }

    if (quality > MIN_OUTPUT_QUALITY) {
      quality = Math.max(MIN_OUTPUT_QUALITY, quality - 0.08)
      continue
    }

    scale *= 0.85
  }

  console.log('prepareFeedImage: compression failed - image too large even after aggressive compression')
  throw new Error('Image is too large after compression. Choose a smaller photo.')
}