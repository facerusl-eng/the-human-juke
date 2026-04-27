const MAX_IMAGE_DIMENSION = 800
const OUTPUT_QUALITY = 0.70
// Keep base64 payload well under Supabase PostgREST's ~1 MB request limit
const MAX_DATA_URL_LENGTH = 500_000

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

export async function prepareFeedImage(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.')
  }

  const sourceDataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(sourceDataUrl)

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to prepare the selected image.')
  }

  context.drawImage(image, 0, 0, width, height)

  // Always output JPEG — PNG from phone cameras can be several MB even after scaling
  const compressedDataUrl = canvas.toDataURL('image/jpeg', OUTPUT_QUALITY)

  if (compressedDataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error('Image is too large after compression. Choose a smaller photo.')
  }

  return compressedDataUrl
}