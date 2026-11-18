import type { BoundingBox, Category, Config, ScaleMode } from '../types'
import { REL_FACTORS, SYMMETRIC_CATEGORIES } from '../types'

export interface PlacementPlan {
  cropBox: BoundingBox
  scale: number
  newW: number
  newH: number
  destX: number
  destY: number
  xSymInCanvas: number
  anchor: { x: number; y: number }
  bboxInCanvas: BoundingBox
  flags: string[]
}

/**
 * Finds tight bounding box on alpha > alphaThr.
 * Returns [xmin, ymin, width, height].
 */
export function findTightBoundingBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThr = 20,
): BoundingBox {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3] > alphaThr) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return [0, 0, width, height]
  }

  return [minX, minY, maxX - minX + 1, maxY - minY + 1]
}

/**
 * Computes horizontal symmetry axis xSym relative to the cropped item coordinates [0..cropW-1].
 */
export function computeSymmetryAxis(
  data: Uint8ClampedArray,
  cropBox: BoundingBox,
  imageWidth: number,
  category: Category,
  symmetryScore: number,
  symmetryThr = 0.80,
  alphaThr = 20,
): number {
  const [minX, minY, cropW, cropH] = cropBox

  if (SYMMETRIC_CATEGORIES.has(category) && symmetryScore >= symmetryThr) {
    let firstX = cropW
    let lastX = -1

    for (let cy = 0; cy < cropH; cy++) {
      const y = minY + cy
      const row = y * imageWidth
      for (let cx = 0; cx < cropW; cx++) {
        const x = minX + cx
        if (data[(row + x) * 4 + 3] > alphaThr) {
          if (cx < firstX) firstX = cx
          if (cx > lastX) lastX = cx
        }
      }
    }

    if (lastX >= firstX) {
      return (firstX + lastX) / 2.0
    }
  }

  return (cropW - 1) / 2.0
}

/**
 * Computes the scaling factor and placement plan for canvas framing.
 */
export function planGarmentPlacement(
  cropBox: BoundingBox,
  xSym: number,
  category: Category,
  config: Config,
  scaleMode: ScaleMode = 'fit',
  sizeCm?: number,
): PlacementPlan {
  const flags: string[] = []
  const [, , cropW, cropH] = cropBox
  const C = config.canvas
  const targetBox = C * (1.0 - 2.0 * config.margin)

  let scale = 1.0

  if (scaleMode === 'relative') {
    if (sizeCm !== undefined && sizeCm > 0) {
      // Physical size mapping: (canvas * 0.9 / 100cm) * sizeCm
      const targetItemPx = Math.min((C * 0.9 / 100.0) * sizeCm, targetBox)
      scale = targetItemPx / Math.max(cropW, cropH)
    } else {
      const rel = REL_FACTORS[category] ?? 0.86
      const targetMaxDim = Math.min(C * rel, targetBox)
      scale = targetMaxDim / Math.max(cropW, cropH)
    }
  } else {
    // 'fit' mode
    scale = Math.min(targetBox / cropW, targetBox / cropH)
  }

  // Upscale cap
  if (scale > config.upscaleCap) {
    scale = config.upscaleCap
    flags.push('upscaled_limit')
  }

  const newW = Math.max(1, Math.round(cropW * scale))
  const newH = Math.max(1, Math.round(cropH * scale))

  // Horizontal placement: xSym aligned at C / 2
  const scaledXSym = xSym * scale
  const destX = Math.round(C / 2.0 - scaledXSym)

  // Vertical placement
  let destY = 0
  if (category === 'shoes') {
    // Shoes: bottom of sole aligned at baseline C * (1 - margin - 0.08)
    const baselineY = C * (1.0 - config.margin - 0.08)
    destY = Math.round(baselineY - newH)
  } else {
    // Others: centered vertically
    destY = Math.round(C / 2.0 - newH / 2.0)
  }

  // Check overflow
  if (destX < 0 || destY < 0 || destX + newW > C || destY + newH > C) {
    flags.push('overflow')
  }

  const xSymInCanvas = destX + scaledXSym
  const bboxInCanvas: BoundingBox = [
    Math.max(0, destX),
    Math.max(0, destY),
    Math.min(C - Math.max(0, destX), newW),
    Math.min(C - Math.max(0, destY), newH),
  ]

  const anchor = {
    x: xSymInCanvas,
    y: category === 'shoes' ? destY + newH : destY + newH / 2.0,
  }

  return {
    cropBox,
    scale,
    newW,
    newH,
    destX,
    destY,
    xSymInCanvas,
    anchor,
    bboxInCanvas,
    flags,
  }
}

/**
 * Pure TypeScript blit of cropped & scaled image into canvas (used in tests and fallback).
 */
export function blitToCanvas(
  srcData: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  plan: PlacementPlan,
  canvasSize = 1024,
): { canvasData: Uint8ClampedArray; canvasMask: Uint8Array } {
  const canvasData = new Uint8ClampedArray(canvasSize * canvasSize * 4)
  const canvasMask = new Uint8Array(canvasSize * canvasSize)

  const [cropX, cropY, cropW, cropH] = plan.cropBox
  const { destX, destY, newW, newH } = plan

  // Bilinear or nearest sampling from crop area to canvas
  for (let dy = 0; dy < newH; dy++) {
    const cy = destY + dy
    if (cy < 0 || cy >= canvasSize) continue
    const canvasRow = cy * canvasSize

    const sy = Math.min(cropH - 1, Math.floor(dy * (cropH / newH)))
    const srcY = cropY + sy
    const srcRow = srcY * srcWidth

    for (let dx = 0; dx < newW; dx++) {
      const cx = destX + dx
      if (cx < 0 || cx >= canvasSize) continue

      const sx = Math.min(cropW - 1, Math.floor(dx * (cropW / newW)))
      const srcX = cropX + sx

      const sIdx = (srcRow + srcX) * 4
      const cIdx = (canvasRow + cx) * 4

      const a = srcData[sIdx + 3]
      if (a > 0) {
        canvasData[cIdx] = srcData[sIdx]
        canvasData[cIdx + 1] = srcData[sIdx + 1]
        canvasData[cIdx + 2] = srcData[sIdx + 2]
        canvasData[cIdx + 3] = a
        canvasMask[canvasRow + cx] = a > 20 ? 1 : 0
      }
    }
  }

  return { canvasData, canvasMask }
}
