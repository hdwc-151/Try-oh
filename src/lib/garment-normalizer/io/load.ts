import type { RGBAImage } from '../types'
import { createCanvas } from './canvas'
import { multiStepResize } from './resize'

/**
 * Loads an image Blob/File into an RGBAImage.
 * - Applies EXIF orientation via createImageBitmap({ imageOrientation: 'from-image' }).
 * - Downscales if max dimension > maxInputPx using multi-step halving.
 */
export async function loadBlobToRGBAImage(
  blob: Blob,
  maxInputPx = 2048,
): Promise<RGBAImage> {
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: 'from-image',
  })

  let width = bitmap.width
  let height = bitmap.height
  const maxDim = Math.max(width, height)

  let sourceCanvas = createCanvas(width, height)
  sourceCanvas.ctx.drawImage(bitmap, 0, 0)

  if (maxDim > maxInputPx) {
    const scale = maxInputPx / maxDim
    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))

    sourceCanvas = multiStepResize(bitmap, width, height, targetW, targetH)
    width = targetW
    height = targetH
  }

  const imgData = sourceCanvas.ctx.getImageData(0, 0, width, height)
  return {
    data: imgData.data,
    width,
    height,
  }
}
