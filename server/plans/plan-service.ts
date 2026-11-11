import type { PublicUser } from '../auth/auth-store.js'
import { SUBSCRIPTION_PLANS, planCatalog } from './catalog.js'
import type { PlanRepository } from './plan-repository.js'
import type { PlanStatus } from './types.js'

const ADMIN_LIMIT = 1_000_000

export class PlanService {
  constructor(private readonly repository: PlanRepository) {}
  catalog() { return planCatalog() }
  async status(user: PublicUser): Promise<PlanStatus> {
    if (user.role === 'admin') {
      return {
        planId: 'max', planName: 'Admin', unlimited: true,
        entitlements: { imageCredits: ADMIN_LIMIT, wardrobeItems: ADMIN_LIMIT, savedOutfits: ADMIN_LIMIT, selectedGarments: 8 },
      }
    }
    const planId = await this.repository.getPlan(user.id) ?? 'free'
    const plan = SUBSCRIPTION_PLANS[planId]
    return { planId, planName: plan.name, unlimited: false, entitlements: plan.entitlements }
  }
  close() { return this.repository.close() }
}
