import { describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { ImageStorage } from '../storage/image-storage.js'
import { GarmentExtractorService, cropGarmentBox } from './garment-extractor.js'

const samplePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Ảnh PNG 4×4 pixel hợp lệ để Sharp có thể decode (dùng trong test FLUX response)
const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNImXYCjhiI4wAA1VIcIVirmxwAAAAASUVORK5CYII=', 'base64')

const createMockStorage = () => {
  let counter = 0
  return {
    save: vi.fn(async () => `extracted_${++counter}.png`),
    read: vi.fn(async () => ({ buffer: samplePng, mimeType: 'image/png' })),
    delete: vi.fn(async () => undefined),
    publicUrl: vi.fn((key: string) => `/uploads/${key}`),
  } satisfies ImageStorage
}

describe('GarmentExtractorService', () => {
  it('ở chế độ mock, trả về món đồ studio mock ngay lập tức', async () => {
    const storage = createMockStorage()
    const extractor = new GarmentExtractorService(storage, { isMock: true })

    const result = await extractor.extractAndGenerate(samplePng, 'image/png', 'tops')

    expect(result).toHaveLength(1)
    expect(result[0]!.category).toBe('tops')
    expect(result[0]!.name).toContain('Áo trong')
    expect(result[0]!.studioImageUrl).toContain('/uploads/extracted_1.png')
    expect(result[0]!.isAiGenerated).toBe(true)
  })

  it('gọi FLUX qua OpenRouter và lưu ảnh studio khi có API key', async () => {
    const storage = createMockStorage()

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('openrouter.ai/api/v1/images')) {
        const body = JSON.parse(String(init?.body)) as {
          model: string
          prompt: string
          input_references: Array<{ image_url: { url: string } }>
        }
        expect(body.model).toBe('black-forest-labs/flux-3-image-klein')
        expect(body.input_references[0]!.image_url.url).toContain('data:image/png;base64,')
        return new Response(
          JSON.stringify({
            data: [{ b64_json: validPng.toString('base64') }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch

    const extractor = new GarmentExtractorService(storage, {
      openrouterApiKey: 'test-or-key',
      fluxModel: 'black-forest-labs/flux-3-image-klein',
      fetchImpl,
    })

    const result = await extractor.extractAndGenerate(samplePng, 'image/png', 'tops')

    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0]!.studioImageUrl).toContain('/uploads/extracted_1.png')
    expect(result[0]!.isAiGenerated).toBe(true)
    expect(result[0]!.category).toBe('tops')
  })

  it('nếu FLUX trả về lỗi thì tự động fallback về ảnh gốc mà không làm crash hệ thống', async () => {
    const storage = createMockStorage()
    const fetchImpl = vi.fn(async () => {
      return new Response('Service Unavailable', { status: 503 })
    }) as unknown as typeof fetch

    const extractor = new GarmentExtractorService(storage, {
      openrouterApiKey: 'test-or-key',
      fetchImpl,
    })

    const result = await extractor.extractAndGenerate(samplePng, 'image/png', 'bottoms')

    expect(result).toHaveLength(1)
    expect(result[0]!.category).toBe('bottoms')
    expect(result[0]!.isAiGenerated).toBe(false)
  })

  it('khi bật extractOutfit, chỉ bóc tách đúng 2 món đồ khác biệt và không sinh món trùng lặp', async () => {
    const storage = createMockStorage()

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [{ b64_json: samplePng.toString('base64') }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    const extractor = new GarmentExtractorService(storage, {
      openrouterApiKey: 'test-or-key',
      fluxModel: 'test-flux-model',
      fetchImpl,
    })

    const result = await extractor.extractAndGenerate(samplePng, 'image/png', 'tops', { extractOutfit: true })

    expect(result).toHaveLength(2)
    expect(result[0]!.category).toBe('tops')
    expect(result[1]!.category).toBe('bottoms')
    expect(result[0]!.category).not.toBe(result[1]!.category)
  })

  it('tự động nhận diện qua Vision AI khi ảnh chỉ có 1 món đồ: chỉ gọi FLUX 1 lần duy nhất', async () => {
    const storage = createMockStorage()
    let fluxCallsCount = 0

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('openrouter.ai/api/v1/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: [
                      {
                        category: 'tops',
                        name: 'Áo cộc tay trắng',
                        description: 'white cotton oversized t-shirt',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      if (url.includes('openrouter.ai/api/v1/images')) {
        fluxCallsCount++
        return new Response(
          JSON.stringify({
            data: [{ b64_json: validPng.toString('base64') }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch

    const extractor = new GarmentExtractorService(storage, {
      openrouterApiKey: 'test-or-key',
      fluxModel: 'test-flux-model',
      visionModel: 'test-vision-model',
      fetchImpl,
    })

    const result = await extractor.extractAndGenerate(samplePng, 'image/png', 'tops')

    expect(result).toHaveLength(1)
    expect(fluxCallsCount).toBe(1)
    expect(result[0]!.name).toBe('Áo cộc tay trắng')
    expect(result[0]!.category).toBe('tops')
  })

  it('tự động nhận diện set đồ gồm áo, quần và vòng cổ: không trùng lặp và đưa đồ chính lên đầu', async () => {
    const storage = createMockStorage()
    let fluxCallsCount = 0

    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('openrouter.ai/api/v1/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: [
                      {
                        category: 'bottoms',
                        name: 'Quần short be',
                        description: 'beige casual shorts',
                      },
                      {
                        category: 'tops',
                        name: 'Áo thun cộc tay',
                        description: 'cream t-shirt',
                      },
                      {
                        category: 'accessories',
                        name: 'Dây chuyền bạc',
                        description: 'silver chain necklace',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      if (url.includes('openrouter.ai/api/v1/images')) {
        fluxCallsCount++
        return new Response(
          JSON.stringify({
            data: [{ b64_json: validPng.toString('base64') }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }

      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch

    const extractor = new GarmentExtractorService(storage, {
      openrouterApiKey: 'test-or-key',
      fluxModel: 'test-flux-model',
      visionModel: 'test-vision-model',
      fetchImpl,
    })

    // defaultCategory là 'tops', kết quả phải đưa 'tops' lên vị trí đầu tiên
    const result = await extractor.extractAndGenerate(samplePng, 'image/png', 'tops')

    expect(result).toHaveLength(3)
    expect(fluxCallsCount).toBe(3)
    // Món đồ chính phải là tops
    expect(result[0]!.category).toBe('tops')
    expect(result[0]!.name).toBe('Áo thun cộc tay')
    // Các món còn lại không trùng
    const categories = result.map((r) => r.category)
    expect(new Set(categories).size).toBe(3)
  })

  it('cropGarmentBox cắt đúng vùng ảnh bounding box của món đồ', async () => {
    const originalBuf = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer()

    const cropped = await cropGarmentBox(originalBuf, [100, 100, 500, 500])
    const meta = await sharp(cropped).metadata()
    expect(meta.width).toBeGreaterThan(0)
    expect(meta.height).toBeGreaterThan(0)
  })
})
