import { describe, expect, it } from 'vitest'
import { findVisiblePixelBounds, validateGarmentImage } from './background-removal'

describe('validateGarmentImage', () => {
  it('chấp nhận JPG, PNG và WebP', () => {
    expect(validateGarmentImage(new File(['x'], 'item.webp', { type: 'image/webp' }))).toBeNull()
  })

  it('từ chối định dạng không hỗ trợ', () => {
    expect(validateGarmentImage(new File(['x'], 'item.gif', { type: 'image/gif' }))).toContain('JPG')
  })

  it('từ chối ảnh lớn hơn 10MB', () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
    expect(validateGarmentImage(file)).toContain('10MB')
  })
})

describe('findVisiblePixelBounds', () => {
  it('tìm đúng vùng có pixel nhìn thấy để cắt sát sản phẩm', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    pixels[(1 * 4 + 1) * 4 + 3] = 255
    pixels[(2 * 4 + 2) * 4 + 3] = 180

    expect(findVisiblePixelBounds(pixels, 4, 4)).toEqual({
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    })
  })

  it('bỏ qua nhiễu alpha rất mờ ở mép ảnh', () => {
    const pixels = new Uint8ClampedArray(3 * 3 * 4)
    pixels[3] = 5
    pixels[(1 * 3 + 1) * 4 + 3] = 255

    expect(findVisiblePixelBounds(pixels, 3, 3)).toEqual({
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    })
  })
})
