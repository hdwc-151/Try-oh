import { describe, expect, it } from 'vitest'
import { normalize } from '../core/pipeline'
import { findOptimalTilt } from '../core/tilt'
import { DEFAULT_CONFIG, type RGBAImage } from '../types'

/**
 * Generates a realistic synthetic T-shirt directly on a flat Uint8ClampedArray (no canvas/DOM).
 * Proportional to width/height so it never triggers tiny_or_huge or low_res accidentally.
 */
function makeSyntheticTshirt(
  width = 800,
  height = 800,
  offsetX = 0,
  offsetY = 0,
  tiltDeg = 0,
  color = [220, 30, 30],
): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4)
  const cx = width / 2 + offsetX
  const cy = height / 2 + offsetY

  const rad = (tiltDeg * Math.PI) / 180.0
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const bodyW = Math.round(width * 0.40) // e.g. 320 on 800 (>= 300px minItemPx)
  const bodyH = Math.round(height * 0.58) // e.g. 464 on 800
  const sleeveW = Math.round(width * 0.16) // e.g. 128
  const sleeveH = Math.round(height * 0.22) // e.g. 176

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx
      const dy = y - cy
      const ux = cx + dx * cos + dy * sin
      const uy = cy - dx * sin + dy * cos

      const inTorso =
        ux >= cx - bodyW / 2 &&
        ux <= cx + bodyW / 2 &&
        uy >= cy - bodyH / 2 &&
        uy <= cy + bodyH / 2

      const inLeftSleeve =
        ux >= cx - bodyW / 2 - sleeveW &&
        ux <= cx - bodyW / 2 &&
        uy >= cy - bodyH / 2 &&
        uy <= cy - bodyH / 2 + sleeveH

      const inRightSleeve =
        ux >= cx + bodyW / 2 &&
        ux <= cx + bodyW / 2 + sleeveW &&
        uy >= cy - bodyH / 2 &&
        uy <= cy - bodyH / 2 + sleeveH

      if (inTorso || inLeftSleeve || inRightSleeve) {
        const idx = (y * width + x) * 4
        // High frequency variation to ensure high Laplacian texture variance
        const noise = ((x ^ y) & 4) === 0 ? 25 : -25
        data[idx] = Math.min(255, Math.max(0, color[0] + noise))
        data[idx + 1] = Math.min(255, Math.max(0, color[1] + noise))
        data[idx + 2] = Math.min(255, Math.max(0, color[2] + noise))
        data[idx + 3] = 255
      }
    }
  }

  return { data, width, height }
}

/**
 * Generates synthetic shoes on a flat Uint8ClampedArray.
 */
function makeSyntheticShoes(width = 800, height = 800): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4)
  const cx = width / 2
  const cy = height / 2

  const rx = Math.round(width * 0.10)
  const ry = Math.round(height * 0.22)
  const spread = Math.round(width * 0.16)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Left shoe ellipse
      const ldx = (x - (cx - spread)) / rx
      const ldy = (y - cy) / ry
      const inLeft = ldx * ldx + ldy * ldy <= 1.0

      // Right shoe ellipse
      const rdx = (x - (cx + spread)) / rx
      const rdy = (y - cy) / ry
      const inRight = rdx * rdx + rdy * rdy <= 1.0

      if (inLeft || inRight) {
        const idx = (y * width + x) * 4
        const noise = ((x ^ y) & 4) === 0 ? 20 : -20
        data[idx] = Math.min(255, Math.max(0, 60 + noise))
        data[idx + 1] = Math.min(255, Math.max(0, 60 + noise))
        data[idx + 2] = Math.min(255, Math.max(0, 180 + noise))
        data[idx + 3] = 255
      }
    }
  }

  return { data, width, height }
}

