import type { GenerateContentResponse } from '@google/genai'
import { describe, expect, it, vi } from 'vitest'
import type { ImageStorage } from '../storage/image-storage.js'
import { GeminiImageProvider, type GeminiImageProviderOptions } from './gemini-image-provider.js'

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const createStorage = () => ({
  save: vi.fn(async () => 'generated.png'),
  read: vi.fn(async () => ({ buffer: pngBytes, mimeType: 'image/png' })),
  delete: vi.fn(async () => undefined),
  publicUrl: vi.fn((key: string) => `/uploads/${key}`),
}) satisfies ImageStorage

const createFetch = () => vi.fn(async () => new Response(pngBytes, {
  status: 200,
  headers: {
    'content-type': 'image/png',
    'content-length': String(pngBytes.length),
  },
})) as unknown as typeof fetch

const asModelsClient = (
  generateContent: ReturnType<typeof vi.fn>,
): NonNullable<GeminiImageProviderOptions['modelsClient']> => ({
  generateContent,
}) as unknown as NonNullable<GeminiImageProviderOptions['modelsClient']>

describe('GeminiImageProvider', () => {
  it('gửi người, nhiều món đồ và ảnh trước tham chiếu rồi lưu output', async () => {
    const storage = createStorage()
    const generateContent = vi.fn(async (_request: unknown) => ({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              data: pngBytes.toString('base64'),
              mimeType: 'image/png',
            },
          }],
        },
      }],
    } as GenerateContentResponse))
    const provider = new GeminiImageProvider({
      apiKey: 'test-key',
      model: 'test-image-model',
      baseUrl: 'http://127.0.0.1:8787',
      outputStorage: storage,
      modelsClient: asModelsClient(generateContent),
      fetchImpl: createFetch(),
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
    const request = generateContent.mock.calls[0]?.[0] as {
      model: string
      contents: Array<{ text?: string; inlineData?: unknown }>
      config: { responseModalities: string[]; imageConfig: { aspectRatio: string } }
    }
    expect(request.model).toBe('test-image-model')
    expect(request.config.responseModalities).toEqual(['IMAGE'])
    expect(request.config.imageConfig.aspectRatio).toBe('4:5')
    expect(request.contents[0]?.text).toMatch(/back view/i)
    expect(request.contents.filter((part) => part.inlineData)).toHaveLength(4)
  })

  it('trả lỗi content_rejected khi Gemini không trả image part', async () => {
    const generateContent = vi.fn(async (_request: unknown) => ({
      candidates: [{ content: { parts: [{ text: 'Unable to generate.' }] } }],
    } as GenerateContentResponse))
    const provider = new GeminiImageProvider({
      apiKey: 'test-key',
      model: 'test-image-model',
      baseUrl: 'http://127.0.0.1:8787',
      outputStorage: createStorage(),
      modelsClient: asModelsClient(generateContent),
      fetchImpl: createFetch(),
    })

    await expect(provider.generate({
      personImageUrl: '/uploads/person.png',
      garmentImageUrls: ['/uploads/top.png'],
      angle: 'front',
    })).rejects.toMatchObject({
      code: 'content_rejected',
      statusCode: 422,
    })
  })
})
