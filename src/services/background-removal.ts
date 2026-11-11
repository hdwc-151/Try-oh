const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALPHA_THRESHOLD = 12
const CROP_PADDING_RATIO = 0.08

export type VisiblePixelBounds = {
  x: number
  y: number
  width: number
  height: number
}

export const validateGarmentImage = (file: File): string | null => {
  if (!ALLOWED_TYPES.has(file.type)) return 'Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.'
  if (file.size > MAX_FILE_SIZE) return 'Ảnh phải nhỏ hơn hoặc bằng 10MB.'
  return null
}

export const findVisiblePixelBounds = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = ALPHA_THRESHOLD,
): VisiblePixelBounds | null => {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3]
      if (alpha <= alphaThreshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < minX || maxY < minY) return null
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

const canvasToWebpBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Không thể xuất ảnh WebP đã cắt.'))
    }, 'image/webp', 0.92)
  })

export const cropTransparentArea = async (blob: Blob): Promise<Blob> => {
  const bitmap = await createImageBitmap(blob)
  try {
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = bitmap.width
    sourceCanvas.height = bitmap.height
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
    if (!sourceContext) throw new Error('Trình duyệt không hỗ trợ xử lý canvas.')

    sourceContext.drawImage(bitmap, 0, 0)
    const imageData = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height)
    const bounds = findVisiblePixelBounds(imageData.data, bitmap.width, bitmap.height)
    if (!bounds) return blob

    const paddingX = Math.max(4, Math.round(bounds.width * CROP_PADDING_RATIO))
    const paddingY = Math.max(4, Math.round(bounds.height * CROP_PADDING_RATIO))
    const cropX = Math.max(0, bounds.x - paddingX)
    const cropY = Math.max(0, bounds.y - paddingY)
    const cropRight = Math.min(bitmap.width, bounds.x + bounds.width + paddingX)
    const cropBottom = Math.min(bitmap.height, bounds.y + bounds.height + paddingY)
    const cropWidth = cropRight - cropX
    const cropHeight = cropBottom - cropY

    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = cropWidth
    outputCanvas.height = cropHeight
    const outputContext = outputCanvas.getContext('2d')
    if (!outputContext) throw new Error('Trình duyệt không hỗ trợ xuất canvas.')

    outputContext.drawImage(
      bitmap,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    )
    return canvasToWebpBlob(outputCanvas)
  } finally {
    bitmap.close()
  }
}

export async function removeImageBackground(
  file: File,
  onProgress: (progress: number) => void,
  options: { cropTransparentArea?: boolean } = {},
): Promise<Blob> {
  const { removeBackground } = await import('@imgly/background-removal')
  onProgress(2)
  const result = await removeBackground(file, {
    model: 'isnet_fp16',
    output: { format: 'image/webp', quality: 0.92, type: 'foreground' },
    progress: (_key: string, current: number, total: number) => {
      if (total > 0) onProgress(Math.min(95, Math.round((current / total) * 90)))
    },
  })
  onProgress(96)
  const croppedResult = options.cropTransparentArea === false
    ? result
    : await cropTransparentArea(result).catch(() => result)
  onProgress(100)
  return croppedResult
}
