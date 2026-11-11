import { describe, expect, it } from 'vitest'
import { analyzePersonImageDimensions, validatePersonImage } from './person-image-processing'

describe('validatePersonImage', () => {
  it('chấp nhận định dạng ảnh hỗ trợ', () => {
    expect(validatePersonImage(new File(['x'], 'person.jpg', { type: 'image/jpeg' }))).toBeNull()
  })

  it('từ chối file trên 10MB', () => {
    const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'person.webp', { type: 'image/webp' })
    expect(validatePersonImage(file)).toContain('10MB')
  })
})

describe('analyzePersonImageDimensions', () => {
  it('cảnh báo ảnh nằm ngang', () => {
    expect(analyzePersonImageDimensions(1600, 900)[0]).toContain('nằm ngang')
  })

  it('không cảnh báo ảnh dọc đủ lớn với tỷ lệ hợp lý', () => {
    expect(analyzePersonImageDimensions(800, 1200)).toEqual([])
  })
})
