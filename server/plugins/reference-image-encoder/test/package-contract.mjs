import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { ReferenceImageEncoder } from '@hdwc-151/reference-image-encoder'

function png(width, height, background = '#314a77') {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer()
}

test('packages an actual WebP reference, preserves aspect ratio and does not upscale', async () => {
  const encoder = new ReferenceImageEncoder()
  try {
    for (const [width, height, expectedW, expectedH] of [[1600, 800, 1024, 512], [12, 36, 12, 36]]) {
      const encoded = await encoder.encode(await png(width, height))
      const { format, width: w, height: h } = await sharp(Buffer.from(encoded.data, 'base64')).metadata()
      assert.equal(encoded.mimeType, 'image/webp')
      assert.deepEqual([format, w, h], ['webp', expectedW, expectedH])
    }
  } finally { encoder.clear() }
})

test('coalesces identical content, including distinct Buffer objects', async () => {
  const input = await png(40, 20)
  const encoder = new ReferenceImageEncoder()
  try {
    const [first, second] = await Promise.all([encoder.encode(input), encoder.encode(Buffer.from(input))])
    assert.strictEqual(first, second)
    assert.strictEqual(first, await encoder.encode(input))
  } finally { encoder.clear() }
})

test('clear invalidates both pending and completed encodes', async () => {
  const input = await png(80, 60)
  const encoder = new ReferenceImageEncoder()
  try {
    const previous = encoder.encode(input)
    encoder.clear()
    const fresh = encoder.encode(input)
    const [stale, current] = await Promise.all([previous, fresh])
    assert.notStrictEqual(stale, current)
    assert.strictEqual(await encoder.encode(input), current)
    encoder.clear()
    assert.notStrictEqual(await encoder.encode(input), current)
  } finally { encoder.clear() }
})

test('over-budget results and failed encodes do not poison the cache', async () => {
  const encoder = new ReferenceImageEncoder(1)
  try {
    const invalid = Buffer.from('invalid image')
    await assert.rejects(encoder.encode(invalid))
    await assert.rejects(encoder.encode(invalid))
    const input = await png(16, 16)
    assert.notStrictEqual(await encoder.encode(input), await encoder.encode(input))
  } finally { encoder.clear() }
})
