import type { ImageProvider } from './image-provider.js'
import type { ImageStorage } from '../storage/image-storage.js'
import { GeminiImageProvider } from './gemini-image-provider.js'
import { MockImageProvider } from './mock-image-provider.js'
import { OpenRouterImageProvider } from './openrouter-image-provider.js'

type ProviderFactoryOptions = {
  port: number
}

export function createImageProvider(
  images: ImageStorage,
  { port }: ProviderFactoryOptions,
): ImageProvider {
  const provider = process.env.IMAGE_PROVIDER ?? 'mock'
  const baseUrl = process.env.APP_BASE_URL
    ?? process.env.RENDER_EXTERNAL_URL
    ?? `http://127.0.0.1:${port}`
  if (provider === 'mock') {
    return new MockImageProvider(Number(process.env.MOCK_DELAY_MS ?? 2000))
  }
  if (provider === 'gemini') {
    return new GeminiImageProvider({
      apiKey: process.env.GEMINI_API_KEY ?? '',
      model: process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image',
      baseUrl,
      timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 120_000),
      outputStorage: images,
    })
  }
  if (provider === 'openrouter') {
    const model = process.env.OPENROUTER_IMAGE_MODEL
    if (!model) {
      throw new Error('OPENROUTER_IMAGE_MODEL is not configured in .env. Vui lòng cấu hình OPENROUTER_IMAGE_MODEL trong file .env.')
    }
    return new OpenRouterImageProvider({
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
      model,
      resolution: process.env.OPENROUTER_IMAGE_RESOLUTION ?? '768',
      aspectRatio: process.env.OPENROUTER_IMAGE_ASPECT_RATIO ?? '4:5',
      baseUrl,
      timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS ?? 120_000),
      outputStorage: images,
    })
  }
  throw new Error(`IMAGE_PROVIDER="${provider}" không được hỗ trợ. Dùng "mock", "gemini" hoặc "openrouter".`)
}
