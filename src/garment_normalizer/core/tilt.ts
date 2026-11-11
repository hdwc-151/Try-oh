import type { Category, Config } from '../types'
import { SYMMETRIC_CATEGORIES } from '../types'

export interface TiltAnalysisResult {
  rotationApplied: number
  symmetryScore: number
  flags: string[]
  needsReview: boolean
}

/**
 * Computes the symmetry IoU for a downsampled binary mask rotated by angleDeg around center.
 * Flips horizontally across the vertical midline xc of the rotated mask's bounding box.
 */
export function computeMaskSymmetryIoU(
  padM: Uint8Array,
  diag: number,
  cx: number,
  cy: number,
  angleDeg: number,
): { iou: number; xc: number } {
  const rad = (angleDeg * Math.PI) / 180.0
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  // 1. Rotate mask around (cx, cy) using reverse coordinate lookup
  const rotated = new Uint8Array(diag * diag)
  let minX = diag
  let maxX = -1

  for (let y = 0; y < diag; y++) {
    const row = y * diag
    const dy = y - cy
    for (let x = 0; x < diag; x++) {
      const dx = x - cx
      // Canvas clockwise rotation: forward is (dx*cos - dy*sin, dx*sin + dy*cos)
      // Reverse is (dx*cos + dy*sin, -dx*sin + dy*cos)
      const srcX = Math.round(cx + dx * cos + dy * sin)
      const srcY = Math.round(cy - dx * sin + dy * cos)

      if (srcX >= 0 && srcX < diag && srcY >= 0 && srcY < diag) {
        if (padM[srcY * diag + srcX] === 1) {
          rotated[row + x] = 1
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        }
      }
    }
  }

  if (maxX < minX) {
    return { iou: 0, xc: cx }
  }

  const xc = (minX + maxX) / 2.0

  // 2. Compute IoU between rotated mask and its horizontal reflection across line x = xc
  let intersection = 0
  let rotatedCount = 0

  for (let y = 0; y < diag; y++) {
    const row = y * diag
    for (let x = minX; x <= maxX; x++) {
      if (rotated[row + x] === 1) {
        rotatedCount++
        const flipX = Math.round(2 * xc - x)
        if (flipX >= 0 && flipX < diag && rotated[row + flipX] === 1) {
          intersection++
        }
      }
    }
  }

  const union = rotatedCount * 2 - intersection
  const iou = union > 0 ? intersection / union : 0
  return { iou, xc }
}

/**
 * Searches for optimal tilt angle to straighten symmetric garments.
 * 1. Downscales mask to 256px max dimension.
 * 2. Scans coarse angles (-maxTiltDeg..+maxTiltDeg step 3 deg).
 * 3. Scans fine angles around peak (step 0.5 deg).
 * 4. Checks wide angles to detect tilt_too_large (> 15 deg).
 */
