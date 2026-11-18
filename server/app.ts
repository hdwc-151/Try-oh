import compression from 'compression'
import express, { type ErrorRequestHandler } from 'express'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import type { GarmentRepository } from './garments/garment-repository.js'
import type { ImageStorage } from './storage/image-storage.js'
import type { UserDataRepository } from './user-data/user-data-repository.js'
import { createGarmentRouter } from './garments/router.js'
import { createUserDataRouter } from './user-data/router.js'
import { createGenerationRouter } from './generations/router.js'
import { createMockImageRouter } from './providers/mock-images-router.js'
import type { ImageProvider } from './providers/image-provider.js'
import { ImageProviderError } from './providers/image-provider-error.js'
import type { AuthBackend } from './auth/auth-backend.js'
import { AuthError } from './auth/auth-service.js'
import { createAuthRouter, createRequireAuth, SESSION_COOKIE } from './auth/auth-http.js'
import type { OAuthStateStore } from './auth/oauth-store.js'
import { createGoogleOAuth } from './auth/google-oauth.js'
import { GarmentExtractorService } from './garments/garment-extractor.js'
import { AiQueueBusyError } from './providers/ai-concurrency.js'
import { ImmediateStorageCleanup, type StorageCleanup } from './storage/storage-cleanup.js'
import { isThumbnailKey, isThumbnailWidth, ThumbnailService } from './storage/thumbnails.js'
import type { SocialService } from './social/social-service.js'
import { createSocialRouter } from './social/router.js'
import { runtimeConfig } from './config/runtime-config.js'
import { requireMutationHeader, setSecurityHeaders } from './http/security.js'
import type { AdminService } from './admin/admin-service.js'
import { createAdminRouter } from './admin/router.js'
import {
  createFixedWindowRateLimit,
  createTokenBucketRateLimit,
  MemoryRateLimitStore,
  type RateLimitStore,
} from './http/rate-limit.js'
import { CreditService } from './credits/credit-service.js'
import { MemoryCreditRepository } from './credits/memory-credit-repository.js'
import { PlanService } from './plans/plan-service.js'
import { MemoryPlanRepository } from './plans/memory-plan-repository.js'
import { createPlanRouter } from './plans/router.js'
import type { BillingService } from './billing/billing-service.js'
import { createBillingRouter, createBillingWebhookRouter } from './billing/router.js'
import { generationIdempotency, generationReceipt } from './http/generation-idempotency.js'
import { MemoryGenerationRequestStore, type GenerationRequestStore } from './services/generation-requests.js'
import { LivePreviewService } from './live-preview/service.js'
import { MemoryLivePreviewRepository } from './live-preview/repository.js'
import { createLivePreviewRouter } from './live-preview/router.js'

