import type {
  Category,
  Config,
  CoreNormalizeResult,
  NormalizeMeta,
  RGBAImage,
  ScaleMode,
  Status,
} from '../types'
import { DEFAULT_CONFIG } from '../types'
import { decontaminateGarment } from './decontaminate'
import { blitToCanvas, computeSymmetryAxis, findTightBoundingBox, planGarmentPlacement } from './layout'
import { cleanGarmentMask } from './mask'
import { evaluateQuality } from './quality'
import { findOptimalTilt } from './tilt'

/**
 * Pure TypeScript garment normalization pipeline operating entirely in-memory on RGBAImage.
 * Has zero DOM dependencies, allowing direct execution in Node, Vitest, or Web Workers.
 */
export function normalize(
  image: RGBAImage,
  category: Category,
  configOverrides?: Partial<Config>,
  scaleMode: ScaleMode = 'fit',
  sizeCm?: number,
  manualRotationDeg?: number,
): CoreNormalizeResult {
  const config: Config = { ...DEFAULT_CONFIG, ...configOverrides }
  const timingsMs: Record<string, number> = {}

  const origWidth = image.width
  const origHeight = image.height
  const data = new Uint8ClampedArray(image.data)

  // 1. Phase 1: Cleaning mask
  const t0 = performance.now()
  const { M, retainedCount } = cleanGarmentMask(
    data,
    origWidth,
    origHeight,
    category,
    config.alphaThr,
  )
  timingsMs.phase1_mask = performance.now() - t0

  // 2. Phase 3: Quality check
  const t1 = performance.now()
  const quality = evaluateQuality(
    data,
    M,
    origWidth,
    origHeight,
    retainedCount,
    config,
  )
  timingsMs.phase3_quality = performance.now() - t1

  const flags = [...quality.flags]
  let status: Status = quality.status
  let needsReview = quality.needsReview

  // If rejected, halt and return early with metadata
  if (status === 'REJECT') {
    const meta: NormalizeMeta = {
      category,
      status: 'REJECT',
      flags,
      needsReview: true,
      rejectReason: quality.rejectReason,
      rotationApplied: 0,
      symmetryScore: 0,
      scaleFactor: 1,
      xSymInCanvas: config.canvas / 2,
      bboxInCanvas: quality.bbox,
      anchor: { x: config.canvas / 2, y: config.canvas / 2 },
      timingsMs,
      originalSize: [origWidth, origHeight],
      itemSizePx: [quality.bbox[2], quality.bbox[3]],
      scaleMode,
      sizeCm,
    }
    return {
      image: { data, width: origWidth, height: origHeight },
      mask: M,
      meta,
    }
  }

  // 3. Phase 2: Color decontamination
  const t2 = performance.now()
  decontaminateGarment(data, origWidth, origHeight)
  timingsMs.phase2_decontam = performance.now() - t2

  // 4. Phase 4: Tilt correction
  const t3 = performance.now()
  let rotationApplied = 0
  let symmetryScore = 1.0

  if (manualRotationDeg !== undefined) {
    rotationApplied = manualRotationDeg
  } else {
    const tiltResult = findOptimalTilt(M, origWidth, origHeight, category, config)
    rotationApplied = tiltResult.rotationApplied
    symmetryScore = tiltResult.symmetryScore
    flags.push(...tiltResult.flags)
    if (tiltResult.needsReview) {
      needsReview = true
      if (status === 'OK') status = 'WARN'
    }
  }

  let rotatedData = data
  let rotatedWidth = origWidth
  let rotatedHeight = origHeight

  // If rotation is required, rotate onto a diagonal-padded canvas
  if (Math.abs(rotationApplied) >= 0.2) {
    const diag = Math.ceil(Math.hypot(origWidth, origHeight)) + 16
    const padData = new Uint8ClampedArray(diag * diag * 4)

    const ox = Math.floor((diag - origWidth) / 2)
    const oy = Math.floor((diag - origHeight) / 2)

    // Center of original content in pad canvas
    const cx = diag / 2
    const cy = diag / 2

    const rad = (rotationApplied * Math.PI) / 180.0
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)

    for (let py = 0; py < diag; py++) {
      const pRow = py * diag
      const dy = py - cy
      for (let px = 0; px < diag; px++) {
        const dx = px - cx
        // Reverse rotate
        const sx = cx + dx * cos + dy * sin
        const sy = cy - dx * sin + dy * cos

        // Map back to original image
        const oxX = sx - ox
        const oxY = sy - oy

        if (oxX >= 0 && oxX < origWidth && oxY >= 0 && oxY < origHeight) {
          const ix = Math.floor(oxX)
          const iy = Math.floor(oxY)
          const sIdx = (iy * origWidth + ix) * 4
          const dIdx = (pRow + px) * 4

          padData[dIdx] = data[sIdx]
          padData[dIdx + 1] = data[sIdx + 1]
          padData[dIdx + 2] = data[sIdx + 2]
          padData[dIdx + 3] = data[sIdx + 3]
        }
      }
    }

    rotatedData = padData
    rotatedWidth = diag
    rotatedHeight = diag
  }
  timingsMs.phase4_tilt = performance.now() - t3

  // 5. Phase 5: Crop, scale, and placement plan
  const t4 = performance.now()
  const cropBox = findTightBoundingBox(
    rotatedData,
    rotatedWidth,
    rotatedHeight,
    config.alphaThr,
  )
  const xSym = computeSymmetryAxis(
    rotatedData,
    cropBox,
    rotatedWidth,
    category,
    symmetryScore,
    config.symmetryThr,
    config.alphaThr,
  )
  const plan = planGarmentPlacement(
    cropBox,
    xSym,
    category,
    config,
    scaleMode,
    sizeCm,
  )

  flags.push(...plan.flags)
  if (plan.flags.includes('overflow')) {
    needsReview = true
    if (status === 'OK') status = 'WARN'
  }

  // Blit onto 1024x1024 canvas
  const { canvasData, canvasMask } = blitToCanvas(
    rotatedData,
    rotatedWidth,
    rotatedHeight,
    plan,
    config.canvas,
  )
  timingsMs.phase5_layout = performance.now() - t4

  timingsMs.total = Object.values(timingsMs).reduce((a, b) => a + b, 0)

  const meta: NormalizeMeta = {
    category,
    status,
    flags: Array.from(new Set(flags)),
    needsReview,
    rotationApplied,
    symmetryScore,
    scaleFactor: plan.scale,
    xSymInCanvas: plan.xSymInCanvas,
    bboxInCanvas: plan.bboxInCanvas,
    anchor: plan.anchor,
    timingsMs,
    originalSize: [origWidth, origHeight],
    itemSizePx: [plan.newW, plan.newH],
    scaleMode,
    sizeCm,
  }

  return {
    image: { data: canvasData, width: config.canvas, height: config.canvas },
    mask: canvasMask,
    meta,
  }
}
