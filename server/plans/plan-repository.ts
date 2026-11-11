import type { MaybePromise } from '../storage/maybe-promise.js'
import type { SubscriptionPlanId } from './types.js'

export interface PlanRepository {
  getPlan(userId: string): MaybePromise<SubscriptionPlanId | null>
  close(): MaybePromise<void>
}
