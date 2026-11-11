import { GoogleGenAI, type GenerateContentResponse, type Part } from '@google/genai'
import { buildTryOnPrompt } from '../prompts/try-on-prompt.js'
import type { ImageStorage } from '../storage/image-storage.js'
import type { GenerateImageInput, GeneratedImage, ImageProvider } from './image-provider.js'
import { ImageProviderError } from './image-provider-error.js'

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024

type GeminiModelsClient = Pick<GoogleGenAI['models'], 'generateContent'>

export type GeminiImageProviderOptions = {
  apiKey: string
  model: string
  baseUrl: string
  outputStorage: ImageStorage
  timeoutMs?: number
  modelsClient?: GeminiModelsClient
  fetchImpl?: typeof fetch
}

type LoadedImage = {
  data: string
  mimeType: string
}

const normalizeMimeType = (value: string | null): string =>
  value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''

const detectMimeType = (buffer: Buffer): string => {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp'
  }
  return ''
}

const statusFromUnknownError = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown }
  for (const value of [candidate.status, candidate.statusCode, candidate.code]) {
    const parsed = typeof value === 'string' ? Number(value) : value
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const mapGeminiError = (error: unknown): ImageProviderError => {
  if (error instanceof ImageProviderError) return error
  const status = statusFromUnknownError(error)
  const message = error instanceof Error ? error.message.toLowerCase() : ''

  if (status === 429 || message.includes('resource_exhausted') || message.includes('quota')) {
    return new ImageProviderError(
      'quota_exceeded',
      429,
      'Đã hết hạn mức Gemini. Vui lòng thử lại sau hoặc kiểm tra tài khoản thanh toán.',
      { cause: error },
    )
  }
  if (
    status === 408
    || status === 504
    || message.includes('timeout')
    || message.includes('timed out')
    || (error instanceof DOMException && error.name === 'TimeoutError')
  ) {
    return new ImageProviderError(
      'timeout',
      504,
      'Gemini xử lý quá thời gian. Vui lòng tạo lại góc ảnh này.',
      { cause: error },
    )
  }
  if (
    status === 400
    || message.includes('blocked')
    || message.includes('safety')
    || message.includes('prohibited')
  ) {
    return new ImageProviderError(
      'content_rejected',
      422,
      'Gemini từ chối xử lý ảnh này. Hãy dùng ảnh toàn thân rõ ràng và phù hợp.',
      { cause: error },
    )
  }
  return new ImageProviderError(
    'provider_unavailable',
    502,
    'Không thể kết nối dịch vụ Gemini. Vui lòng thử lại.',
    { cause: error },
  )
}

export class GeminiImageProvider implements ImageProvider {
  private readonly models: GeminiModelsClient
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: GeminiImageProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('GEMINI_API_KEY chưa được cấu hình.')
    }
    if (!options.model.trim()) {
      throw new Error('GEMINI_IMAGE_MODEL chưa được cấu hình.')
    }
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.fetchImpl = options.fetchImpl ?? fetch
    this.models = options.modelsClient ?? new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: { timeout: this.timeoutMs },
    }).models
  }

  async generate(input: GenerateImageInput): Promise<GeneratedImage> {
    if (input.garmentImageUrls.length === 0) {
      throw new ImageProviderError('invalid_input', 400, 'Cần ít nhất một ảnh món đồ.')
    }

    try {
      const [personImage, ...garmentImages] = await Promise.all([
        this.loadImage(input.personImageUrl),
        ...input.garmentImageUrls.map((url) => this.loadImage(url)),
      ])
      const referenceImage = input.referenceImageUrl
        ? await this.loadImage(input.referenceImageUrl)
        : undefined
      const parts = this.buildParts(input, personImage, garmentImages, referenceImage)
      const response = await this.models.generateContent({
        model: this.options.model,
        contents: parts,
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '4:5',
            imageSize: '1K',
          },
          abortSignal: AbortSignal.timeout(this.timeoutMs),
        },
      })
      const generated = this.extractGeneratedImage(response)
      const storageKey = await this.options.outputStorage.save(
        Buffer.from(generated.data, 'base64'),
        generated.mimeType,
      )
      return {
        imageUrl: this.options.outputStorage.publicUrl(storageKey),
        storageKey,
      }
    } catch (error) {
      throw mapGeminiError(error)
    }
  }

  private buildParts(
    input: GenerateImageInput,
    personImage: LoadedImage,
    garmentImages: LoadedImage[],
    referenceImage?: LoadedImage,
  ): Part[] {
    const isBackWithRef = input.angle === 'back' && Boolean(referenceImage)
    const primaryImage = isBackWithRef && referenceImage ? referenceImage : personImage
    const secondaryImage = isBackWithRef && referenceImage && input.personImageUrl !== input.referenceImageUrl
      ? personImage
      : undefined

    const parts: Part[] = [
      {
        text: buildTryOnPrompt({
          angle: input.angle,
          garmentCount: garmentImages.length,
          hasReferenceImage: Boolean(referenceImage),
          garments: input.garments,
          preservePose: input.preservePose,
        }),
      },
      { text: 'IMAGE 1 — PRIMARY PERSON AND OUTFIT REFERENCE:' },
      { inlineData: primaryImage },
    ]
    garmentImages.forEach((image, index) => {
      parts.push(
        { text: `GARMENT REFERENCE ${index + 1}:` },
        { inlineData: image },
      )
    })
    if (secondaryImage) {
      parts.push(
        { text: 'ORIGINAL PERSON REFERENCE:' },
        { inlineData: secondaryImage },
      )
    } else if (referenceImage && !isBackWithRef) {
      parts.push(
        { text: 'FRONT VIEW CONSISTENCY REFERENCE:' },
        { inlineData: referenceImage },
      )
    }
    return parts
  }

  private async loadImage(source: string): Promise<LoadedImage> {
    let url: URL
    try {
      url = new URL(source, this.options.baseUrl)
    } catch (error) {
      throw new ImageProviderError('invalid_input', 400, 'URL ảnh đầu vào không hợp lệ.', { cause: error })
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ImageProviderError('invalid_input', 400, 'URL ảnh đầu vào không được hỗ trợ.')
    }

    const baseUrl = new URL(this.options.baseUrl)
    if (url.origin === baseUrl.origin && url.pathname.startsWith('/uploads/')) {
      const encodedKey = url.pathname.slice('/uploads/'.length)
      if (!encodedKey || encodedKey.includes('/')) {
        throw new ImageProviderError('invalid_input', 400, 'Đường dẫn ảnh nội bộ không hợp lệ.')
      }
      let key: string
      try {
        key = decodeURIComponent(encodedKey)
      } catch (error) {
        throw new ImageProviderError('invalid_input', 400, 'Đường dẫn ảnh nội bộ không hợp lệ.', { cause: error })
      }
      try {
        const stored = await this.options.outputStorage.read(key)
        if (stored.buffer.length === 0 || stored.buffer.length > MAX_INPUT_IMAGE_BYTES) {
          throw new ImageProviderError('invalid_input', 400, 'Ảnh đầu vào vượt quá 10MB hoặc không có dữ liệu.')
        }
        if (!ALLOWED_IMAGE_TYPES.has(stored.mimeType) || detectMimeType(stored.buffer) !== stored.mimeType) {
          throw new ImageProviderError('invalid_input', 400, 'Ảnh đầu vào có định dạng không hợp lệ.')
        }
        return {
          data: stored.buffer.toString('base64'),
          mimeType: stored.mimeType,
        }
      } catch (error) {
        if (error instanceof ImageProviderError) throw error
        throw new ImageProviderError('invalid_input', 400, 'Không thể đọc ảnh đầu vào trong kho lưu trữ.', { cause: error })
      }
    }

    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, 30_000)),
    })
    if (!response.ok) {
      throw new ImageProviderError(
        'invalid_input',
        400,
        `Không thể đọc ảnh đầu vào (${response.status}).`,
      )
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_INPUT_IMAGE_BYTES) {
      throw new ImageProviderError('invalid_input', 400, 'Ảnh đầu vào vượt quá 10MB.')
    }
    const mimeType = normalizeMimeType(response.headers.get('content-type'))
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new ImageProviderError('invalid_input', 400, 'Ảnh đầu vào phải là JPG, PNG hoặc WebP.')
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_INPUT_IMAGE_BYTES) {
      throw new ImageProviderError('invalid_input', 400, 'Ảnh đầu vào vượt quá 10MB.')
    }
    return { data: buffer.toString('base64'), mimeType }
  }

  private extractGeneratedImage(response: GenerateContentResponse): LoadedImage {
    const parts = response.candidates?.[0]?.content?.parts ?? []
    const imagePart = [...parts].reverse().find((part) => !part.thought && part.inlineData?.data)
    const data = imagePart?.inlineData?.data
    const mimeType = normalizeMimeType(imagePart?.inlineData?.mimeType ?? null)
    if (!data || !ALLOWED_IMAGE_TYPES.has(mimeType)) {
      const reason = response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason
      throw new ImageProviderError(
        'content_rejected',
        422,
        reason
          ? `Gemini không tạo được ảnh (${reason}). Hãy thử ảnh đầu vào khác.`
          : 'Gemini không trả về ảnh. Hãy thử lại với ảnh đầu vào rõ ràng hơn.',
      )
    }
    return { data, mimeType }
  }
}
