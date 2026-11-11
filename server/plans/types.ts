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
