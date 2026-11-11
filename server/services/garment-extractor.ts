import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { GARMENT_CATEGORIES, type GarmentCategory } from '../domain/garment.js'
import type { ImageStorage } from '../storage/image-storage.js'
import { AiQueueBusyError, aiImageSemaphore } from './ai-concurrency.js'

export type ExtractedGarment = {
  id: string
  category: GarmentCategory
  name: string
  description: string
  studioImageUrl: string
  isAiGenerated: boolean
}

export type GarmentExtractorOptions = {
  openrouterApiKey?: string
  fluxModel?: string
  visionModel?: string
  isMock?: boolean
  fetchImpl?: typeof fetch
}

export type ExtractTargetsOptions = {
  extractOutfit?: boolean
  extractAccessories?: boolean
  maxItems?: number
}

const DEFAULT_CATEGORY_NAMES: Record<GarmentCategory, string> = {
  tops: 'Áo trong',
  outerwear: 'Áo khoác',
  bottoms: 'Quần',
  shoes: 'Giày',
  accessories: 'Phụ kiện',
}

const DEFAULT_CATEGORY_DESCRIPTIONS: Record<GarmentCategory, string> = {
  tops: 'top clothing item: shirt, t-shirt, sweater, or blouse',
  outerwear: 'outerwear garment: jacket, blazer, coat, or cardigan',
  bottoms: 'bottom garment: pants, jeans, trousers, shorts, or skirt',
  shoes: 'footwear: shoes, sneakers, boots, or sandals',
  accessories: 'fashion accessories: necklace, watch, bag, hat, or glasses',
}

const OPENROUTER_IMAGE_API_URL = 'https://openrouter.ai/api/v1/images'
const OPENROUTER_CHAT_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const MAX_DETECTED_TARGETS = 5
const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_GENERATED_BASE64_CHARS = Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4

export type GarmentTarget = {
  category: GarmentCategory
  name: string
  description: string
  box_2d?: [number, number, number, number] // [ymin, xmin, ymax, xmax] on 0-1000 scale
}

export async function cropGarmentBox(
  imageBuffer: Buffer,
  box: [number, number, number, number],
): Promise<Buffer> {
  const image = sharp(imageBuffer)
  const meta = await image.metadata()
  const width = meta.width ?? 1000
  const height = meta.height ?? 1000

  const rawTop = Math.floor((box[0] / 1000) * height)
  const rawLeft = Math.floor((box[1] / 1000) * width)
  const rawBottom = Math.ceil((box[2] / 1000) * height)
  const rawRight = Math.ceil((box[3] / 1000) * width)

  const rawW = Math.max(30, rawRight - rawLeft)
  const rawH = Math.max(30, rawBottom - rawTop)

  // Thêm 15% padding để không bị chém lẹm vào viền món đồ
  const padX = Math.round(rawW * 0.15)
  const padY = Math.round(rawH * 0.15)

  let left = Math.max(0, rawLeft - padX)
  let top = Math.max(0, rawTop - padY)
  let right = Math.min(width, rawRight + padX)
  let bottom = Math.min(height, rawBottom + padY)

  let cropW = Math.max(30, right - left)
  let cropH = Math.max(30, bottom - top)

  // Đảm bảo kích thước tối thiểu 256px để FLUX không từ chối vì ảnh quá nhỏ
  const MIN_DIM = 256
  if (cropW < MIN_DIM && width >= MIN_DIM) {
    const diff = MIN_DIM - cropW
    left = Math.max(0, left - Math.floor(diff / 2))
    right = Math.min(width, left + MIN_DIM)
    if (right - left < MIN_DIM) left = Math.max(0, right - MIN_DIM)
    cropW = right - left
  }
  if (cropH < MIN_DIM && height >= MIN_DIM) {
    const diff = MIN_DIM - cropH
    top = Math.max(0, top - Math.floor(diff / 2))
    bottom = Math.min(height, top + MIN_DIM)
    if (bottom - top < MIN_DIM) top = Math.max(0, bottom - MIN_DIM)
    cropH = bottom - top
  }

  return image
    .extract({ left, top, width: cropW, height: cropH })
    .png()
    .toBuffer()
}

