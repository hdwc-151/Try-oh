import type { Category } from '../types'

/**
 * Creates a binary mask where 1 indicates alpha > alphaThr, and 0 indicates background.
 */
export function createBinaryMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThr: number,
): Uint8Array {
  const total = width * height
  const mask = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] > alphaThr) {
      mask[i] = 1
    }
  }
  return mask
}

/**
 * Finds 8-connected components in binary mask M using a flat array BFS queue (no recursion).
 * - Shoes: keeps up to 2 largest components (a pair of shoes).
 * - Others: keeps the largest component and all components >= 5% area of the largest.
 * Pixels belonging to discarded components have their alpha set to 0.
 */
export function filterConnectedComponents(
  M: Uint8Array,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  category: Category,
): { cleanedM: Uint8Array; retainedCount: number } {
  const total = width * height
  const visited = new Uint8Array(total)
  const queue = new Int32Array(total)

  interface Component {
    pixels: number[]
    area: number
  }
  const components: Component[] = []

  // 8-neighborhood offsets
  const dx = [-1, 0, 1, -1, 1, -1, 0, 1]
  const dy = [-1, -1, -1, 0, 0, 1, 1, 1]

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x
      if (M[idx] === 0 || visited[idx] === 1) continue

      // Start BFS
      visited[idx] = 1
      let head = 0
      let tail = 0
      queue[tail++] = idx

      const pixels: number[] = []

      while (head < tail) {
        const curr = queue[head++]
        pixels.push(curr)

        const cx = curr % width
        const cy = Math.floor(curr / width)

        for (let k = 0; k < 8; k++) {
          const nx = cx + dx[k]
          const ny = cy + dy[k]
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nidx = ny * width + nx
            if (M[nidx] === 1 && visited[nidx] === 0) {
              visited[nidx] = 1
              queue[tail++] = nidx
            }
          }
        }
      }

      components.push({ pixels, area: pixels.length })
    }
  }

  if (components.length === 0) {
    return { cleanedM: M, retainedCount: 0 }
  }

  // Sort components descending by area
  components.sort((a, b) => b.area - a.area)

  const keepIndices = new Set<number>()
  if (category === 'shoes') {
    // Keep up to 2 largest components
    for (let i = 0; i < Math.min(2, components.length); i++) {
      keepIndices.add(i)
    }
  } else {
    // Keep largest + any component >= 5% of largest
    const maxArea = components[0].area
    const minThreshold = maxArea * 0.05
    for (let i = 0; i < components.length; i++) {
      if (components[i].area >= minThreshold) {
        keepIndices.add(i)
      }
    }
  }

  const cleanedM = new Uint8Array(M)
  for (let i = 0; i < components.length; i++) {
    if (!keepIndices.has(i)) {
      const compPixels = components[i].pixels
      for (let j = 0; j < compPixels.length; j++) {
        const p = compPixels[j]
        cleanedM[p] = 0
        data[p * 4 + 3] = 0
      }
    }
  }

  return { cleanedM, retainedCount: keepIndices.size }
}

/**
 * Fills small enclosed holes in mask that do not touch image borders and have area < 0.2% of garment area.
 * Uses flood-fill on inverted mask from all 4 borders to isolate exterior background.
 */
