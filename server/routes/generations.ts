import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { GarmentRepository } from '../storage/garment-repository.js'
import type { ImageStorage } from '../storage/image-storage.js'
import type { UserDataRepository } from '../storage/user-data-repository.js'
import { TRY_ON_ANGLES, type ImageProvider, type TryOnAngle } from '../providers/image-provider.js'
import { runtimeConfig } from '../config/runtime-config.js'
import { createFixedWindowRateLimit, MemoryRateLimitStore, type RateLimitStore } from '../http/rate-limit.js'
import type { CreditService } from '../credits/credit-service.js'
import type { PlanService } from '../plans/plan-service.js'
import { pageMetadata, parsePagination } from '../http/pagination.js'
import { discardImages, ImmediateStorageCleanup, type StorageCleanup } from '../storage/storage-cleanup.js'

export const MAX_GARMENTS_PER_GENERATION = 8
export const MAX_SAVED_OUTFITS_PER_USER = 10

export function createGenerationRouter(
  provider: ImageProvider,
  garments: GarmentRepository,
  userData: UserDataRepository,
  images: ImageStorage,
  credits: CreditService,
  rateLimits: RateLimitStore = new MemoryRateLimitStore(),
  plans?: PlanService,
  cleanup: StorageCleanup = new ImmediateStorageCleanup(images),
) {
  const router = Router()
  const aiRateLimit = createFixedWindowRateLimit({
    max: runtimeConfig.aiRequestsPerWindow,
    windowMs: runtimeConfig.aiRequestWindowMs,
    namespace: 'ai.generate.user',
    store: rateLimits,
    key: (request) => 'user:' + request.authUser.id,
    skip: (request) => request.authUser.role === 'admin',
    message: 'Bạn đã dùng hết lượt tạo ảnh trong khoảng thời gian này. Vui lòng thử lại sau.',
  })

  const toResponse = (item: { angle: TryOnAngle; imageUrl: string; createdAt: string }) => ({
    angle: item.angle,
    imageUrl: item.imageUrl,
    createdAt: item.createdAt,
  })
  const outfitLimit = async (user: Express.Request['authUser']) =>
    plans ? (await plans.status(user)).entitlements.savedOutfits : MAX_SAVED_OUTFITS_PER_USER

  router.get('/credits', async (request, response, next) => {
    try {
      response.json(await credits.status(request.authUser))
    } catch (error) {
      next(error)
    }
  })

  router.get('/results', async (request, response, next) => {
    try {
      response.json({
        items: (await userData.listTryOnResults(request.authUser.id))
        .filter((item) => TRY_ON_ANGLES.includes(item.angle))
        .map(toResponse),
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/outfits', async (request, response, next) => {
    try {
      const page = parsePagination(request.query)
      const outfits = await userData.listSavedOutfits(request.authUser.id, page)
      const total = page ? await userData.countSavedOutfits(request.authUser.id) : outfits.length
      response.json({
        items: outfits.map((outfit) => ({
          id: outfit.id,
          frontImageUrl: outfit.frontImageUrl,
          backImageUrl: outfit.backImageUrl,
          garmentIds: outfit.garmentIds,
          createdAt: outfit.createdAt,
        })),
        ...pageMetadata(page?.offset ?? 0, outfits.length, total),
      })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/outfits/:id', async (request, response, next) => {
    try {
      const userId = request.authUser.id
      const deleted = await userData.deleteSavedOutfit(userId, request.params.id)
      if (!deleted) {
        response.status(404).json({ message: 'Không tìm thấy bộ đồ đã lưu.' })
        return
      }
      const currentKeys = new Set((await userData.listTryOnResults(userId))
        .flatMap((result) => result.imageKey ? [result.imageKey] : []))
      const candidateKeys = [deleted.frontImageKey, deleted.backImageKey]
        .filter((key): key is string => Boolean(key))
        .filter((key) => !currentKeys.has(key))
      const savedChecks = await Promise.all(candidateKeys.map((key) => userData.isImageKeySaved(userId, key)))
      const unusedKeys = candidateKeys.filter((_key, index) => !savedChecks[index])
      await discardImages(cleanup, unusedKeys, 'outfit_deleted')
      response.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  router.post('/angles/:angle', aiRateLimit, async (request, response, next) => {
    try {
      const userId = request.authUser.id
      const angle = request.params.angle as TryOnAngle
      if (!TRY_ON_ANGLES.includes(angle)) {
        response.status(400).json({ message: 'Góc ảnh không hợp lệ.' })
        return
      }
      const maxOutfits = await outfitLimit(request.authUser)
      if (angle === 'front' && await userData.countSavedOutfits(userId) >= maxOutfits) {
        response.status(409).json({ message: `Gói hiện tại lưu tối đa ${maxOutfits} outfit.` })
        return
      }
      if (request.body.privacyConfirmed !== true) {
        response.status(400).json({ message: 'Cần xác nhận quyền riêng tư trước khi tạo ảnh.' })
        return
      }
      const requestedGarmentIds: string[] = Array.isArray(request.body.garmentIds)
        ? request.body.garmentIds
          .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
      const garmentIds = [...new Set(requestedGarmentIds)]
      if (garmentIds.length === 0) {
        response.status(400).json({ message: 'Cần chọn ít nhất một món đồ.' })
        return
      }
      if (garmentIds.length > MAX_GARMENTS_PER_GENERATION) {
        response.status(400).json({ message: `Chỉ được chọn tối đa ${MAX_GARMENTS_PER_GENERATION} món đồ.` })
        return
      }
      const person = await userData.getPersonImage(userId)
      if (!person) {
        response.status(400).json({ message: 'Cần tải ảnh người dùng trước.' })
        return
      }
      const selectedGarments = await Promise.all(garmentIds.map((id) => garments.findById(userId, id)))
      if (selectedGarments.some((garment) => !garment)) {
        response.status(400).json({ message: 'Có món đồ không còn tồn tại.' })
        return
      }

      const garmentImageUrls = selectedGarments.map((garment) => {
        const key = angle === 'back' && garment?.backProcessedKey
          ? garment.backProcessedKey
          : garment!.frontProcessedKey
        return images.publicUrl(key)
      })
      const previousResults = await userData.listTryOnResults(userId)
      const frontReference = angle === 'front'
        ? undefined
        : previousResults.find((item) => item.angle === 'front')?.imageUrl
      if (angle !== 'front' && !frontReference) {
        response.status(409).json({ message: 'Cần tạo ảnh TRƯỚC thành công trước.' })
        return
      }

      const garmentInfo = selectedGarments.map((g) => ({
        name: g!.name,
        category: g!.category,
      }))

      const preservePose = request.body.preservePose !== false

      // KHI TẠO ẢNH GÓC SAU:
      // Lấy trực tiếp ảnh góc trước đã hoàn thiện làm personImageUrl!
      // Không truyền ảnh selfie gốc nữa để loại bỏ triệt để việc AI nhặt lại phụ kiện cũ
      // (khăn bandana, túi xách cũ, điện thoại...) từ ảnh selfie ban đầu.
      const personImageUrl = angle === 'back' && frontReference
        ? frontReference
        : images.publicUrl(person.imageKey)

      // Mỗi provider response hiện tạo đúng một ảnh. Nếu provider hỗ trợ batch,
      // reserve số lượng output trước khi gọi để mỗi ảnh đều được tính credit.
      const reservation = await credits.reserve(request.authUser, 1)
      let generated
      try {
        generated = await provider.generate({
          personImageUrl,
          garmentImageUrls,
          garments: garmentInfo,
          angle,
          referenceImageUrl: frontReference,
          preservePose,
        })
      } catch (providerError) {
        try {
          await credits.refund(request.authUser, reservation)
        } catch (refundError) {
          console.error('Không thể hoàn credit sau khi tạo ảnh thất bại:', refundError)
        }
        throw providerError
      }
      const result = {
        angle,
        imageUrl: generated.imageUrl,
        imageKey: generated.storageKey ?? null,
        createdAt: new Date().toISOString(),
      }
      const previousImageKey = previousResults.find((item) => item.angle === angle)?.imageKey
      try {
        await userData.upsertTryOnResult(userId, result)
      } catch (storeError) {
        // The image was generated but could not be recorded, so the user never
        // receives it: give the credit back and drop the orphaned file.
        await discardImages(cleanup, [result.imageKey], 'generation_not_recorded')
        try {
          await credits.refund(request.authUser, reservation)
        } catch (refundError) {
          console.error('Không thể hoàn credit sau khi lưu kết quả thất bại:', refundError)
        }
        throw storeError
      }
      if (previousImageKey && previousImageKey !== result.imageKey && !(await userData.isImageKeySaved(userId, previousImageKey))) {
        await discardImages(cleanup, [previousImageKey], 'try_on_replaced')
      }

      let outfitSaved = true
      if (angle === 'front') {
        const staleBackImageKey = await userData.deleteTryOnResult(userId, 'back')
        if (staleBackImageKey && !(await userData.isImageKeySaved(userId, staleBackImageKey))) {
          await discardImages(cleanup, [staleBackImageKey], 'try_on_replaced')
        }
        const saved = await userData.saveOutfitIfBelowLimit(userId, {
          id: randomUUID(),
          frontImageUrl: result.imageUrl,
          frontImageKey: result.imageKey,
          backImageUrl: null,
          backImageKey: null,
          garmentIds,
          createdAt: result.createdAt,
        }, maxOutfits)
        // The image is already the current result and the credit is spent, so it is
        // still returned; only the copy in "Bộ đồ của tôi" is skipped when the plan is full.
        if (!saved) outfitSaved = false
      } else {
        const front = (await userData.listTryOnResults(userId)).find((item) => item.angle === 'front')
        if (front) {
          const pending = await userData.findPendingOutfit(userId, front.imageUrl)
          const saved = await userData.saveOutfitIfBelowLimit(userId, {
            id: pending?.id ?? randomUUID(),
            frontImageUrl: front.imageUrl,
            frontImageKey: front.imageKey,
            backImageUrl: result.imageUrl,
            backImageKey: result.imageKey,
            garmentIds,
            createdAt: result.createdAt,
          }, maxOutfits)
          if (!saved) outfitSaved = false
        }
      }
      response.json({
        ...toResponse(result),
        outfitSaved,
        credits: await credits.status(request.authUser),
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
