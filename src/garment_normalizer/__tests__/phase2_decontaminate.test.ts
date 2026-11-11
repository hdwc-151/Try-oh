import { describe, expect, it } from 'vitest'
import { decontaminateColors, softenAndErodeAlpha } from '../core/decontaminate'

describe('Phase 2: Decontamination', () => {
  it('decontaminates white fringe on a red garment', () => {
    const width = 60
    const height = 60
    const data = new Uint8ClampedArray(width * height * 4)

    // Red core: [20:40, 20:40], alpha=255, color=(220, 25, 25)
    for (let y = 20; y < 40; y++) {
      for (let x = 20; x < 40; x++) {
        const idx = (y * width + x) * 4
        data[idx] = 220
        data[idx + 1] = 25
        data[idx + 2] = 25
        data[idx + 3] = 255
      }
    }

    // 2px Artificial white fringe around the red core: [18:42, 18:42]
    for (let y = 18; y < 42; y++) {
      for (let x = 18; x < 42; x++) {
        if (y >= 20 && y < 40 && x >= 20 && x < 40) continue
        const idx = (y * width + x) * 4
        data[idx] = 255
        data[idx + 1] = 255
        data[idx + 2] = 255
        data[idx + 3] = 120
      }
    }

    // Before: fringe pixel at (19, 30) is pure white
    const fringeIdxBefore = (19 * width + 30) * 4
    expect(data[fringeIdxBefore]).toBe(255)
    expect(data[fringeIdxBefore + 1]).toBe(255)
    expect(data[fringeIdxBefore + 2]).toBe(255)

    decontaminateColors(data, width, height, 6)

    // After: fringe pixel at (19, 30) should now be red
    expect(data[fringeIdxBefore]).toBeGreaterThan(180)
    expect(data[fringeIdxBefore + 1]).toBeLessThan(60)
    expect(data[fringeIdxBefore + 2]).toBeLessThan(60)
  })

  it('softens and erodes outer alpha border by 1px', () => {
    const width = 40
    const height = 40
    const data = new Uint8ClampedArray(width * height * 4)

    // Solid block [10:30, 10:30]
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) {
        const idx = (y * width + x) * 4
        data[idx] = 100
        data[idx + 1] = 100
        data[idx + 2] = 100
        data[idx + 3] = 255
      }
    }

    softenAndErodeAlpha(data, width, height)

    // Outer row 10 should be eroded to alpha 0
    expect(data[(10 * width + 20) * 4 + 3]).toBe(0)
    // Inner row 15 should remain 255
    expect(data[(15 * width + 20) * 4 + 3]).toBe(255)
  })
})
