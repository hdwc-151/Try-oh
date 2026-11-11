import { erodeMask3x3 } from './mask'

/**
 * Decontaminates edge colors for pixels where 0 < alpha < 255.
 * Replaces fringe RGB with the color of the nearest core pixels (alpha === 255 after 2px erosion).
 * Iteratively dilates core color outward by averaging known neighbors (up to 6 rounds).
 *
 * Softens alpha with Gaussian blur (sigma=0.8) along a 2px edge band, then erodes alpha 1px.
 * Operates purely on TypedArrays with optimized loops.
 */
export function decontaminateColors(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxRounds = 6,
): void {
  const total = width * height

  // 1. Identify core pixels: alpha === 255 eroded by 2px
  const alpha255 = new Uint8Array(total)
  let coreCount = 0
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] === 255) {
      alpha255[i] = 1
      coreCount++
    }
  }

  let core = erodeMask3x3(erodeMask3x3(alpha255, width, height), width, height)
  let activeCoreCount = 0
  for (let i = 0; i < total; i++) {
    if (core[i] === 1) activeCoreCount++
  }

  // Fallbacks for very thin garments
  if (activeCoreCount === 0) {
    core = erodeMask3x3(alpha255, width, height)
    for (let i = 0; i < total; i++) {
      if (core[i] === 1) activeCoreCount++
    }
    if (activeCoreCount === 0) {
      for (let i = 0; i < total; i++) {
        if (data[i * 4 + 3] > 128) {
          core[i] = 1
          activeCoreCount++
        }
      }
      if (activeCoreCount === 0) {
        for (let i = 0; i < total; i++) {
          if (data[i * 4 + 3] > 0) {
            core[i] = 1
            activeCoreCount++
          }
        }
      }
    }
  }

  if (activeCoreCount === 0) return

  // Separate RGB channels into flat working arrays
  const r = new Uint8ClampedArray(total)
  const g = new Uint8ClampedArray(total)
  const b = new Uint8ClampedArray(total)
  const known = new Uint8Array(total)

  for (let i = 0; i < total; i++) {
    r[i] = data[i * 4]
    g[i] = data[i * 4 + 1]
    b[i] = data[i * 4 + 2]
    if (core[i] === 1) {
      known[i] = 1
    }
  }

  // Preallocated frontier buffers to avoid GC pressure in hot loops
  const frontierIndices = new Int32Array(total)
  const nextR = new Uint8ClampedArray(total)
  const nextG = new Uint8ClampedArray(total)
  const nextB = new Uint8ClampedArray(total)

  // 8-neighborhood
  const dx = [-1, 0, 1, -1, 1, -1, 0, 1]
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1]

  // Iterative dilation outward
  for (let round = 0; round < maxRounds; round++) {
    let frontierCount = 0

    for (let y = 0; y < height; y++) {
      const row = y * width
      for (let x = 0; x < width; x++) {
        const idx = row + x
        // Only target non-core pixels that have some alpha
        if (known[idx] === 1 || data[idx * 4 + 3] === 0) continue

        // Check if adjacent to known area
        let sumR = 0
        let sumG = 0
        let sumB = 0
        let count = 0

        for (let k = 0; k < 8; k++) {
          const nx = x + dx[k]
          const ny = y + dy[k]
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nidx = ny * width + nx
            if (known[nidx] === 1) {
              sumR += r[nidx]
              sumG += g[nidx]
              sumB += b[nidx]
              count++
            }
          }
        }

        if (count > 0) {
          frontierIndices[frontierCount] = idx
          nextR[frontierCount] = Math.round(sumR / count)
          nextG[frontierCount] = Math.round(sumG / count)
          nextB[frontierCount] = Math.round(sumB / count)
          frontierCount++
        }
      }
    }

    if (frontierCount === 0) break

    // Commit frontier colors
    for (let i = 0; i < frontierCount; i++) {
      const idx = frontierIndices[i]
      known[idx] = 1
      r[idx] = nextR[i]
      g[idx] = nextG[i]
      b[idx] = nextB[i]
    }
  }

  // Write decontaminated colors back to original buffer where alpha > 0
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] > 0 && known[i] === 1) {
      data[i * 4] = r[i]
      data[i * 4 + 1] = g[i]
      data[i * 4 + 2] = b[i]
    }
  }
}

