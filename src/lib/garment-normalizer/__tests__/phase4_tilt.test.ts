import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../types'
import { findOptimalTilt } from '../core/tilt'

function makeSyntheticTshirtMask(size = 500, tiltDeg = 0): Uint8Array {
  const mask = new Uint8Array(size * size)
  const cx = size / 2
  const cy = size / 2

  const rad = (tiltDeg * Math.PI) / 180.0
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const bodyW = 160
  const bodyH = 260

  // Draw torso and sleeves directly in upright space, then transform
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Reverse rotate to check upright coordinates
      const dx = x - cx
      const dy = y - cy
      const ux = cx + dx * cos + dy * sin
      const uy = cy - dx * sin + dy * cos

      // Check if inside torso: [cx - 80, cx + 80] x [cy - 130, cy + 130]
      const inTorso =
        ux >= cx - bodyW / 2 &&
        ux <= cx + bodyW / 2 &&
        uy >= cy - bodyH / 2 &&
        uy <= cy + bodyH / 2

      // Check left sleeve: triangle from (cx - 80, cy - 130) to (cx - 150, cy - 30)
      const inLeftSleeve =
        ux >= cx - bodyW / 2 - 70 &&
        ux <= cx - bodyW / 2 &&
        uy >= cy - bodyH / 2 &&
        uy <= cy - bodyH / 2 + 100

      // Check right sleeve: mirror
      const inRightSleeve =
        ux >= cx + bodyW / 2 &&
        ux <= cx + bodyW / 2 + 70 &&
        uy >= cy - bodyH / 2 &&
        uy <= cy - bodyH / 2 + 100

      if (inTorso || inLeftSleeve || inRightSleeve) {
        mask[y * size + x] = 1
      }
    }
  }

  return mask
}

describe('Phase 4: Tilt Correction', () => {
  it('skips non-symmetric categories (shoes, bag, accessory)', () => {
    const size = 500
    const M = makeSyntheticTshirtMask(size, 10)
    const result = findOptimalTilt(M, size, size, 'shoes', DEFAULT_CONFIG)

    expect(result.rotationApplied).toBe(0)
    expect(result.flags).toHaveLength(0)
    expect(result.needsReview).toBe(false)
  })

  it('corrects a +10 degree tilt on a top', () => {
    const size = 500
    const M = makeSyntheticTshirtMask(size, 10.0)
    const result = findOptimalTilt(M, size, size, 'top', DEFAULT_CONFIG)

    // To straighten a +10 deg tilt, rotation applied should be approx -10 deg
    expect(Math.abs(result.rotationApplied - -10.0)).toBeLessThanOrEqual(1.0)
    expect(result.symmetryScore).toBeGreaterThanOrEqual(0.85)
    expect(result.needsReview).toBe(false)
  })

  it('flags tilt_too_large when tilt exceeds 15 degrees', () => {
    const size = 500
    const M = makeSyntheticTshirtMask(size, 25.0)
    const result = findOptimalTilt(M, size, size, 'top', DEFAULT_CONFIG)

    expect(result.rotationApplied).toBe(0)
    expect(result.flags).toContain('tilt_too_large')
    expect(result.needsReview).toBe(true)
  })

  it('flags low_symmetry on strongly asymmetric garments', () => {
    const size = 400
    const M = new Uint8Array(size * size)

    // Strongly asymmetric L-shape / one-shoulder dress
    for (let y = 100; y < 300; y++) {
      for (let x = 120; x < 260; x++) {
        M[y * size + x] = 1
      }
    }
    // Only one side has an extra protruding wing
    for (let y = 200; y < 300; y++) {
      for (let x = 260; x < 350; x++) {
        M[y * size + x] = 1
      }
    }

    const result = findOptimalTilt(M, size, size, 'dress', DEFAULT_CONFIG)
    expect(result.rotationApplied).toBe(0)
    expect(result.flags).toContain('low_symmetry')
    expect(result.needsReview).toBe(true)
  })
})
