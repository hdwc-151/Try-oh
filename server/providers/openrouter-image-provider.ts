import { buildTryOnPrompt } from '../prompts/try-on-prompt.js'
import type { ImageStorage } from '../storage/image-storage.js'
import type { GenerateImageInput, GeneratedImage, ImageProvider } from './image-provider.js'
import { ImageProviderError } from './image-provider-error.js'
import sharp from 'sharp'
import { AiQueueBusyError, aiImageSemaphore } from '../services/ai-concurrency.js'

const OPENROUTER_IMAGE_API_URL = 'https://openrouter.ai/api/v1/images'
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_REFERENCE_IMAGES = 10
const MAX_REFERENCE_EDGE = 1_024

type LoadedImage = {
  data: string
  mimeType: string
}

type OpenRouterImageResponse = {
  data?: Array<{
    b64_json?: string
    b64Json?: string
    media_type?: string
    mediaType?: string
  }>
  usage?: {
    cost?: number
  }
}

export type OpenRouterImageProviderOptions = {
  apiKey: string
  model: string
  resolution: string
  aspectRatio: string
  baseUrl: string
  outputStorage: ImageStorage
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const normalizeMimeType = (value: string | null | undefined): string =>
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

const responseMessage = async (response: Response): Promise<string> => {
  const text = await response.text()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return parsed.error?.message ?? parsed.message ?? text.slice(0, 500)
  } catch {
    return text.slice(0, 500)
  }
}

const mapHttpError = (status: number, detail: string): ImageProviderError => {
  if (status === 401 || status === 403) {
    return new ImageProviderError(
      'provider_unavailable',
      502,
      'OpenRouter API key không hợp lệ hoặc không có quyền dùng model này.',
      { cause: new Error(detail) },
    )
  }
  if (status === 402) {
    return new ImageProviderError(
      'quota_exceeded',
      402,
      'Số dư OpenRouter không đủ. Image API yêu cầu tài khoản còn tối thiểu 1 USD.',
      { cause: new Error(detail) },
    )
  }
  if (status === 429) {
    return new ImageProviderError(
      'quota_exceeded',
      429,
      'OpenRouter đang giới hạn tốc độ. Vui lòng đợi một lát rồi thử lại.',
      { cause: new Error(detail) },
    )
  }
  if (status === 400 || status === 413) {
    return new ImageProviderError(
      'invalid_input',
      400,
      'Dịch vụ chưa được hỗ trợ, vui lòng thử ảnh khác.',
      { cause: new Error(detail) },
    )
  }
  if (status === 422) {
    return new ImageProviderError(
      'content_rejected',
      422,
      'OpenRouter từ chối xử lý nội dung ảnh này. Hãy thử ảnh đầu vào khác.',
      { cause: new Error(detail) },
    )
  }
  if (status === 408 || status === 504) {
    return new ImageProviderError(
      'timeout',
      504,
      'OpenRouter xử lý quá thời gian. Vui lòng thử lại.',
      { cause: new Error(detail) },
    )
  }
  return new ImageProviderError(
    'provider_unavailable',
    502,
    'Không thể kết nối dịch vụ tạo ảnh OpenRouter. Vui lòng thử lại.',
    { cause: new Error(detail) },
  )
}

const mapUnknownError = (error: unknown): ImageProviderError => {
  if (error instanceof ImageProviderError) return error
  if (error instanceof AiQueueBusyError) {
    return new ImageProviderError('provider_unavailable', 503, error.message, { cause: error })
  }
  if (
    (error instanceof DOMException && error.name === 'TimeoutError')
    || (error instanceof Error && error.message.toLowerCase().includes('timeout'))
  ) {
    return new ImageProviderError(
      'timeout',
      504,
      'OpenRouter xử lý quá thời gian. Vui lòng thử lại.',
      { cause: error },
    )
  }
  return new ImageProviderError(
    'provider_unavailable',
    502,
    'Không thể kết nối dịch vụ tạo ảnh OpenRouter. Vui lòng thử lại.',
    { cause: error },
  )
}

export class OpenRouterImageProvider implements ImageProvider {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly options: OpenRouterImageProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  async generate(input: GenerateImageInput): Promise<GeneratedImage> {
    if (!this.options.apiKey.trim()) {
      throw new ImageProviderError(
        'provider_unavailable',
        503,
        'OPENROUTER_API_KEY chưa được cấu hình ở backend.',
      )
    }
    if (!this.options.model.trim()) {
      throw new ImageProviderError('provider_unavailable', 503, 'OPENROUTER_IMAGE_MODEL chưa được cấu hình.')
    }
    if (input.garmentImageUrls.length === 0) {
      throw new ImageProviderError('invalid_input', 400, 'Cần ít nhất một ảnh món đồ.')
    }

