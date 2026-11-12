// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const storage = vi.hoisted(() => ({
  getBucket: vi.fn(), createBucket: vi.fn(), upload: vi.fn(), download: vi.fn(),
  createSignedUrl: vi.fn(), remove: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { ...storage, from: () => storage } }),
}))
import { SupabaseImageStorage } from './supabase-image-storage.js'

const makeStorage = () => new SupabaseImageStorage({ url: 'https://project.supabase.co', secretKey: 'server-only-test' })

describe('private Supabase image storage', () => {
  beforeEach(() => {
    Object.values(storage).forEach(mock => mock.mockReset())
    storage.getBucket.mockResolvedValue({ data: { public: false }, error: null })
    storage.createBucket.mockResolvedValue({ data: {}, error: null })
    storage.upload.mockResolvedValue({ data: {}, error: null })
    storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/private/image?token=short-lived' }, error: null })
    storage.remove.mockResolvedValue({ data: [], error: null })
  })

  it('refuses public buckets without changing their access setting', async () => {
    storage.getBucket.mockResolvedValue({ data: { public: true }, error: null })
    await expect(makeStorage().ensureReady()).rejects.toThrow('public bucket')
    expect(storage.createBucket).not.toHaveBeenCalled()
  })

  it('creates a missing private bucket with size and MIME restrictions', async () => {
    storage.getBucket.mockResolvedValueOnce({ data: null, error: { statusCode: '404', message: 'Bucket not found' } })
    await makeStorage().ensureReady()
    expect(storage.createBucket).toHaveBeenCalledWith('tryoh-private', {
      public: false, fileSizeLimit: 8 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    })
  })

  it('fails closed on permission errors instead of creating a replacement bucket', async () => {
    storage.getBucket.mockResolvedValue({ data: null, error: { statusCode: '403', message: 'Forbidden' } })
    await expect(makeStorage().ensureReady()).rejects.toThrow('server key')
    expect(storage.createBucket).not.toHaveBeenCalled()
  })

  it('rechecks privacy after a concurrent bucket creation', async () => {
    storage.getBucket
      .mockResolvedValueOnce({ data: null, error: { statusCode: '404', message: 'Bucket not found' } })
      .mockResolvedValueOnce({ data: { public: true }, error: null })
    storage.createBucket.mockResolvedValue({ error: { statusCode: '409' } })
    await expect(makeStorage().ensureReady()).rejects.toThrow('public bucket')
  })

  it('uploads a real image without overwrite and returns an API ownership-check URL', async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer()
    const bucket = makeStorage()
    const key = await bucket.save(image, 'image/png')
    expect(key).toMatch(/^production_[a-f0-9-]+\.(png|webp)$/)
    expect(storage.upload).toHaveBeenCalledWith(key, expect.any(Buffer), expect.objectContaining({ upsert: false }))
    expect(bucket.publicUrl(key)).toBe('/uploads/' + key)
  })

  it('rejects traversal and foreign prefixes before contacting storage', async () => {
    const bucket = makeStorage()
    for (const key of ['../production_secret.webp', 'other_image.webp', 'production_/secret.webp', 'production_image.svg']) {
      await expect(bucket.read(key)).rejects.toThrow('Invalid private image key')
      await expect(bucket.delete(key)).rejects.toThrow('Invalid private image key')
      await expect(bucket.createReadUrl(key, 300)).rejects.toThrow('Invalid private image key')
    }
    expect(storage.download).not.toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
    expect(storage.createSignedUrl).not.toHaveBeenCalled()
  })

  it('caps signed URL lifetime and downloads exact bytes for AI/proxy reads', async () => {
    const bucket = makeStorage()
    await bucket.createReadUrl('production_image.webp', 99_999)
    expect(storage.createSignedUrl).toHaveBeenCalledWith('production_image.webp', 3_600)
    storage.download.mockResolvedValue({ data: new Blob(['image-bytes'], { type: 'image/webp' }), error: null })
    expect(await bucket.read('production_image.webp')).toEqual({ buffer: Buffer.from('image-bytes'), mimeType: 'image/webp' })
  })

  it('propagates signing, upload and cleanup failures', async () => {
    const bucket = makeStorage()
    storage.createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Unavailable' } })
    await expect(bucket.createReadUrl('production_image.webp', 300)).rejects.toThrow('sign')
    storage.remove.mockResolvedValue({ error: { message: 'Unavailable' } })
    await expect(bucket.delete('production_image.webp')).rejects.toThrow('delete')
    storage.upload.mockResolvedValue({ error: { message: 'Unavailable' } })
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer()
    await expect(bucket.save(image, 'image/png')).rejects.toThrow('upload')
  })
})