describe('Phase 8: Comprehensive Core Verification', () => {
  // 1. Off-center garment -> centered within 2px, margin within 3px
  it('1. Off-center translation -> centered in canvas within 2px and margin within 3px', () => {
    // Large translation: dx = 60, dy = -40
    const image = makeSyntheticTshirt(800, 800, 60, -40)
    const result = normalize(image, 'top', DEFAULT_CONFIG, 'fit')

    expect(result.meta.status).toBe('OK')
    // Horizontal center within 2px of 512
    expect(Math.abs(result.meta.xSymInCanvas - 512)).toBeLessThanOrEqual(2)

    const [bx, by, bw, bh] = result.meta.bboxInCanvas
    expect(Math.abs(bx + bw / 2.0 - 512)).toBeLessThanOrEqual(2)

    // Expected margin for limiting dimension
    const expectedMargin = (1024 - Math.max(bw, bh)) / 2.0
    const actualMargin = Math.min(bx, by)
    expect(Math.abs(actualMargin - expectedMargin)).toBeLessThanOrEqual(3)
  })

  // 2. Tilted ±10 degrees -> residual tilt < 1.5 degrees
  it.each([10.0, -10.0])('2. Tilted %d deg -> residual tilt < 1.5 deg after straightening', (tiltDeg) => {
    const image = makeSyntheticTshirt(800, 800, 0, 0, tiltDeg)
    const result = normalize(image, 'top', DEFAULT_CONFIG, 'fit')

    const { rotationApplied: residual } = findOptimalTilt(
      result.mask,
      1024,
      1024,
      'top',
      DEFAULT_CONFIG,
    )
    expect(Math.abs(residual)).toBeLessThan(1.5)
    expect(result.meta.needsReview).toBe(false)
  })

  // 3. Tilted 25 degrees -> does NOT rotate, tilt_too_large, needsReview
  it('3. Tilted 25 deg -> tilt_too_large flag, no auto-rotation, needsReview', () => {
    const image = makeSyntheticTshirt(800, 800, 0, 0, 25.0)
    const result = normalize(image, 'top', DEFAULT_CONFIG, 'fit')

    expect(result.meta.rotationApplied).toBe(0)
    expect(result.meta.flags).toContain('tilt_too_large')
    expect(result.meta.needsReview).toBe(true)
  })

  // 4. Border touching -> REJECT
  it('4. Touching border >= 3% -> REJECT status', () => {
    // Shift up heavily so top crosses image border
    const image = makeSyntheticTshirt(800, 800, 0, -250)
    const result = normalize(image, 'top', DEFAULT_CONFIG, 'fit')

    expect(result.meta.status).toBe('REJECT')
    expect(result.meta.flags).toContain('cropped')
    expect(result.meta.needsReview).toBe(true)
  })

  // 5. Small specks removed and small pinhole filled
  it('5. Specks removed and pinholes filled', () => {
    const image = makeSyntheticTshirt(800, 800)
    const { data, width } = image

    // Add 2x2 hole in body center
    for (let y = 399; y <= 400; y++) {
      for (let x = 399; x <= 400; x++) {
        data[(y * width + x) * 4 + 3] = 0
      }
    }

    // Add tiny 3x3 isolated speck at top-left
    for (let y = 20; y <= 22; y++) {
      for (let x = 20; x <= 22; x++) {
        const idx = (y * width + x) * 4
        data[idx] = 220
        data[idx + 1] = 30
        data[idx + 2] = 30
        data[idx + 3] = 255
      }
    }

    const result = normalize(image, 'top', DEFAULT_CONFIG, 'fit')

    // Pinhole in center must be filled (alpha > 0)
    expect(result.image.data[(512 * 1024 + 512) * 4 + 3]).toBeGreaterThan(0)
    // Corner speck must be cleared (alpha === 0)
    expect(result.image.data[(30 * 1024 + 30) * 4 + 3]).toBe(0)
  })

  // 6. Artificial white fringe around red garment -> decontaminated to red
  it('6. Decontaminates white fringe to red', () => {
    const image = makeSyntheticTshirt(600, 600, 0, 0, 0, [220, 20, 20])
    const { data, width, height } = image

    // Find border pixels of shirt and paint white fringe
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4
        if (data[idx + 3] === 0) {
          const hasNeighbor =
            data[((y - 1) * width + x) * 4 + 3] === 255 ||
            data[((y + 1) * width + x) * 4 + 3] === 255 ||
            data[(y * width + x - 1) * 4 + 3] === 255 ||
            data[(y * width + x + 1) * 4 + 3] === 255

          if (hasNeighbor) {
            data[idx] = 255
            data[idx + 1] = 255
            data[idx + 2] = 255
            data[idx + 3] = 120
          }
        }
      }
    }

    const result = normalize(image, 'top', DEFAULT_CONFIG, 'fit')
    const outData = result.image.data
    const edgePixels: number[] = []

    for (let i = 0; i < 1024 * 1024; i++) {
      const a = outData[i * 4 + 3]
      if (a > 0 && a < 230) {
        edgePixels.push(i)
      }
    }

    expect(edgePixels.length).toBeGreaterThan(0)
    let sumR = 0
    let sumG = 0
    let sumB = 0
    for (const p of edgePixels) {
      sumR += outData[p * 4]
      sumG += outData[p * 4 + 1]
      sumB += outData[p * 4 + 2]
    }
    const avgR = sumR / edgePixels.length
    const avgG = sumG / edgePixels.length
    const avgB = sumB / edgePixels.length

    expect(avgR).toBeGreaterThan(160)
    expect(avgG).toBeLessThan(80)
    expect(avgB).toBeLessThan(80)
  })

  // 7. Idempotent: run twice gives nearly identical bbox (<= 2px)
  it('7. Idempotent: 2nd normalization pass matches within 2px', () => {
    const image = makeSyntheticTshirt(800, 800)
    const pass1 = normalize(image, 'top', DEFAULT_CONFIG, 'fit')
    const pass2 = normalize(pass1.image, 'top', DEFAULT_CONFIG, 'fit')

    const b1 = pass1.meta.bboxInCanvas
    const b2 = pass2.meta.bboxInCanvas

    expect(Math.abs(b1[0] - b2[0])).toBeLessThanOrEqual(2)
    expect(Math.abs(b1[1] - b2[1])).toBeLessThanOrEqual(2)
    expect(Math.abs(b1[2] - b2[2])).toBeLessThanOrEqual(2)
    expect(Math.abs(b1[3] - b2[3])).toBeLessThanOrEqual(2)
    expect(Math.abs(pass2.meta.rotationApplied)).toBeLessThan(0.5)
  })

  // 8. Relative mode: shoes smaller than top
  it('8. Relative mode: shoes scaled smaller than top per REL factors', () => {
    const top = makeSyntheticTshirt(800, 800)
    const shoes = makeSyntheticShoes(800, 800)

    const resTop = normalize(top, 'top', DEFAULT_CONFIG, 'relative')
    const resShoes = normalize(shoes, 'shoes', DEFAULT_CONFIG, 'relative')

    expect(resShoes.meta.bboxInCanvas[3]).toBeLessThan(resTop.meta.bboxInCanvas[3])
    expect(resShoes.meta.scaleFactor).toBeLessThan(resTop.meta.scaleFactor)
  })

  // 9. Performance: 2048x2048 image core processing in software JS
  it('9. Performance: 2048x2048 core normalization runs under 3.5 seconds', () => {
    const large = makeSyntheticTshirt(2048, 2048)
    const t0 = performance.now()
    const result = normalize(large, 'top', DEFAULT_CONFIG, 'fit')
    const elapsed = performance.now() - t0

    expect(result.meta.status).toBe('OK')
    expect(elapsed).toBeLessThan(3500)
    console.log(`[Benchmark] 2048x2048 core normalization completed in: ${elapsed.toFixed(1)}ms`)
  })
})
