import type { GarmentCategory } from '../garments/garment.js'
import type { SubscriptionPlanId } from '../plans/types.js'

/** Where the reference garment of a live preview comes from. */
export type LivePreviewSource = 'wardrobe' | 'upload'
/** Decart realtime tier: `fast` has lower latency and costs twice as much per second. */
export type LivePreviewSpeed = 'standard' | 'fast'
export const isLivePreviewSpeed = (value: unknown): value is LivePreviewSpeed => value === 'standard' || value === 'fast'

export type LivePreviewSessionRecord = {
  id: string
  userId: string
  planId: SubscriptionPlanId | 'admin'
  source: LivePreviewSource
  garmentId: string | null
  category: GarmentCategory
  speed: LivePreviewSpeed
  /** Sessions this one counts as against the plan quota. */
  cost: number
  seconds: number
  tokensIssued: number
  createdAt: string
}

export type NewLivePreviewSession = Omit<LivePreviewSessionRecord, 'tokensIssued' | 'createdAt'>

export type LivePreviewStatus = {
  /** False when the server has no Decart key: clients hide the feature. */
  enabled: boolean
  /** True when the current plan includes at least one session per window. */
  included: boolean
  unlimited: boolean
  sessionSeconds: number
  /** True when the plan lets the user pick the fast tier. */
  fastModeIncluded: boolean
  /** Quota sessions one fast session uses. */
  fastCost: number
  limit: number
  used: number
  remaining: number | null
  windowDays: number
  /** When the oldest session in the window stops counting; null if none is counted. */
  nextResetAt: string | null
}

export type LivePreviewStartResponse = {
  session: { id: string; model: string; speed: LivePreviewSpeed; seconds: number; tokenWindowEndsAt: string }
  reference: { prompt: string; imageBase64: string | null; mimeType: string | null }
  status: LivePreviewStatus
}

export type LivePreviewTokenResponse = {
  apiKey: string
  expiresAt: string
  model: string
  seconds: number
}

export class LivePreviewError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(publicMessage)
  }
}
