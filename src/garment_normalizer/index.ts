/**
 * Garment Normalizer (Client-side TypeScript / Vite / React 18)
 * Standardizes pre-background-removed garment images.
 */

export * from './types'
export { normalize } from './core/pipeline'
export { cleanGarmentMask } from './core/mask'
export { decontaminateGarment } from './core/decontaminate'
export { evaluateQuality, FLAG_DESCRIPTIONS_VI } from './core/quality'
export { findOptimalTilt } from './core/tilt'
export { planGarmentPlacement, findTightBoundingBox } from './core/layout'

export { loadBlobToRGBAImage } from './io/load'
export { exportNormalizedAssets } from './io/export'
export { normalizeBlob, workerClient } from './io/worker-client'

export { useGarmentNormalizer } from './hook/useGarmentNormalizer'
export { GarmentPreview } from './components/GarmentPreview'

import type { Category, NormalizedGarment, NormalizeOptions } from './types'
import { normalizeBlob } from './io/worker-client'

/**
 * Example end-to-end integration function:
 * Receives the transparent Blob produced by @imgly/background-removal (or manual cleanup)
 * and feeds it through the garment normalizer pipeline.
 */
export async function normalizeAfterBackgroundRemoval(
  processedBlob: Blob,
  category: Category,
  options?: Partial<NormalizeOptions>,
): Promise<NormalizedGarment> {
  return normalizeBlob(processedBlob, {
    category,
    scaleMode: 'fit',
    ...options,
  })
}
