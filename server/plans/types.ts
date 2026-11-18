export type SubscriptionPlanId = 'free' | 'plus' | 'pro' | 'max'

export type PlanEntitlements = {
  imageCredits: number
  wardrobeItems: number
  savedOutfits: number
  selectedGarments: number
  /** Live camera try-on sessions (Decart) allowed per rolling window; 0 = not included. */
  livePreviewSessions: number
  /** Length of one live preview session, in seconds. */
  livePreviewSeconds: number
  /** Whether the user may pick Decart's fast tier (lower latency, double price). */
  livePreviewFastMode: boolean
}

export type SubscriptionPlan = {
  id: SubscriptionPlanId
  name: string
  description: string
  monthlyPriceVnd: number
  recommended: boolean
  entitlements: PlanEntitlements
  highlights: string[]
}

export type PlanStatus = {
  planId: SubscriptionPlanId
  planName: string
  unlimited: boolean
  entitlements: PlanEntitlements
}
