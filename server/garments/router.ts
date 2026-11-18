import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import sharp from 'sharp'
import { GARMENT_CATEGORIES, type GarmentCategory, type GarmentRecord, type GarmentResponse } from './garment.js'
import type { GarmentRepository } from './garment-repository.js'
import type { ImageStorage } from '../storage/image-storage.js'
import { GarmentExtractorService, MAX_DETECTED_TARGETS } from './garment-extractor.js'
import type { SocialService } from '../social/social-service.js'
import { runtimeConfig } from '../config/runtime-config.js'
import { createImageUpload, validateImageContent } from '../http/image-upload.js'
import { createFixedWindowRateLimit, MemoryRateLimitStore, type RateLimitStore } from '../http/rate-limit.js'
import type { PlanService } from '../plans/plan-service.js'
import { pageMetadata, parsePagination } from '../http/pagination.js'
import type { CreditService } from '../credits/credit-service.js'
import type { CreditReservation } from '../credits/types.js'
import { AuthError } from '../auth/auth-service.js'
import { discardImages, ImmediateStorageCleanup, type StorageCleanup } from '../storage/storage-cleanup.js'
import { GarmentColorCache } from './garment-colors.js'

const upload = createImageUpload(4)
const MAX_GARMENTS_PER_USER = 20

const uploadFields = upload.fields([
  { name: 'frontOriginal', maxCount: 1 },
  { name: 'frontProcessed', maxCount: 1 },
  { name: 'backOriginal', maxCount: 1 },
  { name: 'backProcessed', maxCount: 1 },
])

const toResponse = (record: GarmentRecord, images: ImageStorage): GarmentResponse => ({
  id: record.id,
  name: record.name,
  category: record.category,
  frontOriginalUrl: images.publicUrl(record.frontOriginalKey),
  frontProcessedUrl: images.publicUrl(record.frontProcessedKey),
  backOriginalUrl: record.backOriginalKey ? images.publicUrl(record.backOriginalKey) : null,
  backProcessedUrl: record.backProcessedKey ? images.publicUrl(record.backProcessedKey) : null,
  createdAt: record.createdAt,
})

type GarmentFiles = Partial<Record<string, Express.Multer.File[]>>