export function createApp(
  repository: GarmentRepository,
  userDataRepository: UserDataRepository,
  images: ImageStorage,
  _uploadDirectory: string,
  imageProvider: ImageProvider,
  authService: AuthBackend,
  secureCookies = false,
  garmentExtractor?: GarmentExtractorService,
  social?: SocialService,
  admin?: AdminService,
  rateLimitStore?: RateLimitStore,
  creditService?: CreditService,
  planService?: PlanService,
  billingService?: BillingService,
  readinessCheck?: () => Promise<void>,
  storageCleanup?: StorageCleanup,
  generationRequests: GenerationRequestStore = new MemoryGenerationRequestStore(),
  livePreviewService?: LivePreviewService,
  oauthStateStore?: OAuthStateStore,
) {
  const cleanup = storageCleanup ?? new ImmediateStorageCleanup(images)
  const app = express()
  const signedImageTtlSeconds = Math.min(3_600, Math.max(60, Number(process.env.R2_SIGNED_READ_TTL_SECONDS ?? 300) || 300))
  const ownImageKeyRequests = new Map<string, Promise<Set<string>>>()
  const thumbnails = new ThumbnailService(images)
  const thumbnailWaitMs = Number(process.env.THUMBNAIL_WAIT_MS ?? 1500)
  const sharedRateLimits = rateLimitStore ?? new MemoryRateLimitStore()
  const plans = planService ?? new PlanService(new MemoryPlanRepository())
  const credits = creditService ?? new CreditService(new MemoryCreditRepository(), plans)
  // Without a configured service the routes still answer, reporting the feature as disabled.
  const livePreview = livePreviewService ?? new LivePreviewService(new MemoryLivePreviewRepository(), plans, repository, images, null)
  app.disable('x-powered-by')
  if (runtimeConfig.trustProxyHops) app.set('trust proxy', runtimeConfig.trustProxyHops)
  app.use(setSecurityHeaders)
  // JSON và JS/CSS nén gzip/brotli trước khi gửi (danh sách, snapshot mạng xã hội nhỏ đi 70–90%).
  // Ảnh đã là định dạng nén nên bỏ qua.
  app.use(compression({
    threshold: 1024,
    filter: (request, response) => !request.path.startsWith('/uploads/') && compression.filter(request, response),
  }))
  app.use((request, response, next) => {
    const startedAt = performance.now()
    const incomingId = request.get('x-request-id')
    const requestId = incomingId && /^[a-zA-Z0-9_-]{8,100}$/.test(incomingId) ? incomingId : randomUUID()
    response.locals.requestId = requestId
    response.setHeader('X-Request-ID', requestId)
    response.on('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt)
      if (durationMs >= 1_000 || response.statusCode >= 400) {
        console.info(JSON.stringify({ type: 'http_request', requestId, method: request.method, path: request.path, status: response.statusCode, durationMs }))
      }
    })
    next()
  })
  // The per-session bucket below runs before authentication, so its key is an
  // unverified credential. This IP ceiling always applies and stops a client
  // from minting fresh buckets by rotating fake tokens, while still leaving
  // headroom for many real users behind one carrier-grade NAT address.
  app.use('/api', createTokenBucketRateLimit({
    requestsPerMinute: runtimeConfig.apiIpRequestsPerMinute,
    burst: runtimeConfig.apiIpBurst,
    key: (request) => `ip-ceiling:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`,
    skip: (request) => request.path === '/health',
  }))
  app.use('/api', createTokenBucketRateLimit({
    requestsPerMinute: runtimeConfig.apiRequestsPerMinute,
    burst: runtimeConfig.apiBurst,
    // Authenticated mobile/web users get an isolated bucket even when many of
    // them share one carrier-grade NAT address. The limiter hashes this value.
    key: (request) => {
      const bearer = request.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
      if (bearer) return `session:${bearer}`
      const sessionCookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))
      if (sessionCookie) return `session:${sessionCookie.slice(SESSION_COOKIE.length + 1)}`
      return `ip:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`
    },
    skip: (request) => request.path === '/health',
  }))
  app.use(express.json({ limit: '32kb' }))
  app.use('/api', (request, response, next) => {
    // Express 5 leaves `body` undefined when no JSON was sent; handlers read fields
    // from it directly, so a body-less POST must be a validation error, not a crash.
    if (request.body === undefined) request.body = {}
    // API responses are per-user data and must never be stored by shared caches.
    response.setHeader('Cache-Control', 'private, no-store')
    next()
  })
  if (billingService) app.use('/api/billing/webhooks', createBillingWebhookRouter(billingService))
  app.use('/api', requireMutationHeader)

  const extractor =
    garmentExtractor ??
    new GarmentExtractorService(images, {
      isMock: process.env.IMAGE_PROVIDER === 'mock',
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      fluxModel: process.env.OPENROUTER_IMAGE_MODEL,
      visionModel: process.env.OPENROUTER_VISION_MODEL,
    })

  app.get('/api/health', async (_request, response) => {
    try {
      await readinessCheck?.()
      response.json({ status: 'ok', ready: true, revision: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null })
    } catch {
      response.status(503).json({ status: 'degraded', ready: false })
    }
  })
  const decorateUser = admin ? (user: Parameters<AdminService['resolveAuthenticatedUser']>[0]) => admin.resolveAuthenticatedUser(user) : undefined
  const deleteAccountData = async (user: Express.Request['authUser'], token: string | null) => {
    if (!authService.deleteAccount) throw new AuthError(501, 'Xóa tài khoản chưa được hỗ trợ.')
    // Collect every image key before the account row is removed: the database
    // cascades away the rows that reference them.
    const [garments, person, results, outfits, socialKeys] = await Promise.all([
      repository.list(user.id),
      userDataRepository.getPersonImage(user.id),
      userDataRepository.listTryOnResults(user.id),
      userDataRepository.listSavedOutfits(user.id),
      social ? social.listUserImageKeys(user.id) : Promise.resolve([] as string[]),
    ])
    const imageKeys = new Set<string>([
      ...garments.flatMap(item => [item.frontOriginalKey, item.frontProcessedKey, item.backOriginalKey, item.backProcessedKey]),
      person?.imageKey,
      ...results.map(item => item.imageKey),
      ...outfits.flatMap(item => [item.frontImageKey, item.backImageKey]),
      ...socialKeys,
    ].filter((key): key is string => Boolean(key)))

    await authService.deleteAccount(user.id, token)

    try {
      // PostgreSQL cascades these from auth.users; SQLite needs explicit cleanup.
      await social?.deleteUserData(user.id)
      await Promise.all(garments.map(item => repository.delete(user.id, item.id)))
      await userDataRepository.clearAllUserData(user.id)
      await generationRequests.deleteUser(user.id)
    } catch (error) {
      console.error('[account.delete] Database cleanup needs retry:', error instanceof Error ? error.message : 'Unknown error')
    }
    // Durable in production: failed object deletions are retried in the background.
    await cleanup.enqueue(imageKeys, 'account_deleted')
    imageProvider.clearCache?.()
  }
  // Google sends people back to this server, not to Supabase, so its consent
  // screen shows this site's domain. Absent credentials simply leave the button hidden.
  const googleOAuth = createGoogleOAuth(new URL('/api/auth/oauth/callback', runtimeConfig.appBaseUrl).toString())
  app.use('/api/auth', createAuthRouter(authService, secureCookies, runtimeConfig.authSessionDays, decorateUser, sharedRateLimits, deleteAccountData, googleOAuth, oauthStateStore))
  const requireAuth = createRequireAuth(authService, secureCookies, runtimeConfig.authSessionDays, decorateUser)

  const getOwnImageKeys = (userId: string) => {
    const pending = ownImageKeyRequests.get(userId)
    if (pending) return pending
    const request = Promise.all([
      repository.list(userId),
      userDataRepository.getPersonImage(userId),
      userDataRepository.listTryOnResults(userId),
      userDataRepository.listSavedOutfits(userId),
    ]).then(([garments, person, results, outfits]) => new Set([
      ...garments.flatMap((item) => [
        item.frontOriginalKey, item.frontProcessedKey, item.backOriginalKey, item.backProcessedKey,
      ]),
      person?.imageKey,
      ...results.map((item) => item.imageKey),
      ...outfits.flatMap((item) => [item.frontImageKey, item.backImageKey]),
    ].filter((value): value is string => Boolean(value))))
    ownImageKeyRequests.set(userId, request)
    const scheduleCleanup = () => {
      setTimeout(() => {
        if (ownImageKeyRequests.get(userId) === request) ownImageKeyRequests.delete(userId)
      }, 500)
    }
    void request.then(scheduleCleanup, scheduleCleanup)
    return request
  }

  // Check the current sharing policy before signing each URL.
  const canReadImage = async (userId: string, key: string): Promise<boolean> => social
    ? social.canReadImage(userId, key)
    : (await getOwnImageKeys(userId)).has(key)

  app.get('/uploads/:key', requireAuth, async (request, response, next) => {
    try {
      const rawKey = request.params.key
      if (typeof rawKey !== 'string') {
        response.status(400).end()
        return
      }
      let key: string
      try {
        key = decodeURIComponent(rawKey)
      } catch {
        response.status(400).end()
        return
      }
      // Ảnh thu nhỏ chỉ được xin qua `?w=` trên khoá gốc, nên quyền xem luôn kiểm trên ảnh gốc.
      if (isThumbnailKey(key) || !(await canReadImage(request.authUser.id, key))) {
        response.status(404).end()
        return
      }
      response.vary('Authorization')
      response.vary('Cookie')
      const width = request.query.w
      // true khi xin ảnh thu nhỏ nhưng phải trả tạm ảnh gốc: cache ngắn để lần sau lấy được bản nhỏ.
      let servedFallback = false
      if (isThumbnailWidth(width) && thumbnails.supported) {
        try {
          const thumbnail = await thumbnails.ensureWithin(key, Number(width) as Parameters<ThumbnailService['ensure']>[1], thumbnailWaitMs)
          if (thumbnail) key = thumbnail
          else servedFallback = true
        } catch (error) {
          servedFallback = true
          // Không tạo được (ảnh gốc hỏng, storage lỗi): vẫn trả ảnh gốc thay vì làm vỡ ảnh.
          console.warn('[thumbnail] fallback to original:', error instanceof Error ? error.message : 'Unknown error')
        }
      }
      // Normal display traffic goes straight to R2. The explicit proxy mode is reserved
      // for the rare browser-side image processing path that needs a same-origin response.
      if (images.createReadUrl && (images.isDirectReadReady?.() ?? true) && request.query.proxy !== '1') {
        try {
          const signedUrl = await images.createReadUrl(key, signedImageTtlSeconds)
          response.setHeader('Cache-Control', servedFallback ? 'private, max-age=30' : `private, max-age=${Math.max(30, signedImageTtlSeconds - 30)}`)
          response.redirect(302, signedUrl)
          return
        } catch {
          // Availability wins over the optimization: stream the image if URL signing fails.
        }
      }
      response.setHeader('Cache-Control', servedFallback ? 'private, max-age=30' : 'private, max-age=86400, immutable')
      if (images.openStream) {
        const image = await images.openStream(key)
        response.type(image.mimeType)
        if (image.contentLength !== undefined) response.setHeader('Content-Length', String(image.contentLength))
        for await (const chunk of image.body) {
          if (response.destroyed) return
          if (!response.write(chunk)) await new Promise<void>((resolve) => response.once('drain', resolve))
        }
        response.end()
      } else {
        const image = await images.read(key)
        response.type(image.mimeType).send(image.buffer)
      }
    } catch (error) {
      next(error)
    }
  })
  if (social) app.use('/api/social', requireAuth, createSocialRouter(social, images, cleanup))
  if (admin) app.use('/api/admin', requireAuth, createAdminRouter(admin, social))
  if (billingService) app.use('/api/billing', requireAuth, createBillingRouter(billingService, sharedRateLimits))
  app.use('/api/plans', requireAuth, createPlanRouter(plans))
  // Retry receipts bypass both AI rate limits and the daily spend ceiling.
  app.get('/api/generations/receipt', requireAuth, generationReceipt(generationRequests))
  app.post('/api/generations/angles/:angle', requireAuth, generationIdempotency(generationRequests))
  app.use('/api/live-preview', requireAuth, createLivePreviewRouter(livePreview, {
    rateLimits: sharedRateLimits,
    dailyLimit: runtimeConfig.livePreviewDailyLimit,
    appOrigin: new URL(runtimeConfig.appBaseUrl).origin,
  }))
  // Global circuit breaker for paid AI calls, shared across instances through the
  // rate-limit store. Disabled unless AI_DAILY_REQUEST_LIMIT is set.
  if (runtimeConfig.aiDailyRequestLimit) {
    const aiDailyBudget = createFixedWindowRateLimit({
      max: runtimeConfig.aiDailyRequestLimit,
      windowMs: 24 * 60 * 60 * 1000,
      namespace: 'ai.global.daily',
      store: sharedRateLimits,
      key: () => 'all',
      message: 'Hệ thống đã đạt giới hạn tạo ảnh trong ngày. Vui lòng thử lại sau.',
    })
    app.post('/api/garments/ai-extract', requireAuth, aiDailyBudget)
    app.post('/api/generations/angles/:angle', requireAuth, aiDailyBudget)
  }
  app.use('/api/garments', requireAuth, createGarmentRouter(repository, images, extractor, social, plans, sharedRateLimits, credits, cleanup))
  app.use('/api', requireAuth, createUserDataRouter(userDataRepository, images, cleanup))
  app.use('/api/generations', requireAuth, createGenerationRouter(imageProvider, repository, userDataRepository, images, credits, sharedRateLimits, plans, cleanup))
  app.use('/api/mock-images', requireAuth, createMockImageRouter())

  app.use('/api', (_request, response) => {
    response.status(404).json({ message: 'Không tìm thấy API.' })
  })

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (response.headersSent) {
      // The response already started (e.g. while streaming an image); nothing more can be sent.
      response.destroy()
      return
    }
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Mỗi ảnh phải nhỏ hơn hoặc bằng 10MB.'
        : 'Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.'
      response.status(400).json({ message })
      return
    }
    if (error instanceof ImageProviderError) {
      console.warn(`Image provider failed [${error.code}]: ${error.message}`)
      response.status(error.statusCode).json({
        message: error.publicMessage,
        code: error.code,
      })
      return
    }
    if (error instanceof AiQueueBusyError) {
      response.status(503).json({ message: error.message, code: 'ai_queue_busy' })
      return
    }
    if (error instanceof AuthError) {
      response.status(error.statusCode).json({ message: error.publicMessage })
      return
    }
    const detail = (error ?? {}) as { type?: string; status?: number; code?: string }
    // body-parser: malformed JSON or a body over the limit is the client's mistake.
    if (detail.type === 'entity.parse.failed' || detail.type === 'entity.too.large') {
      const tooLarge = detail.type === 'entity.too.large'
      response.status(tooLarge ? 413 : 400).json({ message: tooLarge ? 'Dữ liệu gửi lên quá lớn.' : 'Dữ liệu gửi lên không hợp lệ.' })
      return
    }
    // PostgreSQL 22P02: a malformed id (not a UUID) reached a typed column.
    if (detail.code === '22P02') {
      response.status(400).json({ message: 'Mã định danh không hợp lệ.' })
      return
    }
    console.error(JSON.stringify({
      type: 'request_error',
      requestId: response.locals.requestId,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 6).join(' | ') : undefined,
    }))
    response.status(500).json({ message: 'Máy chủ gặp lỗi. Vui lòng thử lại.', requestId: response.locals.requestId })
  }
  app.use(errorHandler)
  return app
}
