// @vitest-environment node
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import type { ImageStorage } from '../storage/image-storage.js'
import { averageColor, GarmentColorCache, nameColor } from './garment-colors.js'

const solid = (r: number, g: number, b: number, alpha = 1) =>
  sharp({ create: { width: 40, height: 40, channels: 4, background: { r, g, b, alpha } } }).png().toBuffer()

describe('garment colors', () => {
  it('names common clothing colors in Vietnamese', () => {
    expect(nameColor(250, 250, 250)).toBe('Trắng')
    expect(nameColor(20, 20, 24)).toBe('Đen')
    expect(nameColor(128, 128, 130)).toBe('Xám')
    expect(nameColor(200, 30, 40)).toBe('Đỏ')
    expect(nameColor(40, 70, 160)).toBe('Xanh dương')
    expect(nameColor(110, 70, 40)).toBe('Nâu')
    expect(nameColor(225, 205, 175)).toBe('Be')
    expect(nameColor(190, 220, 60)).toBe('Xanh lá')
  })

  it('ignores the transparent background left by background removal', async () => {
    const garment = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await solid(30, 60, 170), top: 10, left: 10 }])
      .png().toBuffer()
    expect((await averageColor(garment))?.name).toBe('Xanh dương')
    expect(await averageColor(await solid(0, 0, 0, 0))).toBeNull()
  })

  it('reads each image once and survives broken images', async () => {
    const red = await solid(210, 30, 30)
    const read = vi.fn(async (key: string) => {
      if (key === 'broken') throw new Error('missing')
      return { buffer: red, mimeType: 'image/png' }
    })
    const cache = new GarmentColorCache({ read } as unknown as ImageStorage)
    expect((await cache.colorsOf(['a', 'broken', 'a'])).map(item => item?.name ?? null)).toEqual(['Đỏ', null, 'Đỏ'])
    await cache.colorOf('a')
    expect(read.mock.calls.filter(([key]) => key === 'a').length).toBeLessThanOrEqual(2)
  })
})