/**
 * Softens alpha using Gaussian blur (sigma=0.8) along a 2px-wide edge band,
 * then erodes alpha by 1px to eliminate remaining outer fringe halo.
 */
export function softenAndErodeAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const total = width * height

  // 1. Binary mask
  const binary = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] > 0) binary[i] = 1
  }

  // 2. 2px-wide edge band inside garment: binary === 1 and eroded2 === 0
  const eroded2 = erodeMask3x3(erodeMask3x3(binary, width, height), width, height)
  const edgeBand = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    if (binary[i] === 1 && eroded2[i] === 0) {
      edgeBand[i] = 1
    }
  }

  // 3. Separable 1D Gaussian blur with sigma=0.8
  // Weights: x=0: 1.0, x=±1: 0.4578, x=±2: 0.0439. Total sum = 2.0034
  const w0 = 1.0 / 2.0034
  const w1 = 0.4578 / 2.0034
  const w2 = 0.0439 / 2.0034

  const origAlpha = new Float32Array(total)
  for (let i = 0; i < total; i++) {
    origAlpha[i] = data[i * 4 + 3]
  }

  // Horizontal blur pass
  const hBlur = new Float32Array(total)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const idx = row + x
      const xm2 = Math.max(0, x - 2)
      const xm1 = Math.max(0, x - 1)
      const xp1 = Math.min(width - 1, x + 1)
      const xp2 = Math.min(width - 1, x + 2)

      hBlur[idx] =
        origAlpha[row + xm2] * w2 +
        origAlpha[row + xm1] * w1 +
        origAlpha[idx] * w0 +
        origAlpha[row + xp1] * w1 +
        origAlpha[row + xp2] * w2
    }
  }

  // Vertical blur pass
  const softenedAlpha = new Uint8ClampedArray(total)
  for (let y = 0; y < height; y++) {
    const ym2 = Math.max(0, y - 2) * width
    const ym1 = Math.max(0, y - 1) * width
    const yp1 = Math.min(height - 1, y + 1) * width
    const yp2 = Math.min(height - 1, y + 2) * width
    const row = y * width

    for (let x = 0; x < width; x++) {
      const idx = row + x
      if (edgeBand[idx] === 1) {
        const val =
          hBlur[ym2 + x] * w2 +
          hBlur[ym1 + x] * w1 +
          hBlur[idx] * w0 +
          hBlur[yp1 + x] * w1 +
          hBlur[yp2 + x] * w2
        softenedAlpha[idx] = Math.round(val)
      } else {
        softenedAlpha[idx] = data[idx * 4 + 3]
      }
    }
  }

  // 4. Erode alpha by 1px (minimum in 3x3 neighborhood)
  for (let y = 0; y < height; y++) {
    const ym1 = Math.max(0, y - 1) * width
    const yp1 = Math.min(height - 1, y + 1) * width
    const row = y * width

    for (let x = 0; x < width; x++) {
      const idx = row + x
      if (binary[idx] === 0) {
        data[idx * 4 + 3] = 0
        continue
      }

      const xm1 = Math.max(0, x - 1)
      const xp1 = Math.min(width - 1, x + 1)

      let minA = softenedAlpha[idx]
      if (softenedAlpha[ym1 + xm1] < minA) minA = softenedAlpha[ym1 + xm1]
      if (softenedAlpha[ym1 + x] < minA) minA = softenedAlpha[ym1 + x]
      if (softenedAlpha[ym1 + xp1] < minA) minA = softenedAlpha[ym1 + xp1]
      if (softenedAlpha[row + xm1] < minA) minA = softenedAlpha[row + xm1]
      if (softenedAlpha[row + xp1] < minA) minA = softenedAlpha[row + xp1]
      if (softenedAlpha[yp1 + xm1] < minA) minA = softenedAlpha[yp1 + xm1]
      if (softenedAlpha[yp1 + x] < minA) minA = softenedAlpha[yp1 + x]
      if (softenedAlpha[yp1 + xp1] < minA) minA = softenedAlpha[yp1 + xp1]

      data[idx * 4 + 3] = minA
    }
  }
}

/**
 * Complete Phase 2:
 * 1. Color decontamination
 * 2. Alpha edge softening and 1px erosion
 */
export function decontaminateGarment(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  decontaminateColors(data, width, height, 6)
  softenAndErodeAlpha(data, width, height)
}
