import { describe, expect, it } from 'vitest'
import { MockImageProvider } from './mock-image-provider.js'

describe('MockImageProvider', () => {
  it('trả URL SVG đúng góc và có seed ổn định', async () => {
    const provider = new MockImageProvider(0)
    const input = {
      personImageUrl: '/uploads/person.jpg',
      garmentImageUrls: ['/uploads/shirt.png'],
      angle: 'front' as const,
    }
    const first = await provider.generate(input)
    const second = await provider.generate(input)
    expect(first.imageUrl).toMatch(/^\/api\/mock-images\/front\.svg\?seed=[a-f0-9]{12}$/)
    expect(second).toEqual(first)
  })

  it('reference ảnh trước làm thay đổi seed của góc còn lại', async () => {
    const provider = new MockImageProvider(0)
    const base = {
      personImageUrl: '/uploads/person.jpg',
      garmentImageUrls: ['/uploads/shirt.png'],
      angle: 'back' as const,
    }
    const one = await provider.generate({ ...base, referenceImageUrl: '/front-a.svg' })
    const two = await provider.generate({ ...base, referenceImageUrl: '/front-b.svg' })
    expect(one.imageUrl).not.toBe(two.imageUrl)
  })
})
