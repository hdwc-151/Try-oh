import type { SubscriptionPlanId } from './plans'

export type PaymentProvider = 'payos' | 'momo'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export type PaymentOrder = {
  id: string
  planId: SubscriptionPlanId
  provider: PaymentProvider
  amountVnd: number
  status: PaymentStatus
  paidAt: string | null
  accessExpiresAt: string | null
}