export function findOptimalTilt(
  M: Uint8Array,
  width: number,
  height: number,
  category: Category,
  config: Config,
): TiltAnalysisResult {
  const flags: string[] = []

  // Shoes, bags, accessories do NOT auto-rotate
  if (!SYMMETRIC_CATEGORIES.has(category)) {
    return {
      rotationApplied: 0,
      symmetryScore: 1.0,
      flags,
      needsReview: false,
    }
  }

  // Downsample M to max dimension 256px
  const scale = 256.0 / Math.max(width, height)
  const smallW = Math.max(1, Math.round(width * scale))
  const smallH = Math.max(1, Math.round(height * scale))
  const smallM = new Uint8Array(smallW * smallH)

  for (let sy = 0; sy < smallH; sy++) {
    const y0 = Math.floor(sy / scale)
    const y1 = Math.min(height, Math.floor((sy + 1) / scale))
    const sRow = sy * smallW

    for (let sx = 0; sx < smallW; sx++) {
      const x0 = Math.floor(sx / scale)
      const x1 = Math.min(width, Math.floor((sx + 1) / scale))

      let sum = 0
      let total = 0
      for (let y = y0; y < y1; y++) {
        const row = y * width
        for (let x = x0; x < x1; x++) {
          sum += M[row + x]
          total++
        }
      }
      if (total > 0 && sum / total >= 0.5) {
        smallM[sRow + sx] = 1
      }
    }
  }

  // Pad into square of size diagonal to prevent clipping
  const diag = Math.ceil(Math.hypot(smallW, smallH)) + 16
  const padM = new Uint8Array(diag * diag)
  const ox = Math.floor((diag - smallW) / 2)
  const oy = Math.floor((diag - smallH) / 2)

  let sumX = 0
  let sumY = 0
  let totalArea = 0

  for (let sy = 0; sy < smallH; sy++) {
    const sRow = sy * smallW
    const pRow = (oy + sy) * diag
    for (let sx = 0; sx < smallW; sx++) {
      if (smallM[sRow + sx] === 1) {
        padM[pRow + (ox + sx)] = 1
        sumX += ox + sx
        sumY += oy + sy
        totalArea++
      }
    }
  }

  if (totalArea === 0) {
    return {
      rotationApplied: 0,
      symmetryScore: 0,
      flags: ['low_symmetry'],
      needsReview: true,
    }
  }

  const cx = sumX / totalArea
  const cy = sumY / totalArea

  // 1. Wide scan (-45..+45, step 3) to test for large tilts
  // Here `tilt` represents the estimated tilt of the garment.
  // Rotating by `-tilt` attempts to straighten the mask.
  let wideBestTilt = 0
  let wideBestScore = -1
  for (let tilt = -45; tilt <= 45; tilt += 3) {
    const { iou } = computeMaskSymmetryIoU(padM, diag, cx, cy, -tilt)
    if (iou > wideBestScore) {
      wideBestScore = iou
      wideBestTilt = tilt
    }
  }

  // 2. Coarse in-range scan (-maxTiltDeg..+maxTiltDeg step 3)
  const maxTilt = config.maxTiltDeg
  let coarseBestTilt = 0
  let coarseBestScore = -1
  for (let tilt = -maxTilt; tilt <= maxTilt + 0.1; tilt += 3) {
    const { iou } = computeMaskSymmetryIoU(padM, diag, cx, cy, -tilt)
    if (iou > coarseBestScore) {
      coarseBestScore = iou
      coarseBestTilt = tilt
    }
  }

  // 3. Fine in-range scan around peak (±3 deg, step 0.5)
  let fineBestTilt = coarseBestTilt
  let fineBestScore = coarseBestScore
  const minFine = Math.max(-maxTilt, coarseBestTilt - 3)
  const maxFine = Math.min(maxTilt, coarseBestTilt + 3)

  for (let tilt = minFine; tilt <= maxFine + 0.01; tilt += 0.5) {
    const { iou } = computeMaskSymmetryIoU(padM, diag, cx, cy, -tilt)
    if (iou > fineBestScore) {
      fineBestScore = iou
      fineBestTilt = tilt
    }
  }

  // 4. Evaluate tilt_too_large:
  if (
    Math.abs(wideBestTilt) > maxTilt &&
    wideBestScore >= config.symmetryThr &&
    wideBestScore - fineBestScore >= 0.03
  ) {
    flags.push('tilt_too_large')
    return {
      rotationApplied: 0,
      symmetryScore: wideBestScore,
      flags,
      needsReview: true,
    }
  }

  // 5. Evaluate low_symmetry:
  if (fineBestScore < config.symmetryThr) {
    flags.push('low_symmetry')
    return {
      rotationApplied: 0,
      symmetryScore: fineBestScore,
      flags,
      needsReview: true,
    }
  }

  // Step 5: If |tilt| <= maxTiltDeg and symmetryScore >= symmetryThr:
  // Apply rotation (-tilt) to straighten the image.
  const rotationApplied = -fineBestTilt

  return {
    rotationApplied: Math.abs(rotationApplied) < 0.2 ? 0 : rotationApplied,
    symmetryScore: fineBestScore,
    flags,
    needsReview: false,
  }
}