function parseBox2d(val: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(val) || val.length !== 4) return undefined
  const y1 = Number(val[0])
  const x1 = Number(val[1])
  const y2 = Number(val[2])
  const x2 = Number(val[3])
  if (isNaN(y1) || isNaN(x1) || isNaN(y2) || isNaN(x2)) return undefined
  if (y2 <= y1 || x2 <= x1) return undefined
  // Nếu tọa độ ở thang 0..1 (float), đổi sang 0..1000
  if (y2 <= 1.0 && x2 <= 1.0 && (y2 > 0 || x2 > 0)) {
    return [Math.round(y1 * 1000), Math.round(x1 * 1000), Math.round(y2 * 1000), Math.round(x2 * 1000)]
  }
  return [Math.round(y1), Math.round(x1), Math.round(y2), Math.round(x2)]
}

export class GarmentExtractorService {
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly images: ImageStorage,
    private readonly options: GarmentExtractorOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async extractAndGenerate(
    imageBuffer: Buffer,
    mimeType: string,
    defaultCategory: GarmentCategory = 'tops',
    extractOptions?: ExtractTargetsOptions,
  ): Promise<ExtractedGarment[]> {
    // 1. Chế độ mock: trả về dữ liệu mẫu không tốn quota
    if (this.options.isMock) {
      return this.generateMockExtraction(imageBuffer, mimeType, defaultCategory)
    }

    // 2. Tự động nhận diện chính xác các món đồ có trong ảnh (Quần, Áo, Vòng cổ, Đồng hồ...)
    // Nếu có chỉ định tùy chọn thủ công (legacy/tests), sử dụng getTargetGarments
    let targets: GarmentTarget[]
    if (extractOptions && (extractOptions.extractOutfit !== undefined || extractOptions.extractAccessories !== undefined)) {
      targets = this.getTargetGarments(defaultCategory, extractOptions)
    } else {
      targets = await this.detectGarmentsWithVision(imageBuffer, mimeType, defaultCategory)
    }

    const requestedLimit = extractOptions?.maxItems
    const targetLimit = Number.isInteger(requestedLimit) && Number(requestedLimit) >= 0
      ? Math.min(MAX_DETECTED_TARGETS, Number(requestedLimit))
      : MAX_DETECTED_TARGETS
    targets = targets.slice(0, targetLimit)

    // 3. Gọi model FLUX tuần tự từng món và qua semaphore dùng chung để bảo vệ RAM instance.
    const results: ExtractedGarment[] = []

    for (const item of targets) {
      try {
        const generated = await aiImageSemaphore.run(() => this.generateWithFlux(item, imageBuffer, mimeType))
        results.push(generated)
      } catch (err) {
        // No provider work started when the shared queue is saturated. Surface
        // a retryable error so the reserved credits are refunded.
        if (err instanceof AiQueueBusyError) throw err
        const reason = err instanceof Error ? err.message : String(err)
        // Phân biệt rõ lỗi có tốn phí (HTTP 200 nhưng payload hỏng) vs không tốn phí (HTTP 4xx/5xx/timeout)
        const chargedLikely = reason.includes('invalid image payload') || reason.includes('empty image payload')
        console.warn(
          `[AI Extract] FLUX item generation failed for "${item.name}"; using safe fallback.` +
          ` Reason: ${reason}` +
          (chargedLikely ? ' [WARNING: API may have charged for this request]' : ' [No charge expected]'),
        )
        try {
          // Fallback: Lưu ảnh crop riêng biệt của món đồ này thay vì lưu cả tấm ảnh lớn hỗn hợp
          const fallbackBuf = item.box_2d
            ? await cropGarmentBox(imageBuffer, item.box_2d)
            : imageBuffer
          const fallbackKey = await this.images.save(fallbackBuf, 'image/png')
          results.push({
            id: randomUUID(),
            category: item.category,
            name: item.name,
            description: item.description,
            studioImageUrl: this.images.publicUrl(fallbackKey),
            isAiGenerated: false,
          })
        } catch {}
      }
    }

    // Nếu tất cả lệnh gọi FLUX đều lỗi, fallback lưu buffer ảnh gốc cho món đồ chính
    if (results.length === 0) {
      const fallbackKey = await this.images.save(imageBuffer, mimeType)
      results.push({
        id: randomUUID(),
        category: defaultCategory,
        name: DEFAULT_CATEGORY_NAMES[defaultCategory] || 'Món đồ',
        description: DEFAULT_CATEGORY_DESCRIPTIONS[defaultCategory] || 'clothing item',
        studioImageUrl: this.images.publicUrl(fallbackKey),
        isAiGenerated: false,
      })
    }

    return results
  }