export function fillSmallHoles(
  M: Uint8Array,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  maxHoleRatio = 0.002,
): { filledM: Uint8Array; holeCount: number } {
  const total = width * height
  let garmentArea = 0
  for (let i = 0; i < total; i++) {
    if (M[i] === 1) garmentArea++
  }
  if (garmentArea === 0) {
    return { filledM: M, holeCount: 0 }
  }

  const maxHoleArea = garmentArea * maxHoleRatio
  const isExterior = new Uint8Array(total)
  const queue = new Int32Array(total)
  let tail = 0

  // Seed flood fill from all 4 borders where M is 0 (background)
  for (let x = 0; x < width; x++) {
    // Top border
    const topIdx = x
    if (M[topIdx] === 0 && isExterior[topIdx] === 0) {
      isExterior[topIdx] = 1
      queue[tail++] = topIdx
    }
    // Bottom border
    const bottomIdx = (height - 1) * width + x
    if (M[bottomIdx] === 0 && isExterior[bottomIdx] === 0) {
      isExterior[bottomIdx] = 1
      queue[tail++] = bottomIdx
    }
  }

  for (let y = 1; y < height - 1; y++) {
    // Left border
    const leftIdx = y * width
    if (M[leftIdx] === 0 && isExterior[leftIdx] === 0) {
      isExterior[leftIdx] = 1
      queue[tail++] = leftIdx
    }
    // Right border
    const rightIdx = y * width + (width - 1)
    if (M[rightIdx] === 0 && isExterior[rightIdx] === 0) {
      isExterior[rightIdx] = 1
      queue[tail++] = rightIdx
    }
  }

  // 4-neighborhood offsets for exterior background flood fill
  const dx4 = [0, 0, -1, 1]
  const dy4 = [-1, 1, 0, 0]

  let head = 0
  while (head < tail) {
    const curr = queue[head++]
    const cx = curr % width
    const cy = Math.floor(curr / width)

    for (let k = 0; k < 4; k++) {
      const nx = cx + dx4[k]
      const ny = cy + dy4[k]
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx
        if (M[nidx] === 0 && isExterior[nidx] === 0) {
          isExterior[nidx] = 1
          queue[tail++] = nidx
        }
      }
    }
  }

  // Find interior holes: pixels where M === 0 and isExterior === 0
  const holeVisited = new Uint8Array(total)
  let filledHoleCount = 0
  const filledM = new Uint8Array(M)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x
      if (M[idx] === 1 || isExterior[idx] === 1 || holeVisited[idx] === 1) {
        continue
      }

      // BFS to group hole component
      holeVisited[idx] = 1
      let hHead = 0
      let hTail = 0
      queue[hTail++] = idx
      const holePixels: number[] = []

      while (hHead < hTail) {
        const curr = queue[hHead++]
        holePixels.push(curr)

        const cx = curr % width
        const cy = Math.floor(curr / width)

        for (let k = 0; k < 4; k++) {
          const nx = cx + dx4[k]
          const ny = cy + dy4[k]
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nidx = ny * width + nx
            if (M[nidx] === 0 && isExterior[nidx] === 0 && holeVisited[nidx] === 0) {
              holeVisited[nidx] = 1
              queue[hTail++] = nidx
            }
          }
        }
      }

      if (holePixels.length < maxHoleArea) {
        // Fill hole!
        for (let i = 0; i < holePixels.length; i++) {
          const p = holePixels[i]
          filledM[p] = 1
          data[p * 4 + 3] = 255
        }
        filledHoleCount++
      }
    }
  }

  return { filledM, holeCount: filledHoleCount }
}

/**
 * 3x3 Morphological Erosion on Uint8Array binary mask.
 */
export function erodeMask3x3(M: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x
      if (
        M[idx] === 1 &&
        M[idx - 1] === 1 &&
        M[idx + 1] === 1 &&
        M[idx - width] === 1 &&
        M[idx + width] === 1 &&
        M[idx - width - 1] === 1 &&
        M[idx - width + 1] === 1 &&
        M[idx + width - 1] === 1 &&
        M[idx + width + 1] === 1
      ) {
        out[idx] = 1
      }
    }
  }
  return out
}

/**
 * 3x3 Morphological Dilation on Uint8Array binary mask.
 */
function dilateMask3x3(M: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (M[row + x] === 1) {
        const yStart = Math.max(0, y - 1)
        const yEnd = Math.min(height - 1, y + 1)
        const xStart = Math.max(0, x - 1)
        const xEnd = Math.min(width - 1, x + 1)

        for (let ny = yStart; ny <= yEnd; ny++) {
          const nrow = ny * width
          for (let nx = xStart; nx <= xEnd; nx++) {
            out[nrow + nx] = 1
          }
        }
      }
    }
  }
  return out
}

/**
 * Removes isolated 1px thin needle-like spurs using morphological open (erode then dilate).
 * Updates alpha to 0 where mask was cleared.
 */
export function cleanMaskSpurs(
  M: Uint8Array,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const eroded = erodeMask3x3(M, width, height)
  const opened = dilateMask3x3(eroded, width, height)
  const total = width * height

  for (let i = 0; i < total; i++) {
    if (M[i] === 1 && opened[i] === 0) {
      data[i * 4 + 3] = 0
    }
  }

  return opened
}

/**
 * Complete Phase 1 pipeline:
 * 1. Binary mask M = (alpha > alphaThr)
 * 2. Filter connected components (shoes: top 2; other: top + >=5% of top)
 * 3. Fill small holes (< 0.2% of garment area)
 * 4. Clean spurs via morphological open
 */
export function cleanGarmentMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  category: Category,
  alphaThr = 20,
): { M: Uint8Array; retainedCount: number } {
  let M = createBinaryMask(data, width, height, alphaThr)
  const compResult = filterConnectedComponents(M, data, width, height, category)
  M = compResult.cleanedM

  const holeResult = fillSmallHoles(M, data, width, height, 0.002)
  M = holeResult.filledM

  M = cleanMaskSpurs(M, data, width, height)
  return { M, retainedCount: compResult.retainedCount }
}
