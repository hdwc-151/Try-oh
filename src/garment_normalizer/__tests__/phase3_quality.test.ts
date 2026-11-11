import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../types'
import { evaluateQuality } from '../core/quality'

describe('Phase 3: Quality Evaluation', () => {
  it('passes quality check for clear centered garment', () => {
    const width = 800
    const height = 800
    const data = new Uint8ClampedArray(width * height * 4)
    const M = new Uint8Array(width * height)

    // 400x500 textured box in center
    for (let y = 150; y < 650; y++) {
      for (let x = 200; x < 600; x++) {
        const idx = y * width + x
        M[idx] = 1
        const pIdx = idx * 4
        // High contrast checkered texture for high Laplacian variance
        const val = ((x ^ y) & 8) === 0 ? 40 : 200
        data[pIdx] = val
        data[pIdx + 1] = val
        data[pIdx + 2] = val
        data[pIdx + 3] = 255
      }
    }

    const report = evaluateQuality(data, M, width, height, 1, DEFAULT_CONFIG)
    expect(report.status).toBe('OK')
    expect(report.needsReview).toBe(false)
    expect(report.flags).toHaveLength(0)
  })

  it('detects low resolution items', () => {
    const width = 800
    const height = 800
    const data = new Uint8ClampedArray(width * height * 4)
    const M = new Uint8Array(width * height)

    // 200x500 box (short side = 200 < 300)
    for (let y = 150; y < 650; y++) {
      for (let x = 300; x < 500; x++) {
        const idx = y * width + x
        M[idx] = 1
        const pIdx = idx * 4
        const val = ((x ^ y) & 8) === 0 ? 40 : 200
        data[pIdx] = val
        data[pIdx + 1] = val
        data[pIdx + 2] = val
        data[pIdx + 3] = 255
      }
    }

    const report = evaluateQuality(data, M, width, height, 1, DEFAULT_CONFIG)
    expect(report.flags).toContain('low_res')
    expect(report.status).toBe('WARN')
  })

  it('rejects cropped images with Vietnamese explanation', () => {
    const width = 800
    const height = 800
    const data = new Uint8ClampedArray(width * height * 4)
    const M = new Uint8Array(width * height)

    // Garment touching top border for 300px (300 / 3200 = 9.3% >= 3%)
    for (let y = 0; y < 400; y++) {
      for (let x = 200; x < 500; x++) {
        const idx = y * width + x
        M[idx] = 1
        data[idx * 4 + 3] = 255
      }
    }

    const report = evaluateQuality(data, M, width, height, 1, DEFAULT_CONFIG)
    expect(report.flags).toContain('cropped')
    expect(report.status).toBe('REJECT')
    expect(report.rejectReason).toContain('chạm viền')
  })
})
