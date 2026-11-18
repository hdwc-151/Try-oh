import type { Config, Status } from '../types'

export interface QualityReport {
  status: Status
  flags: string[]
  needsReview: boolean
  rejectReason?: string
  bbox: [x: number, y: number, width: number, height: number]
  maskArea: number
}

const REJECT_FLAGS = new Set(['cropped', 'tiny_or_huge'])
const WARN_FLAGS = new Set(['low_res', 'blurry', 'fragmented', 'low_fill'])

export const FLAG_DESCRIPTIONS_VI: Record<string, string> = {
  cropped: 'Ảnh bị chạm viền khung hình (cắt góc). Vui lòng chụp lại trọn vẹn sản phẩm.',
  tiny_or_huge: 'Kích thước món đồ quá nhỏ hoặc chiếm toàn bộ ảnh. Vui lòng chụp lại.',
  low_res: 'Độ phân giải món đồ tương đối thấp (< 300px).',
  blurry: 'Ảnh có dấu hiệu mờ nhoè hoặc thiếu chi tiết sắc nét.',
  fragmented: 'Phát hiện nhiều chi tiết rời rạc sau khi tách nền.',
  low_fill: 'Tỉ lệ phủ diện tích trong hộp bao thấp, có thể tách nền sót hoặc sai.',
  low_symmetry: 'Độ đối xứng không đạt ngưỡng chuẩn để tự động nắn thẳng.',
  tilt_too_large: 'Độ nghiêng thực tế lớn hơn 15°, vui lòng chỉnh góc thủ công.',
  upscaled_limit: 'Đã chạm trần phóng to 2x.',
  overflow: 'Món đồ vượt quá kích thước khung canvas.',
}

/**
 * Pure TypeScript quality assessment:
 * - low_res: short bbox side < minItemPx -> WARN
 * - blurry: Laplacian variance inside M < blurThr -> WARN
 * - cropped: border touched >= 3% of perimeter (dist <= 2px) -> REJECT
 * - tiny_or_huge: mask area < 3% or > 97% of total image -> REJECT
 * - fragmented: > 3 components -> WARN
 * - low_fill: mask area / bbox area < lowFillThr -> WARN
 */
export function evaluateQuality(
  data: Uint8ClampedArray,
  M: Uint8Array,
  width: number,
  height: number,
  retainedComponents: number,
  config: Config,
): QualityReport {
  const flags: string[] = []
  const totalPixels = width * height

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let maskArea = 0

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (M[row + x] === 1) {
        maskArea++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maskArea === 0 || maxX < minX || maxY < minY) {
    flags.push('tiny_or_huge')
    return {
      status: 'REJECT',
      flags,
      needsReview: true,
      rejectReason: FLAG_DESCRIPTIONS_VI.tiny_or_huge,
      bbox: [0, 0, 0, 0],
      maskArea: 0,
    }
  }

  const bboxW = maxX - minX + 1
  const bboxH = maxY - minY + 1
  const shortSide = Math.min(bboxW, bboxH)
  const bboxArea = bboxW * bboxH

  // 1. tiny_or_huge (REJECT)
  const areaRatio = maskArea / totalPixels
  if (areaRatio < 0.03 || areaRatio > 0.97) {
    flags.push('tiny_or_huge')
  }

  // 2. cropped (REJECT)
  // Check borders within 2px (indices 0, 1, 2 from edges)
  let touchedTop = 0
  let touchedBottom = 0
  for (let x = 0; x < width; x++) {
    if (M[x] === 1 || M[width + x] === 1 || M[2 * width + x] === 1) {
      touchedTop++
    }
    const b0 = (height - 1) * width + x
    const b1 = (height - 2) * width + x
    const b2 = (height - 3) * width + x
    if (M[b0] === 1 || M[b1] === 1 || M[b2] === 1) {
      touchedBottom++
    }
  }

  let touchedLeft = 0
  let touchedRight = 0
  for (let y = 0; y < height; y++) {
    const row = y * width
    if (M[row] === 1 || M[row + 1] === 1 || M[row + 2] === 1) {
      touchedLeft++
    }
    if (
      M[row + width - 1] === 1 ||
      M[row + width - 2] === 1 ||
      M[row + width - 3] === 1
    ) {
      touchedRight++
    }
  }

  const totalTouched = touchedTop + touchedBottom + touchedLeft + touchedRight
  const perimeter = 2 * (width + height)
  if (totalTouched / perimeter >= 0.03) {
    flags.push('cropped')
  }

  // 3. low_res (WARN)
  if (shortSide < config.minItemPx) {
    flags.push('low_res')
  }

  // 4. blurry (WARN): Handcrafted Laplacian variance on interior garment pixels
  // Convert RGB to grayscale on the fly
  let lapSum = 0
  let lapSqSum = 0
  let lapCount = 0

  for (let y = 1; y < height - 1; y++) {
    const ym1 = (y - 1) * width
    const yp1 = (y + 1) * width
    const row = y * width

    for (let x = 1; x < width - 1; x++) {
      const idx = row + x
      // Only measure pixels well inside garment to prevent step-edge silhouette inflation
      if (
        M[idx] === 1 &&
        M[idx - 1] === 1 &&
        M[idx + 1] === 1 &&
        M[ym1 + x] === 1 &&
        M[yp1 + x] === 1
      ) {
        const pIdx = idx * 4
        const gCenter = 0.299 * data[pIdx] + 0.587 * data[pIdx + 1] + 0.114 * data[pIdx + 2]

        const tIdx = (ym1 + x) * 4
        const gTop = 0.299 * data[tIdx] + 0.587 * data[tIdx + 1] + 0.114 * data[tIdx + 2]

        const bIdx = (yp1 + x) * 4
        const gBottom = 0.299 * data[bIdx] + 0.587 * data[bIdx + 1] + 0.114 * data[bIdx + 2]

        const lIdx = (row + x - 1) * 4
        const gLeft = 0.299 * data[lIdx] + 0.587 * data[lIdx + 1] + 0.114 * data[lIdx + 2]

        const rIdx = (row + x + 1) * 4
        const gRight = 0.299 * data[rIdx] + 0.587 * data[rIdx + 1] + 0.114 * data[rIdx + 2]

        // 3x3 Laplacian: [0, 1, 0; 1, -4, 1; 0, 1, 0]
        const lap = gTop + gBottom + gLeft + gRight - 4.0 * gCenter
        lapSum += lap
        lapSqSum += lap * lap
        lapCount++
      }
    }
  }

  const lapVariance =
    lapCount > 20 ? lapSqSum / lapCount - (lapSum / lapCount) ** 2 : 0
  if (lapVariance < config.blurThr) {
    flags.push('blurry')
  }

  // 5. fragmented (WARN)
  if (retainedComponents > 3) {
    flags.push('fragmented')
  }

  // 6. low_fill (WARN)
  const fillRatio = maskArea / bboxArea
  if (fillRatio < config.lowFillThr) {
    flags.push('low_fill')
  }

  // Determine status & rejectReason
  let status: Status = 'OK'
  let rejectReason: string | undefined

  if (flags.some((f) => REJECT_FLAGS.has(f))) {
    status = 'REJECT'
    const firstReject = flags.find((f) => REJECT_FLAGS.has(f))!
    rejectReason = FLAG_DESCRIPTIONS_VI[firstReject]
  } else if (flags.some((f) => WARN_FLAGS.has(f))) {
    status = 'WARN'
  }

  const needsReview = status !== 'OK'

  return {
    status,
    flags,
    needsReview,
    rejectReason,
    bbox: [minX, minY, bboxW, bboxH],
    maskArea,
  }
}
