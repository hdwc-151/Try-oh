import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { optimizeImageForStorage } from './optimize-image.js'

describe('optimizeImageForStorage', () => {
  it('chuyển PNG lớn sang WebP khi dung lượng nhỏ hơn', async () => {
    const png = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 80, g: 130, b: 95, alpha: 0.7 } },
    }).png({ compressionLevel: 0 }).toBuffer()

    const result = await optimizeImageForStorage(png, 'image/png')

    expect(result.mimeType).toBe('image/webp')
    expect(result.buffer.length).toBeLessThan(png.length)
    expect((await sharp(result.buffer).metadata()).format).toBe('webp')
  })

  it('chuẩn hóa JPG sang WebP để giảm dung lượng và loại metadata', async () => {
    const jpeg = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 80, b: 50 } },
    }).jpeg({ quality: 95 }).toBuffer()
    const result = await optimizeImageForStorage(jpeg, 'image/jpeg')
    expect(result.mimeType).toBe('image/webp')
    expect((await sharp(result.buffer).metadata()).format).toBe('webp')
  })
})
