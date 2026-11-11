export type SubscriptionPlanId = 'free' | 'plus' | 'pro' | 'max'

export type PlanEntitlements = {
  imageCredits: number
  wardrobeItems: number
  savedOutfits: number
  selectedGarments: number
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

export type PlanSnapshot = { plans: SubscriptionPlan[]; current: PlanStatus }

export const FREE_ENTITLEMENTS: PlanEntitlements = {
  imageCredits: 10,
  wardrobeItems: 20,
  savedOutfits: 10,
  selectedGarments: 8,
}
