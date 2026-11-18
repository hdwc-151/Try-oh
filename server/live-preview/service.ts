import { randomUUID } from 'node:crypto'
import type { PublicUser } from '../auth/auth-store.js'
import { GARMENT_CATEGORIES, type GarmentCategory } from '../garments/garment.js'
import type { PlanService } from '../plans/plan-service.js'
import type { GarmentRepository } from '../garments/garment-repository.js'
import type { ImageStorage } from '../storage/image-storage.js'
import type { DecartTokenIssuer } from './decart-client.js'
import { LIVE_PREVIEW_PROMPTS } from './prompts.js'
import type { LivePreviewRepository } from './repository.js'
import {
  LivePreviewError,
  type LivePreviewSource,
  type LivePreviewSpeed,
  type LivePreviewStartResponse,
  type LivePreviewStatus,
  type LivePreviewTokenResponse,
} from './types.js'

const DAY_MS = 24 * 60 * 60 * 1000
/** Images above this are not worth streaming to Decart as a reference. */
const MAX_REFERENCE_BYTES = 6 * 1024 * 1024

export type LivePreviewOptions = {
  /** Decart model id used for every session. */
  model: string
  /** Rolling window the per-plan quota is counted in. */
  windowDays: number
  /** Lifetime of each Decart client token (it only has to outlive connect). */
  tokenTtlSeconds: number
  /**
   * Tokens one session may mint: the first connect plus SDK reconnects. Each token
   * carries the full session length, so this bounds the worst-case cost per session.
   */
  maxTokensPerSession: number
  /** How long after starting a session tokens can still be minted for it. */
  tokenWindowSeconds: number
  /** Quota sessions one fast-tier session uses (it costs Decart twice as much). */
  fastCost: number
}

const DEFAULT_LIVE_PREVIEW_OPTIONS: LivePreviewOptions = {
  model: 'lucy-vton-latest',
  windowDays: 30,
  tokenTtlSeconds: 60,
  maxTokensPerSession: 2,
  tokenWindowSeconds: 120,
  fastCost: 1,
}

export type StartLivePreviewInput = {
  source: LivePreviewSource
  garmentId?: string
  category?: GarmentCategory
  speed?: LivePreviewSpeed
}

export const isGarmentCategory = (value: unknown): value is GarmentCategory =>
  typeof value === 'string' && (GARMENT_CATEGORIES as readonly string[]).includes(value)

export class LivePreviewService {
  private readonly options: LivePreviewOptions

  constructor(
    private readonly repository: LivePreviewRepository,
    private readonly plans: PlanService,
    private readonly garments: GarmentRepository,
    private readonly images: ImageStorage,
    /** Absent when DECART_API_KEY is not configured: the feature reports disabled. */
    private readonly issuer: DecartTokenIssuer | null,
    options: Partial<LivePreviewOptions> = {},
    private readonly now: () => Date = () => new Date(),
  ) {
    this.options = { ...DEFAULT_LIVE_PREVIEW_OPTIONS, ...options }
  }

  get enabled() { return this.issuer !== null }

  private windowStart() { return new Date(this.now().getTime() - this.options.windowDays * DAY_MS) }

  async status(user: PublicUser): Promise<LivePreviewStatus> {
    const plan = await this.plans.status(user)
    const { livePreviewSessions: limit, livePreviewSeconds: sessionSeconds, livePreviewFastMode } = plan.entitlements
    const usage = await this.repository.listUsageSince(user.id, this.windowStart())
    const used = usage.reduce((sum, item) => sum + item.cost, 0)
    const oldest = usage[0]?.createdAt
    return {
      enabled: this.enabled,
      included: plan.unlimited || limit > 0,
      unlimited: plan.unlimited,
      sessionSeconds,
      fastModeIncluded: plan.unlimited || livePreviewFastMode,
      fastCost: this.options.fastCost,
      limit,
      used,
      remaining: plan.unlimited ? null : Math.max(0, limit - used),
      windowDays: this.options.windowDays,
      nextResetAt: oldest ? new Date(new Date(oldest).getTime() + this.options.windowDays * DAY_MS).toISOString() : null,
    }
  }

