import sharp from 'sharp'
import type { ImageStorage } from '../storage/image-storage.js'

export type GarmentColor = { hex: string; name: string }

const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0')

/** Tên màu tiếng Việt theo HSL, đủ thô để gom nhóm "màu chủ đạo" của tủ đồ. */
export function nameColor(r: number, g: number, b: number): string {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  let hue = 0
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  if (hue < 0) hue += 360
  if (saturation < 0.15 || delta < 0.08) {
    if (lightness > 0.82) return 'Trắng'
    if (lightness < 0.22) return 'Đen'
    return 'Xám'
  }
  if (lightness < 0.16) return 'Đen'
  if (hue >= 20 && hue < 60 && saturation < 0.5 && lightness > 0.62) return 'Be'
  if (hue >= 10 && hue < 45 && lightness < 0.45) return 'Nâu'
  if (hue < 12 || hue >= 345) return 'Đỏ'
  if (hue < 40) return 'Cam'
  if (hue < 68) return 'Vàng'
  if (hue < 165) return 'Xanh lá'
  if (hue < 200) return 'Xanh ngọc'
  if (hue < 255) return 'Xanh dương'
  if (hue < 295) return 'Tím'
  return 'Hồng'
}

/** Màu trung bình của phần có hình (bỏ nền trong suốt) trên ảnh đã thu nhỏ. */
export async function averageColor(buffer: Buffer): Promise<GarmentColor | null> {
  const { data, info } = await sharp(buffer, { limitInputPixels: 24_000_000 })
    .resize(32, 32, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 128) continue
    // Bỏ các điểm gần trắng tinh: nền trắng còn sót sau khi tách nền.
    if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245) continue
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    count += 1
  }
  if (count < 8) return null
  r /= count
  g /= count
  b /= count
  return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`, name: nameColor(r, g, b) }
}

/**
 * Màu của ảnh món đồ, có cache theo khoá ảnh: khoá ảnh không bao giờ đổi nội dung, nên
 * mỗi ảnh chỉ phải tính một lần trong vòng đời tiến trình.
 */
export class GarmentColorCache {
  private readonly cache = new Map<string, GarmentColor | null>()
  constructor(private readonly images: ImageStorage, private readonly maxEntries = 20_000) {}

  async colorOf(key: string): Promise<GarmentColor | null> {
    if (this.cache.has(key)) return this.cache.get(key) ?? null
    let color: GarmentColor | null = null
    try {
      color = await averageColor((await this.images.read(key)).buffer)
    } catch {
      // Ảnh lỗi hoặc đã bị xoá: không có màu, nhưng không làm hỏng cả danh sách.
      return null
    }
    if (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(key, color)
    return color
  }

  /** Tính nhiều ảnh với số luồng giới hạn để không dồn hết lên R2 cùng lúc. */
  async colorsOf(keys: string[], concurrency = 6): Promise<(GarmentColor | null)[]> {
    const results: (GarmentColor | null)[] = new Array(keys.length).fill(null)
    let next = 0
    const worker = async () => {
      while (next < keys.length) {
        const index = next
        next += 1
        results[index] = await this.colorOf(keys[index]!)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker))
    return results
  }
}