export function createGarmentRouter(
  repository: GarmentRepository,
  images: ImageStorage,
  extractor?: GarmentExtractorService,
  social?: SocialService,
  plans?: PlanService,
  rateLimits: RateLimitStore = new MemoryRateLimitStore(),
  credits?: CreditService,
  cleanup: StorageCleanup = new ImmediateStorageCleanup(images),
) {
  const router = Router()
  const colorCache = new GarmentColorCache(images)
  const singleUpload = upload.single('file')
  const aiRateLimit = createFixedWindowRateLimit({
    max: runtimeConfig.aiRequestsPerWindow,
    windowMs: runtimeConfig.aiRequestWindowMs,
    namespace: 'ai.extract.user',
    store: rateLimits,
    key: (request) => `${request.authUser.id}:${request.ip ?? 'unknown'}`,
  })
  const wardrobeLimit = async (user: Express.Request['authUser']) =>
    plans ? (await plans.status(user)).entitlements.wardrobeItems : MAX_GARMENTS_PER_USER

  router.get('/', async (request, response, next) => {
    try {
      const page = parsePagination(request.query)
      const items = await repository.list(request.authUser.id, page)
      const total = page ? await repository.count(request.authUser.id) : items.length
      response.json({ items: items.map((item) => toResponse(item, images)), ...pageMetadata(page?.offset ?? 0, items.length, total) })
    } catch (error) {
      next(error)
    }
  })

  // Màu chủ đạo từng món (cho thống kê tủ đồ). Tính trên ảnh đã tách nền, có cache theo khoá ảnh.
  router.get('/colors', async (request, response, next) => {
    try {
      const items = await repository.list(request.authUser.id, { limit: 300, offset: 0 })
      const colors = await colorCache.colorsOf(items.map(item => item.frontProcessedKey || item.frontOriginalKey))
      response.json({ items: items.map((item, index) => ({ id: item.id, ...(colors[index] ?? { hex: null, name: null }) })) })
    } catch (error) {
      next(error)
    }
  })

  router.post('/ai-extract', aiRateLimit, singleUpload, async (request, response, next) => {
    let reservation: CreditReservation | null = null
    let outstandingCredits = 0
    try {
      const maxItems = await wardrobeLimit(request.authUser)
      const existingCount = await repository.count(request.authUser.id)
      const remainingSlots = Math.max(0, maxItems - existingCount)
      if (remainingSlots === 0) {
        response.status(409).json({ message: `Gói hiện tại lưu tối đa ${maxItems} món trong tủ đồ.` })
        return
      }
      // Validate and decode the upload before touching credits, so a missing or
      // malformed file can never leave reserved credits behind.
      const file = request.file
      if (!file) {
        response.status(400).json({ message: 'Vui lòng tải lên một ảnh để tách nền và tái tạo bằng FLUX.' })
        return
      }
      await validateImageContent(file)
      const optimizedInput = await sharp(file.buffer, { limitInputPixels: 24_000_000 })
        .rotate()
        .resize({ width: 1_536, height: 1_536, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88, effort: 3 })
        .toBuffer()

      let maxGeneratedItems = Math.min(remainingSlots, MAX_DETECTED_TARGETS)
      if (credits) {
        const status = await credits.status(request.authUser)
        if (!status.unlimited) maxGeneratedItems = Math.min(maxGeneratedItems, status.remaining ?? 0)
        if (maxGeneratedItems <= 0) {
          throw new AuthError(402, 'Bạn đã dùng hết lượt tạo ảnh. Hãy đăng ký gói phù hợp để tiếp tục.')
        }
        // tryConsume is atomic: if the balance dropped since status(), this throws 402
        // and nothing is reserved.
        reservation = await credits.reserve(request.authUser, maxGeneratedItems)
        outstandingCredits = reservation.amount
      }

      const defaultCategory = (GARMENT_CATEGORIES.includes(request.body.category)
        ? request.body.category
        : 'tops') as GarmentCategory

      const hasManualOptions =
        request.body.extractOutfit !== undefined || request.body.extractAccessories !== undefined
      const extractOptions = hasManualOptions
        ? {
            extractOutfit: request.body.extractOutfit === 'true' || request.body.extractOutfit === true,
            extractAccessories: request.body.extractAccessories === 'true' || request.body.extractAccessories === true,
          }
        : undefined

      console.info(`[AI Extract] Started category=${defaultCategory} autoDetect=${!hasManualOptions}`)

      const activeExtractor = extractor ?? new GarmentExtractorService(images, {
        isMock: process.env.IMAGE_PROVIDER === 'mock',
        openrouterApiKey: process.env.OPENROUTER_API_KEY,
        fluxModel: process.env.OPENROUTER_IMAGE_MODEL,
        visionModel: process.env.OPENROUTER_VISION_MODEL,
      })

      const items = await activeExtractor.extractAndGenerate(
        optimizedInput,
        'image/webp',
        defaultCategory,
        { ...extractOptions, maxItems: maxGeneratedItems },
      )

      if (credits && reservation) {
        const unused = Math.max(0, reservation.amount - items.length)
        if (unused > 0) await credits.refund(request.authUser, { ...reservation, amount: unused })
        outstandingCredits = Math.min(reservation.amount, items.length)
      }

      console.info(`[AI Extract] Completed items=${items.length}`)
      const persist = request.body.persist === 'true' || request.body.persist === true
      if (persist) {
        const garments: GarmentResponse[] = []
        for (const item of items) {
          if (!item.studioImageUrl.startsWith('/uploads/')) continue
          const key = decodeURIComponent(item.studioImageUrl.slice('/uploads/'.length))
          const record: GarmentRecord = {
            id: randomUUID(),
            userId: request.authUser.id,
            name: item.name.slice(0, 80) || 'Món đồ mới',
            category: item.category,
            frontOriginalKey: key,
            frontProcessedKey: key,
            backOriginalKey: null,
            backProcessedKey: null,
            createdAt: new Date().toISOString(),
          }
          const created = await repository.createIfBelowLimit(record, maxItems)
          if (!created) {
            await discardImages(cleanup, [key], 'wardrobe_limit_reached')
            continue
          }
          garments.push(toResponse(created, images))
        }
        outstandingCredits = 0
        response.json({ items, garments })
        return
      }
      for (const item of items) if (item.studioImageUrl.startsWith('/uploads/')) {
        await social?.trackTemporaryImage(request.authUser.id, decodeURIComponent(item.studioImageUrl.slice('/uploads/'.length)))
      }

      outstandingCredits = 0
      response.json({ items })
    } catch (error) {
      if (credits && reservation && outstandingCredits > 0) {
        try {
          await credits.refund(request.authUser, { ...reservation, amount: outstandingCredits })
        } catch (refundError) {
          console.error('[AI Extract] Could not refund reserved credits:', refundError instanceof Error ? refundError.message : 'Unknown error')
        }
      }
      console.warn('[AI Extract] Failed safely')
      next(error)
    }
  })

  router.post('/', uploadFields, async (request, response, next) => {
    const savedKeys: string[] = []
    try {
      const maxItems = await wardrobeLimit(request.authUser)
      if (await repository.count(request.authUser.id) >= maxItems) {
        response.status(409).json({ message: `Gói hiện tại lưu tối đa ${maxItems} món trong tủ đồ.` })
        return
      }
      const name = typeof request.body.name === 'string' ? request.body.name.trim() : ''
      const category = request.body.category
      const files = request.files as GarmentFiles
      const frontOriginal = files.frontOriginal?.[0]
      const frontProcessed = files.frontProcessed?.[0]
      const backOriginal = files.backOriginal?.[0]
      const backProcessed = files.backProcessed?.[0]

      if (!name || name.length > 80) {
        response.status(400).json({ message: 'Tên món đồ phải từ 1 đến 80 ký tự.' })
        return
      }
      if (!GARMENT_CATEGORIES.includes(category)) {
        response.status(400).json({ message: 'Loại đồ không hợp lệ.' })
        return
      }
      if (!frontOriginal || !frontProcessed) {
        response.status(400).json({ message: 'Cần ảnh mặt trước gốc và ảnh đã tách nền.' })
        return
      }
      if ((backOriginal && !backProcessed) || (!backOriginal && backProcessed)) {
        response.status(400).json({ message: 'Ảnh mặt sau cần đủ bản gốc và bản đã tách nền.' })
        return
      }

      await Promise.all(
        [frontOriginal, frontProcessed, backOriginal, backProcessed]
          .filter((file): file is Express.Multer.File => Boolean(file))
          .map((file) => validateImageContent(file)),
      )

      const save = async (file: Express.Multer.File | undefined) => {
        if (!file) return null
        const key = await images.save(file.buffer, file.mimetype)
        savedKeys.push(key)
        return key
      }

      // Encode and upload the (up to four) images together instead of one after another.
      const uploads = await Promise.allSettled([save(frontOriginal), save(frontProcessed), save(backOriginal), save(backProcessed)])
      const failedUpload = uploads.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failedUpload) throw failedUpload.reason
      const [frontOriginalKey, frontProcessedKey, backOriginalKey, backProcessedKey] = uploads
        .map((result) => (result as PromiseFulfilledResult<string | null>).value)

      const record: GarmentRecord = {
        id: randomUUID(),
        userId: request.authUser.id,
        name,
        category,
        frontOriginalKey: frontOriginalKey!,
        frontProcessedKey: frontProcessedKey!,
        backOriginalKey: backOriginalKey ?? null,
        backProcessedKey: backProcessedKey ?? null,
        createdAt: new Date().toISOString(),
      }

      const created = await repository.createIfBelowLimit(record, maxItems)
      if (!created) {
        await discardImages(cleanup, savedKeys, 'wardrobe_limit_reached')
        savedKeys.length = 0
        response.status(409).json({ message: `Gói hiện tại lưu tối đa ${maxItems} món trong tủ đồ.` })
        return
      }
      // The garment row now references these images; a later failure must not remove them.
      savedKeys.length = 0
      response.status(201).json(toResponse(record, images))
    } catch (error) {
      await discardImages(cleanup, savedKeys, 'garment_upload_failed')
      next(error)
    }
  })

  router.patch('/:id', async (request, response, next) => {
    try {
      const name = typeof request.body.name === 'string' ? request.body.name.trim() : undefined
      const category = request.body.category as GarmentCategory | undefined

      if (name !== undefined && (!name || name.length > 80)) {
        response.status(400).json({ message: 'Tên món đồ phải từ 1 đến 80 ký tự.' })
        return
      }
      if (category !== undefined && !GARMENT_CATEGORIES.includes(category)) {
        response.status(400).json({ message: 'Loại đồ không hợp lệ.' })
        return
      }

      const updated = await repository.update(request.authUser.id, request.params.id, {
        name,
        category,
      })
      if (!updated) {
        response.status(404).json({ message: 'Không tìm thấy món đồ.' })
        return
      }

      response.json(toResponse(updated, images))
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:id', async (request, response, next) => {
    try {
      const garment = await repository.findById(request.authUser.id, request.params.id)
      if (!garment) {
        response.status(404).json({ message: 'Không tìm thấy món đồ.' })
        return
      }

      await repository.delete(request.authUser.id, garment.id)
      const keys = [...new Set([
        garment.frontOriginalKey,
        garment.frontProcessedKey,
        garment.backOriginalKey,
        garment.backProcessedKey,
      ].filter((key): key is string => Boolean(key)))]
      await discardImages(cleanup, keys, 'garment_deleted')
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  return router
}