  async start(user: PublicUser, input: StartLivePreviewInput): Promise<LivePreviewStartResponse> {
    if (!this.enabled) throw new LivePreviewError(503, 'live_preview_unavailable', 'Tính năng thử trực tiếp chưa được bật trên máy chủ.')
    const plan = await this.plans.status(user)
    const { livePreviewSessions: limit, livePreviewSeconds: seconds } = plan.entitlements
    if (!plan.unlimited && limit <= 0) {
      throw new LivePreviewError(402, 'plan_required', 'Thử trực tiếp bằng camera dành cho gói trả phí. Hãy đăng ký gói Plus trở lên để sử dụng.')
    }
    const speed: LivePreviewSpeed = input.speed ?? 'standard'
    if (speed === 'fast' && !plan.unlimited && !plan.entitlements.livePreviewFastMode) {
      throw new LivePreviewError(403, 'fast_mode_not_included', 'Chế độ Nhanh dành cho gói Pro và Max. Hãy chọn chế độ Tiêu chuẩn hoặc nâng cấp gói.')
    }
    const cost = speed === 'fast' ? this.options.fastCost : 1

    let category: GarmentCategory
    let garmentId: string | null = null
    let imageBase64: string | null = null
    let mimeType: string | null = null
    if (input.source === 'wardrobe') {
      if (!input.garmentId) throw new LivePreviewError(400, 'invalid_request', 'Hãy chọn một món đồ trong tủ đồ.')
      const garment = await this.garments.findById(user.id, input.garmentId)
      if (!garment) throw new LivePreviewError(404, 'garment_not_found', 'Không tìm thấy món đồ trong tủ đồ của bạn.')
      // Read the image before charging, so a missing file never costs a session.
      const image = await this.images.read(garment.frontProcessedKey || garment.frontOriginalKey)
      if (image.buffer.byteLength > MAX_REFERENCE_BYTES) {
        throw new LivePreviewError(413, 'reference_too_large', 'Ảnh món đồ quá lớn để thử trực tiếp.')
      }
      category = garment.category
      garmentId = garment.id
      imageBase64 = image.buffer.toString('base64')
      mimeType = image.mimeType
    } else {
      // The uploaded photo goes from the device straight to Decart; only its kind is needed here.
      category = input.category ?? 'tops'
    }

    const record = await this.repository.tryCreate({
      id: randomUUID(),
      userId: user.id,
      planId: plan.unlimited ? 'admin' : plan.planId,
      source: input.source,
      garmentId,
      category,
      speed,
      cost,
      seconds,
    }, plan.unlimited ? null : limit, this.windowStart())
    if (!record) {
      throw new LivePreviewError(402, 'quota_exhausted', cost > 1
        ? `Không đủ lượt cho chế độ Nhanh (cần ${cost} lượt). Hãy chọn chế độ Tiêu chuẩn hoặc đợi lượt mới.`
        : `Bạn đã dùng hết ${limit} lượt thử trực tiếp trong ${this.options.windowDays} ngày. Nâng cấp gói để có thêm lượt.`)
    }
    return {
      session: {
        id: record.id,
        model: this.options.model,
        speed: record.speed,
        seconds: record.seconds,
        tokenWindowEndsAt: new Date(new Date(record.createdAt).getTime() + this.options.tokenWindowSeconds * 1000).toISOString(),
      },
      reference: { prompt: LIVE_PREVIEW_PROMPTS[category], imageBase64, mimeType },
      status: await this.status(user),
    }
  }

  async issueToken(user: PublicUser, sessionId: string, origin?: string): Promise<LivePreviewTokenResponse> {
    if (!this.issuer) throw new LivePreviewError(503, 'live_preview_unavailable', 'Tính năng thử trực tiếp chưa được bật trên máy chủ.')
    const createdAfter = new Date(this.now().getTime() - this.options.tokenWindowSeconds * 1000)
    const record = await this.repository.tryIssueToken(user.id, sessionId, this.options.maxTokensPerSession, createdAfter)
    if (!record) throw new LivePreviewError(409, 'session_closed', 'Phiên thử trực tiếp đã kết thúc. Hãy bắt đầu phiên mới.')
    try {
      const token = await this.issuer.createToken({
        model: this.options.model,
        maxSessionSeconds: record.seconds,
        expiresInSeconds: this.options.tokenTtlSeconds,
        allowedOrigins: origin ? [origin] : undefined,
        metadata: { userId: user.id, sessionId: record.id, planId: record.planId, speed: record.speed },
      })
      return { apiKey: token.apiKey, expiresAt: token.expiresAt, model: this.options.model, seconds: record.seconds }
    } catch (error) {
      // Nothing was streamed with this token: give it back, and refund the session
      // entirely when it never got one.
      await this.repository.releaseToken(user.id, record.id)
      if (record.tokensIssued === 1) await this.repository.deleteUnused(user.id, record.id)
      console.error('[live-preview] Decart token failed:', error instanceof Error ? error.message : 'Unknown error')
      throw new LivePreviewError(502, 'provider_error', record.tokensIssued === 1
        ? 'Không kết nối được dịch vụ thử trực tiếp. Lượt của bạn chưa bị trừ, hãy thử lại.'
        : 'Không kết nối lại được dịch vụ thử trực tiếp.')
    }
  }

  close() { return this.repository.close() }
}
