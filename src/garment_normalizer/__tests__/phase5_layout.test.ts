import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../types'
import { findTightBoundingBox, planGarmentPlacement } from '../core/layout'

describe('Phase 5: Layout & Placement', () => {
  it('computes tight bounding box', () => {
    const width = 200
    const height = 200
    const data = new Uint8ClampedArray(width * height * 4)

    // Box at [40:90, 50:110] (height=50, width=60)
    for (let y = 40; y < 90; y++) {
      for (let x = 50; x < 110; x++) {
        data[(y * width + x) * 4 + 3] = 255
      }
    }

    const bbox = findTightBoundingBox(data, width, height, 20)
    expect(bbox).toEqual([50, 40, 60, 50])
  })

  it('centers garment horizontally and vertically in fit mode', () => {
    const cropBox: [number, number, number, number] = [0, 0, 400, 600]
    const xSym = 199.5

    const plan = planGarmentPlacement(
      cropBox,
      xSym,
      'top',
      DEFAULT_CONFIG,
      'fit',
    )

    // xSymInCanvas should be at 512 (canvas/2)
    expect(Math.abs(plan.xSymInCanvas - 512)).toBeLessThanOrEqual(1.0)
    // Vertical center should be at 512
    expect(Math.abs(plan.destY + plan.newH / 2 - 512)).toBeLessThanOrEqual(1.0)

    // In fit mode, max dimension should be 1024 * (1 - 2*0.07) = 880.64 px
    expect(plan.newH).toBe(881)
  })

  it('aligns shoes at floor baseline', () => {
    const cropBox: [number, number, number, number] = [0, 0, 300, 200]
    const xSym = 149.5

    const plan = planGarmentPlacement(
      cropBox,
      xSym,
      'shoes',
      DEFAULT_CONFIG,
      'fit',
    )

    const soleBottom = plan.destY + plan.newH
    const expectedBaseline = Math.round(1024 * (1.0 - 0.07 - 0.08)) // 870 px
    expect(Math.abs(soleBottom - expectedBaseline)).toBeLessThanOrEqual(2)
  })

  it('scales shoes smaller than top in relative mode', () => {
    const topBox: [number, number, number, number] = [0, 0, 400, 600]
    const shoeBox: [number, number, number, number] = [0, 0, 400, 600]

    const topPlan = planGarmentPlacement(topBox, 199.5, 'top', DEFAULT_CONFIG, 'relative')
    const shoePlan = planGarmentPlacement(shoeBox, 199.5, 'shoes', DEFAULT_CONFIG, 'relative')

    expect(shoePlan.newH).toBeLessThan(topPlan.newH)
    // top REL is 0.86, shoe REL is 0.50
    expect(shoePlan.scale / topPlan.scale).toBeCloseTo(0.50 / 0.86, 1)
  })

  it('caps scale at upscaleCap and flags upscaled_limit', () => {
    const tinyBox: [number, number, number, number] = [0, 0, 40, 40]

    const plan = planGarmentPlacement(tinyBox, 19.5, 'top', DEFAULT_CONFIG, 'fit')
    expect(plan.scale).toBe(2.0)
    expect(plan.newW).toBe(80)
    expect(plan.newH).toBe(80)
    expect(plan.flags).toContain('upscaled_limit')
  })
})
