import type { PlanRepository } from './plan-repository.js'
import type { SubscriptionPlanId } from './types.js'

export class MemoryPlanRepository implements PlanRepository {
  private readonly plans = new Map<string, SubscriptionPlanId>()
  getPlan(userId: string): SubscriptionPlanId { return this.plans.get(userId) ?? 'free' }
  close(): void { this.plans.clear() }
}
