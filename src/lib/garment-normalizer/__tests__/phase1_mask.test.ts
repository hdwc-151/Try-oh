import { describe, expect, it } from 'vitest'
import {
  cleanGarmentMask,
  cleanMaskSpurs,
  createBinaryMask,
  fillSmallHoles,
  filterConnectedComponents,
} from '../core/mask'

describe('Phase 1: Mask cleaning', () => {
  it('creates binary mask from alpha channel', () => {
    const width = 10
    const height = 10
    const data = new Uint8ClampedArray(width * height * 4)

    // Set pixel (5, 5) with alpha=25, and (2, 2) with alpha=15
    data[(5 * width + 5) * 4 + 3] = 25
    data[(2 * width + 2) * 4 + 3] = 15

    const M = createBinaryMask(data, width, height, 20)
    expect(M[5 * width + 5]).toBe(1)
    expect(M[2 * width + 2]).toBe(0)
  })

  it('filters connected components for general categories (keeps main + >=5% accessory)', () => {
    const width = 100
    const height = 100
    const data = new Uint8ClampedArray(width * height * 4)
    const M = new Uint8Array(width * height)

    // Main garment: 50x40 = 2000 px
    for (let y = 10; y < 60; y++) {
      for (let x = 10; x < 50; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    // Detached accessory: 12x12 = 144 px (7.2% of 2000 -> KEEP)
    for (let y = 70; y < 82; y++) {
      for (let x = 10; x < 22; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    // Stray speck: 3x3 = 9 px (0.45% of 2000 -> REMOVE)
    for (let y = 85; y < 88; y++) {
      for (let x = 85; x < 88; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    const { cleanedM, retainedCount } = filterConnectedComponents(M, data, width, height, 'top')
    expect(retainedCount).toBe(2)
    expect(cleanedM[15 * width + 15]).toBe(1)
    expect(cleanedM[75 * width + 15]).toBe(1)
    expect(cleanedM[86 * width + 86]).toBe(0)
    expect(data[(86 * width + 86) * 4 + 3]).toBe(0)
  })

  it('filters connected components for shoes (keeps max 2 largest pieces)', () => {
    const width = 100
    const height = 100
    const data = new Uint8ClampedArray(width * height * 4)
    const M = new Uint8Array(width * height)

    // Shoe 1: 30x20 = 600 px
    for (let y = 10; y < 40; y++) {
      for (let x = 10; x < 30; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    // Shoe 2: 30x20 = 600 px
    for (let y = 10; y < 40; y++) {
      for (let x = 50; x < 70; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    // 3rd piece: 15x15 = 225 px (should be discarded for shoes)
    for (let y = 70; y < 85; y++) {
      for (let x = 30; x < 45; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    const { cleanedM, retainedCount } = filterConnectedComponents(M, data, width, height, 'shoes')
    expect(retainedCount).toBe(2)
    expect(cleanedM[20 * width + 20]).toBe(1)
    expect(cleanedM[20 * width + 60]).toBe(1)
    expect(cleanedM[75 * width + 35]).toBe(0)
  })

  it('fills small enclosed holes (< 0.2%) while preserving large openings', () => {
    const width = 100
    const height = 100
    const data = new Uint8ClampedArray(width * height * 4)
    const M = new Uint8Array(width * height)

    // Garment: 60x60 = 3600 px (0.2% = 7.2 px)
    for (let y = 20; y < 80; y++) {
      for (let x = 20; x < 80; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    // Small pinhole: 2x2 = 4 px (< 7.2 px -> MUST FILL)
    for (let y = 30; y < 32; y++) {
      for (let x = 30; x < 32; x++) {
        const idx = y * width + x
        M[idx] = 0
        data[idx * 4 + 3] = 0
      }
    }

    // Large opening: 6x6 = 36 px (> 7.2 px -> MUST KEEP)
    for (let y = 50; y < 56; y++) {
      for (let x = 50; x < 56; x++) {
        const idx = y * width + x
        M[idx] = 0
        data[idx * 4 + 3] = 0
      }
    }

    const { filledM } = fillSmallHoles(M, data, width, height, 0.002)

    // Pinhole filled
    expect(filledM[30 * width + 30]).toBe(1)
    expect(data[(30 * width + 30) * 4 + 3]).toBe(255)

    // Large opening remains unfilled
    expect(filledM[52 * width + 52]).toBe(0)
    expect(data[(52 * width + 52) * 4 + 3]).toBe(0)
  })

  it('removes 1px thin spurs via morphological open', () => {
    const width = 50
    const height = 50
    const data = new Uint8ClampedArray(width * height * 4)
    const M = new Uint8Array(width * height)

    // Solid 20x20 block
    for (let y = 15; y < 35; y++) {
      for (let x = 15; x < 35; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    // Single pixel needle spur at (10, 25)
    M[10 * width + 25] = 1
    data[(10 * width + 25) * 4 + 3] = 255

    const opened = cleanMaskSpurs(M, data, width, height)
    expect(opened[10 * width + 25]).toBe(0)
    expect(data[(10 * width + 25) * 4 + 3]).toBe(0)
    expect(opened[20 * width + 20]).toBe(1)
  })
})