    const referenceUrls = input.angle === 'back' && input.referenceImageUrl
      ? (input.referenceImageUrl === input.personImageUrl
          ? [input.referenceImageUrl, ...input.garmentImageUrls]
          : [input.referenceImageUrl, ...input.garmentImageUrls, input.personImageUrl])
      : [
          input.personImageUrl,
          ...input.garmentImageUrls,
          ...(input.referenceImageUrl ? [input.referenceImageUrl] : []),
        ]
    if (referenceUrls.length > MAX_REFERENCE_IMAGES) {
      throw new ImageProviderError('invalid_input', 400, 'FLUX chỉ nhận tối đa 10 ảnh tham chiếu.')
    }

    try {
      return await aiImageSemaphore.run(async () => {
        // Read and re-encode the reference images together; the order is preserved.
        const images: LoadedImage[] = await Promise.all(referenceUrls.map((url) => this.loadImage(url)))
        const response = await this.fetchImpl(OPENROUTER_IMAGE_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          prompt: buildTryOnPrompt({
            angle: input.angle,
            garmentCount: input.garmentImageUrls.length,
            hasReferenceImage: Boolean(input.referenceImageUrl),
            garments: input.garments,
            preservePose: input.preservePose,
          }),
          input_references: images.map((image) => ({
            type: 'image_url',
            image_url: {
              url: `data:${image.mimeType};base64,${image.data}`,
            },
          })),
          resolution: this.options.resolution,
          aspect_ratio: this.options.aspectRatio,
          n: 1,
        }),
          signal: AbortSignal.timeout(this.timeoutMs),
        })

      if (!response.ok) {
        throw mapHttpError(response.status, await responseMessage(response))
      }

      const payload = await response.json() as OpenRouterImageResponse & { data?: Array<{ url?: string }> }
      const first = payload.data?.[0]
      const encoded = first?.b64_json ?? first?.b64Json
      let buffer: Buffer | null = null

      if (encoded) {
        buffer = Buffer.from(encoded, 'base64')
      } else if (first?.url && typeof first.url === 'string') {
        try {
          const imgRes = await this.fetchImpl(first.url)
          if (imgRes.ok) {
            buffer = Buffer.from(await imgRes.arrayBuffer())
          }
        } catch {}
      }

      if (!buffer || buffer.length === 0 || buffer.length > MAX_OUTPUT_IMAGE_BYTES) {
        throw new ImageProviderError(
          'content_rejected',
          422,
          'OpenRouter không trả về ảnh. Hãy thử ảnh đầu vào khác.',
        )
      }
      const declaredMimeType = normalizeMimeType(first?.media_type ?? first?.mediaType)
      const mimeType = ALLOWED_IMAGE_TYPES.has(declaredMimeType)
        ? declaredMimeType
        : detectMimeType(buffer)
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        throw new ImageProviderError('provider_unavailable', 502, 'Định dạng ảnh OpenRouter trả về không được hỗ trợ.')
      }

      const storageKey = await this.options.outputStorage.save(buffer, mimeType)
      const cost = payload.usage?.cost
      if (typeof cost === 'number' && Number.isFinite(cost)) {
        console.info(`OpenRouter image generated [${input.angle}] model=${this.options.model} cost=$${cost.toFixed(6)}`)
      }
        return {
          imageUrl: this.options.outputStorage.publicUrl(storageKey),
          storageKey,
        }
      })
    } catch (error) {
      throw mapUnknownError(error)
    }
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
        const detectedMimeType = detectMimeType(stored.buffer)
        if (!ALLOWED_IMAGE_TYPES.has(stored.mimeType) || detectedMimeType !== stored.mimeType) {
          throw new ImageProviderError('invalid_input', 400, 'Ảnh đầu vào có định dạng không hợp lệ.')
        }
        return this.prepareReference(stored.buffer)
      } catch (error) {
        if (error instanceof ImageProviderError) throw error
        throw new ImageProviderError('invalid_input', 400, 'Không thể đọc ảnh đầu vào trong kho lưu trữ.', { cause: error })
      }
    }

    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, 30_000)),
    })
    if (!response.ok) {
      throw new ImageProviderError('invalid_input', 400, `Không thể đọc ảnh đầu vào (${response.status}).`)
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
    return this.prepareReference(buffer)
  }

  private async prepareReference(buffer: Buffer): Promise<LoadedImage> {
    const prepared = await sharp(buffer, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize({ width: MAX_REFERENCE_EDGE, height: MAX_REFERENCE_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 86, effort: 3 })
      .toBuffer()
    if (prepared.length > MAX_INPUT_IMAGE_BYTES) {
      throw new ImageProviderError('invalid_input', 400, 'Ảnh đầu vào vượt quá giới hạn sau khi tối ưu.')
    }
    return { data: prepared.toString('base64'), mimeType: 'image/webp' }
  }
}
