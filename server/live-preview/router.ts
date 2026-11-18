import { Router, type NextFunction, type Response } from 'express'
import { createFixedWindowRateLimit, MemoryRateLimitStore, type RateLimitStore } from '../http/rate-limit.js'
import { isGarmentCategory, type LivePreviewService } from './service.js'
import { isLivePreviewSpeed, LivePreviewError } from './types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fail = (error: unknown, response: Response, next: NextFunction) => {
  if (error instanceof LivePreviewError) {
    response.status(error.statusCode).json({ message: error.publicMessage, code: error.code })
    return
  }
  next(error)
}

export type LivePreviewRouterOptions = {
  rateLimits?: RateLimitStore
  /** Sessions all users together may start per rolling day; unset disables the cap. */
  dailyLimit?: number
  /** This deployment's web origin: browser tokens are bound to it. */
  appOrigin?: string
}

export const createLivePreviewRouter = (service: LivePreviewService, options: LivePreviewRouterOptions = {}) => {
  const router = Router()
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })
  const store = options.rateLimits ?? new MemoryRateLimitStore()
  const startLimit = createFixedWindowRateLimit({
    max: 20,
    windowMs: 60 * 60 * 1000,
    namespace: 'live-preview.start.user',
    store,
    key: (request) => 'user:' + request.authUser.id,
    skip: (request) => request.authUser.role === 'admin',
    message: 'Bạn bắt đầu thử trực tiếp quá nhiều lần. Vui lòng thử lại sau.',
  })
  const tokenLimit = createFixedWindowRateLimit({
    max: 60,
    windowMs: 60 * 60 * 1000,
    namespace: 'live-preview.token.user',
    store,
    key: (request) => 'user:' + request.authUser.id,
    message: 'Quá nhiều yêu cầu kết nối. Vui lòng thử lại sau.',
  })
  const dailyBudget = options.dailyLimit
    ? createFixedWindowRateLimit({
        max: options.dailyLimit,
        windowMs: 24 * 60 * 60 * 1000,
        namespace: 'live-preview.global.daily',
        store,
        key: () => 'all',
        message: 'Hệ thống đã đạt giới hạn thử trực tiếp trong ngày. Vui lòng thử lại sau.',
      })
    : undefined

  router.get('/status', async (request, response, next) => {
    try { response.json(await service.status(request.authUser)) } catch (error) { fail(error, response, next) }
  })

  router.post('/sessions', startLimit, ...(dailyBudget ? [dailyBudget] : []), async (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>
      const source = body.source
      if (source !== 'wardrobe' && source !== 'upload') {
        throw new LivePreviewError(400, 'invalid_request', 'Nguồn ảnh tham chiếu không hợp lệ.')
      }
      const garmentId = body.garmentId
      if (source === 'wardrobe' && (typeof garmentId !== 'string' || !UUID.test(garmentId))) {
        throw new LivePreviewError(400, 'invalid_request', 'Hãy chọn một món đồ trong tủ đồ.')
      }
      if (body.category !== undefined && !isGarmentCategory(body.category)) {
        throw new LivePreviewError(400, 'invalid_request', 'Loại món đồ không hợp lệ.')
      }
      if (body.speed !== undefined && !isLivePreviewSpeed(body.speed)) {
        throw new LivePreviewError(400, 'invalid_request', 'Chế độ không hợp lệ.')
      }
      const result = await service.start(request.authUser, {
        source,
        garmentId: source === 'wardrobe' ? garmentId as string : undefined,
        category: isGarmentCategory(body.category) ? body.category : undefined,
        speed: isLivePreviewSpeed(body.speed) ? body.speed : undefined,
      })
      response.status(201).json(result)
    } catch (error) { fail(error, response, next) }
  })

  router.post('/sessions/:id/token', tokenLimit, async (request, response, next) => {
    try {
      const id = request.params.id
      if (typeof id !== 'string' || !UUID.test(id)) throw new LivePreviewError(400, 'invalid_request', 'Mã phiên không hợp lệ.')
      // Browsers send their origin on this POST; binding the token to our own web
      // origin stops it being replayed from another site. Native apps send none.
      const origin = request.get('origin')
      const boundOrigin = origin && options.appOrigin && origin === options.appOrigin ? origin : undefined
      response.json(await service.issueToken(request.authUser, id, boundOrigin))
    } catch (error) { fail(error, response, next) }
  })

  return router
}
