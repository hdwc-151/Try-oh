import type { Config, NormalizedGarment, NormalizeMeta, RGBAImage } from '../types'
import { createCanvas } from './canvas'
import { multiStepResize } from './resize'

/**
 * TECHNICAL ARCHITECTURAL NOTE ON CANVAS ALPHA ACCURACY:
 * When Canvas 2D `getImageData` is invoked, the browser engine automatically
 * un-premultiplies alpha. For pixels with near-zero alpha (1-10/255), this precision
 * truncation can cause slight color drift.
 *
 * Therefore, our pipeline executes Phase 2 (Color Decontamination) directly on the raw
 * un-premultiplied buffer BEFORE any geometric warping or canvas scaling. This ensures
 * that edge pixels already have exact core garment pigment, completely avoiding
 * gray/white/dark edge discoloration across canvas drawImage operations.
 */

export async function exportNormalizedAssets(
  canvasImage: RGBAImage,
  meta: NormalizeMeta,
  config: Config,
): Promise<NormalizedGarment> {
  const { width, height, data } = canvasImage

  // 1. item.png: 1024x1024 transparent RGBA
  const itemCanvas = createCanvas(width, height)
  const imgData = itemCanvas.ctx.createImageData(width, height)
  imgData.data.set(data)
  itemCanvas.ctx.putImageData(imgData, 0, 0)
  const itemBlob = await itemCanvas.toBlob('image/png')

  // 2. itemFlat: composited on bgColor [242, 242, 242]
  const flatCanvas = createCanvas(width, height)
  flatCanvas.ctx.fillStyle = `rgb(${config.bgColor[0]}, ${config.bgColor[1]}, ${config.bgColor[2]})`
  flatCanvas.ctx.fillRect(0, 0, width, height)
  flatCanvas.ctx.drawImage(itemCanvas.canvas, 0, 0)
  const itemFlatBlob = await flatCanvas.toBlob('image/png')

  // 3. mask.png: grayscale alpha channel
  const maskCanvas = createCanvas(width, height)
  const maskImgData = maskCanvas.ctx.createImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3]
    const p = i * 4
    maskImgData.data[p] = a
    maskImgData.data[p + 1] = a
    maskImgData.data[p + 2] = a
    maskImgData.data[p + 3] = 255
  }
  maskCanvas.ctx.putImageData(maskImgData, 0, 0)
  const maskBlob = await maskCanvas.toBlob('image/png')

  // 4. thumb.webp: 256x256 WebP quality 0.85
  const thumbCanvas = multiStepResize(itemCanvas.canvas, width, height, 256, 256)
  let thumbBlob: Blob
  try {
    thumbBlob = await thumbCanvas.toBlob('image/webp', 0.85)
  } catch {
    // Fallback to PNG if webp export is unsupported in test/browser
    thumbBlob = await thumbCanvas.toBlob('image/png')
  }

  return {
    item: itemBlob,
    itemFlat: itemFlatBlob,
    mask: maskBlob,
    thumb: thumbBlob,
    meta,
  }
}
