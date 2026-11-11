// @vitest-environment node
import sharp from 'sharp'
import { expect, it, vi } from 'vitest'
import { ReferenceImageEncoder } from './reference-image-encoder.js'

it('coalesces concurrent encoding and expires private image data', async () => {
  const input = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#123456' } }).png().toBuffer()
  const encoder = new ReferenceImageEncoder(1024 * 1024, 50)
  try {
    const [a, b] = await Promise.all([encoder.encode(input), encoder.encode(Buffer.from(input))])
    expect(a).toBe(b)
    expect((await sharp(Buffer.from(a.data, 'base64')).metadata()).format).toBe('webp')
    // A new timer created under fake time can be advanced deterministically.
    encoder.clear()
    vi.useFakeTimers()
    const fresh = await encoder.encode(input)
    vi.advanceTimersByTime(51)
    expect(await encoder.encode(input)).not.toBe(fresh)
  } finally { encoder.clear(); vi.useRealTimers() }
})

it('does not retain over-budget images and clears existing entries', async () => {
  const input = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#123456' } }).png().toBuffer()
  const tiny = new ReferenceImageEncoder(1)
  expect(await tiny.encode(input)).not.toBe(await tiny.encode(input))
  const encoder = new ReferenceImageEncoder()
  const previous = await encoder.encode(input)
  encoder.clear()
  expect(await encoder.encode(input)).not.toBe(previous)
  encoder.clear()
})