  private async detectGarmentsWithVision(
    imageBuffer: Buffer,
    mimeType: string,
    defaultCategory: GarmentCategory,
  ): Promise<GarmentTarget[]> {
    const apiKey = this.options.openrouterApiKey || process.env.OPENROUTER_API_KEY
    const model = this.options.visionModel || process.env.OPENROUTER_VISION_MODEL

    if (!apiKey) {
      return [this.createFallbackTarget(defaultCategory)]
    }

    if (!model) {
      console.warn('[Vision AI] OPENROUTER_VISION_MODEL chưa được cấu hình trong file .env. Bỏ qua bước tự động nhận diện.')
      return [this.createFallbackTarget(defaultCategory)]
    }

    const systemPrompt = `You are an expert AI fashion catalog inspector and item locator.
Analyze this fashion image and detect the primary, clearly visible clothing items and prominent accessories.

Allowed categories:
- "tops": upper garments (shirt, t-shirt, polo, hoodie, sweater).
- "outerwear": jackets, coats, blazers, cardigans.
- "bottoms": lower garments (pants, jeans, trousers, shorts, skirt).
- "shoes": footwear (sneakers, shoes, boots, sandals, loafers).
- "accessories": fashion accessories (bags, handbags, backpacks, watches/wristwatches, sunglasses, hats, scarves, necklaces).

CRITICAL RULES:
1. ONLY 1 ITEM RULE: If the photo shows ONLY a single standalone garment (e.g. flat lay of just one shirt or pants), return ONLY that 1 item.
2. OUTFIT PHOTOS: Detect the primary standalone outfit pieces and visible accessories (maximum 4 to 5 items total):
   - The main top or outerwear. If an inner shirt is mostly hidden beneath a closed/buttoned jacket, ONLY detect the outerwear jacket! DO NOT detect a tiny sliver of an undershirt.
   - The bottom garment (skirt or pants).
   - The footwear (shoes) if clearly shown.
   - Visible fashion accessories (e.g. handbag/bag, wristwatch/watch, sunglasses, hat, necklace) if clearly worn or held.
   - DO NOT detect socks, underwear, phone cases, or tiny buttons.
3. FLAT-LAY COLLECTIONS: If the photo is a flat-lay of accessories, detect each distinct item (e.g. sunglasses, bag, scarf, watch, necklace), max 5 items.
4. PRECISE BOUNDING BOXES (box_2d): For each item, provide its exact 2D bounding box as [ymin, xmin, ymax, xmax] normalized on a 0-1000 scale.
5. Provide concise Vietnamese for "name" (e.g. "Áo khoác kẻ caro", "Chân váy đen", "Túi xách da nâu", "Đồng hồ dây da", "Giày loafer nâu").
6. Provide precise English for "description" detailing color, pattern, material, and cut for studio product photography.

Return strictly a JSON object:
{
  "items": [
    {
      "category": "tops" | "bottoms" | "outerwear" | "shoes" | "accessories",
      "name": "concise Vietnamese name",
      "description": "precise English description",
      "box_2d": [ymin, xmin, ymax, xmax]
    }
  ]
}`

    const userPrompt = `Identify and locate every individual clothing item and fashion accessory in this photo with its box_2d. The user is adding this under category: "${defaultCategory}". If only 1 item is shown, output only that 1 item.`

    try {
      const res = await this.fetchImpl(OPENROUTER_CHAT_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://fitting-room.local',
          'X-Title': 'Fitting Room Garment Extractor',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: userPrompt,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
                  },
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        console.warn(`Vision detection returned HTTP ${res.status}, falling back to single target.`)
        return [this.createFallbackTarget(defaultCategory)]
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const rawContent = json.choices?.[0]?.message?.content
      if (!rawContent) {
        return [this.createFallbackTarget(defaultCategory)]
      }

      let cleanJson = rawContent.trim()
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      }

      const parsed = JSON.parse(cleanJson) as
        | { items?: Array<{ category?: string; name?: string; description?: string; box_2d?: unknown; box?: unknown }> }
        | Array<{ category?: string; name?: string; description?: string; box_2d?: unknown; box?: unknown }>
      const rawList = Array.isArray(parsed) ? parsed : parsed.items || []

      const validTargets: GarmentTarget[] = []
      const seenKeys = new Set<string>()

      for (const raw of rawList.slice(0, MAX_DETECTED_TARGETS)) {
        const cat = raw.category?.toLowerCase() as GarmentCategory
        if (!cat || !GARMENT_CATEGORIES.includes(cat)) continue

        const name = (raw.name || DEFAULT_CATEGORY_NAMES[cat] || 'Món đồ').trim()
        const description = (raw.description || DEFAULT_CATEGORY_DESCRIPTIONS[cat] || 'clothing item').trim()
        const box_2d = parseBox2d(raw.box_2d ?? raw.box)

        const key = cat === 'accessories' ? `acc_${name.toLowerCase().replace(/[^a-z0-9]/g, '')}` : cat
        if (seenKeys.has(key)) continue
        seenKeys.add(key)

        validTargets.push({
          category: cat,
          name,
          description,
          box_2d,
        })
      }

      if (validTargets.length === 0) {
        return [this.createFallbackTarget(defaultCategory)]
      }

      // Reorder so that the target matching defaultCategory is placed at index 0 (primary item)
      const primaryIdx = validTargets.findIndex((t) => t.category === defaultCategory)
      if (primaryIdx > 0) {
        const [primary] = validTargets.splice(primaryIdx, 1)
        validTargets.unshift(primary!)
      }

      return validTargets
    } catch {
      console.warn('[AI Extract] Vision detection failed; using default category')
      return [this.createFallbackTarget(defaultCategory)]
    }
  }

  private createFallbackTarget(category: GarmentCategory): GarmentTarget {
    return {
      category,
      name: DEFAULT_CATEGORY_NAMES[category] || 'Món đồ chính',
      description: DEFAULT_CATEGORY_DESCRIPTIONS[category] || 'clothing item',
    }
  }

  private getTargetGarments(
    defaultCategory: GarmentCategory,
    options: ExtractTargetsOptions = {},
  ): GarmentTarget[] {
    const primaryTarget: GarmentTarget = {
      category: defaultCategory,
      name: DEFAULT_CATEGORY_NAMES[defaultCategory] || 'Món đồ chính',
      description: DEFAULT_CATEGORY_DESCRIPTIONS[defaultCategory] || 'clothing item',
    }

    const targets: GarmentTarget[] = [primaryTarget]

    // 1. Nếu chọn tách cả set đồ phối: Chỉ tách thêm đúng 1 món đồ phối tương ứng (Quần hoặc Áo)
    if (options.extractOutfit) {
      if (defaultCategory === 'tops') {
        targets.push({
          category: 'bottoms',
          name: 'Quần / Váy',
          description: 'bottom garment: pants, trousers, jeans, or skirt from the outfit',
        })
      } else if (defaultCategory === 'bottoms') {
        targets.push({
          category: 'tops',
          name: 'Áo trong',
          description: 'top garment: shirt, t-shirt, or blouse from the outfit',
        })
      } else if (defaultCategory === 'outerwear') {
        targets.push({
          category: 'tops',
          name: 'Áo trong',
          description: 'inner top garment: shirt or t-shirt from the outfit',
        })
      }
    }

    // 2. Nếu chọn tách phụ kiện: Bóc tách riêng trang sức/phụ kiện (Vòng cổ, Đồng hồ, Túi xách...)
    // Sử dụng prompt chuyên biệt về trang sức để FLUX không bao giờ sinh lại áo
    if (options.extractAccessories && defaultCategory !== 'accessories') {
      targets.push({
        category: 'accessories',
        name: 'Phụ kiện (Vòng cổ / Đồng hồ)',
        description: 'the jewelry accessories: necklace, chain, wristwatch, watch, or wearable accessories worn in the reference image',
      })
    }

    return targets
  }

  private async generateWithFlux(
    item: GarmentTarget,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<ExtractedGarment> {
    const apiKey = this.options.openrouterApiKey || process.env.OPENROUTER_API_KEY
    const model = this.options.fluxModel || process.env.OPENROUTER_IMAGE_MODEL

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured in .env.')
    }

    if (!model) {
      throw new Error('OPENROUTER_IMAGE_MODEL is not configured in .env. Vui lòng cấu hình OPENROUTER_IMAGE_MODEL trong file .env.')
    }

    let referenceBuffer = imageBuffer
    let referenceMimeType = mimeType

    // Nếu đối tượng có bounding box phát hiện bởi Vision AI, crop riêng phần đó để FLUX không bị lẫn các món khác
    if (item.box_2d) {
      try {
        referenceBuffer = await cropGarmentBox(imageBuffer, item.box_2d)
        referenceMimeType = 'image/png'
      } catch {
        console.warn('[AI Extract] Crop failed; using validated source image')
      }
    }

    const fluxPrompt = `Professional high-end commercial e-commerce studio product photograph of ONLY this single item: ${item.name} (${item.description}) isolated from the reference image. Clean product display laid completely flat on pure solid white background, front view, centered, ultra-sharp detail, soft commercial studio lighting, 8k resolution, no person, no body parts, no human face, no model, no other objects or accessories, strictly ONLY this one single ${item.name}.`

    const payload = {
      model,
      prompt: fluxPrompt,
      input_references: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${referenceMimeType};base64,${referenceBuffer.toString('base64')}`,
          },
        },
      ],
      resolution: '768',
      aspect_ratio: '1:1',
      n: 1,
    }

    let res: Response | null = null
    let attempts = 0
    while (attempts < 2) {
      attempts++
      res = await this.fetchImpl(OPENROUTER_IMAGE_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      })

      if (res.status === 429 && attempts < 2) {
        console.warn('[AI Extract] OpenRouter rate limited; retrying once')
        await new Promise((r) => setTimeout(r, 2500))
        continue
      }
      break
    }

    if (!res || !res.ok) {
      throw new Error(`OpenRouter FLUX returned HTTP ${res?.status ?? 'unknown'}`)
    }

    const rawBody = await res.text()
    let data: { data?: Array<{ b64_json?: string; b64Json?: string }>; usage?: { cost?: number }; error?: { message?: string } }
    try {
      data = JSON.parse(rawBody) as typeof data
    } catch {
      throw new Error(`OpenRouter FLUX returned non-JSON response (HTTP ${res.status}).`)
    }

    // Log chi phí thực tế nếu có để debug billing
    if (data.usage?.cost !== undefined) {
      console.info(`[AI Extract] FLUX garment item cost=$${data.usage.cost.toFixed(6)}`)
    }

    // Nếu API trả về lỗi trong body (HTTP 200 nhưng có error field) thì throw ngay — không mất phí thực sự
    if (data.error?.message) {
      throw new Error(`OpenRouter FLUX error: ${data.error.message}`)
    }

    const firstItem = data.data?.[0] as { b64_json?: string; b64Json?: string; url?: string } | undefined
    const b64 = firstItem?.b64_json || firstItem?.b64Json
    let outputBuffer: Buffer | null = null

    if (b64 && b64.length <= MAX_GENERATED_BASE64_CHARS) {
      outputBuffer = Buffer.from(b64, 'base64')
    } else if (firstItem?.url && typeof firstItem.url === 'string') {
      try {
        const imgRes = await this.fetchImpl(firstItem.url)
        if (imgRes.ok) {
          outputBuffer = Buffer.from(await imgRes.arrayBuffer())
        }
      } catch (err) {
        console.warn(`[AI Extract] Failed to download image from OpenRouter URL: ${String(err)}`)
      }
    }

    if (!outputBuffer || outputBuffer.length === 0 || outputBuffer.length > MAX_GENERATED_IMAGE_BYTES) {
      throw new Error('OpenRouter FLUX returned empty or invalid image payload.')
    }

    // Dùng Sharp để validate và chuyển đổi bất kỳ định dạng nào (PNG/JPEG/WebP/AVIF) về PNG chuẩn
    // Tránh trường hợp FLUX trả về WebP hoặc định dạng khác làm code cũ ném lỗi dù ảnh hợp lệ
    let pngBuffer: Buffer
    try {
      const meta = await sharp(outputBuffer).metadata()
      if (!meta.width || !meta.height || meta.width < 4 || meta.height < 4) {
        throw new Error(`Image dimensions too small: ${meta.width}x${meta.height}`)
      }
      pngBuffer = await sharp(outputBuffer).png().toBuffer()
      console.info(`[AI Extract] FLUX image OK format=${meta.format} size=${outputBuffer.length} -> png`)
    } catch (sharpErr) {
      throw new Error(`OpenRouter FLUX returned an image Sharp cannot decode: ${sharpErr instanceof Error ? sharpErr.message : String(sharpErr)}`)
    }

    const key = await this.images.save(pngBuffer, 'image/png')

    return {
      id: randomUUID(),
      category: item.category,
      name: item.name,
      description: item.description,
      studioImageUrl: this.images.publicUrl(key),
      isAiGenerated: true,
    }
  }

  private async generateMockExtraction(
    imageBuffer: Buffer,
    mimeType: string,
    defaultCategory: GarmentCategory,
  ): Promise<ExtractedGarment[]> {
    const key = await this.images.save(imageBuffer, mimeType)
    const url = this.images.publicUrl(key)

    return [
      {
        id: randomUUID(),
        category: defaultCategory,
        name: `${DEFAULT_CATEGORY_NAMES[defaultCategory]} Studio`,
        description: `Mock studio product for ${defaultCategory}`,
        studioImageUrl: url,
        isAiGenerated: true,
      },
    ]
  }
}
