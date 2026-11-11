import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { ImageStorage } from '../storage/image-storage.js'
import { OpenRouterImageProvider } from './openrouter-image-provider.js'

const pngBytes = await sharp({
  create: { width: 32, height: 32, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
}).png().toBuffer()

const createStorage = () => ({
  save: vi.fn(async () => 'generated.png'),
  read: vi.fn(async () => ({ buffer: pngBytes, mimeType: 'image/png' })),
  delete: vi.fn(async () => undefined),
  publicUrl: vi.fn((key: string) => `/uploads/${key}`),
}) satisfies ImageStorage

const localImageResponse = () => new Response(pngBytes, {
  status: 200,
  headers: {
    'content-type': 'image/png',
    'content-length': String(pngBytes.length),
  },
})

describe('OpenRouterImageProvider', () => {
  it('gửi nhiều ảnh tham chiếu tới FLUX và lưu ảnh base64 trả về', async () => {
    const storage = createStorage()
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== 'https://openrouter.ai/api/v1/images') return localImageResponse()
      const body = JSON.parse(String(init?.body)) as {
        model: string
        resolution: string
        aspect_ratio: string
        input_references: Array<{ image_url: { url: string } }>
      }
      expect(body.model).toBe('black-forest-labs/flux-3-image-klein')
      expect(body.resolution).toBe('768')
      expect(body.aspect_ratio).toBe('4:5')
      expect(body.input_references).toHaveLength(4)
      expect(body.input_references.every((item) => item.image_url.url.startsWith('data:image/webp;base64,'))).toBe(true)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-key')
      return new Response(JSON.stringify({
        data: [{
          b64_json: pngBytes.toString('base64'),
          media_type: 'image/png',
        }],
        usage: { cost: 0.008 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const provider = new OpenRouterImageProvider({
      apiKey: 'test-key',
      model: 'black-forest-labs/flux-3-image-klein',
      resolution: '768',
      aspectRatio: '4:5',
      baseUrl: 'http://127.0.0.1:8787',
      outputStorage: storage,
      fetchImpl,
    })

    const result = await provider.generate({
      personImageUrl: '/uploads/person.png',
      garmentImageUrls: ['/uploads/top.png', '/uploads/bottom.png'],
      referenceImageUrl: '/uploads/front.png',
      angle: 'back',
    })

    expect(result).toEqual({
      imageUrl: '/uploads/generated.png',
      storageKey: 'generated.png',
    })
    expect(storage.save).toHaveBeenCalledWith(pngBytes, 'image/png')
    expect(storage.read).toHaveBeenCalledTimes(4)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('map lỗi 402 thành thông báo thiếu số dư', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input) !== 'https://openrouter.ai/api/v1/images') return localImageResponse()
      return new Response(JSON.stringify({ error: { message: 'Insufficient credits' } }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const provider = new OpenRouterImageProvider({
      apiKey: 'test-key',
      model: 'black-forest-labs/flux-3-image-klein',
      resolution: '768',
      aspectRatio: '4:5',
      baseUrl: 'http://127.0.0.1:8787',
      outputStorage: createStorage(),
      fetchImpl,
    })

    await expect(provider.generate({
      personImageUrl: '/uploads/person.png',
      garmentImageUrls: ['/uploads/top.png'],
      angle: 'front',
    })).rejects.toMatchObject({
      code: 'quota_exceeded',
      statusCode: 402,
    })
  })

  it('báo cấu hình khi thiếu API key mà không gọi mạng', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const provider = new OpenRouterImageProvider({
      apiKey: '',
      model: 'black-forest-labs/flux-3-image-klein',
      resolution: '768',
      aspectRatio: '4:5',
      baseUrl: 'http://127.0.0.1:8787',
      outputStorage: createStorage(),
      fetchImpl,
    })

    await expect(provider.generate({
      personImageUrl: '/uploads/person.png',
      garmentImageUrls: ['/uploads/top.png'],
      angle: 'front',
    })).rejects.toMatchObject({
      code: 'provider_unavailable',
      statusCode: 503,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
