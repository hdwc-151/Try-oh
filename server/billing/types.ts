import type { SubscriptionPlanId } from '../plans/types.js'

export type PaymentProvider = 'payos' | 'momo'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled'

export type PaymentOrder = {
  id: string
  userId: string | null
  customerEmail: string
  customerName: string
  planId: SubscriptionPlanId
  provider: PaymentProvider
  providerOrderId: string
  providerTransactionId: string | null
  amountVnd: number
  status: PaymentStatus
  checkoutUrl: string | null
  createdAt: string
  updatedAt: string
  paidAt: string | null
  accessExpiresAt: string | null
}

export type CreatePaymentOrder = Omit<PaymentOrder,
  'providerTransactionId' | 'status' | 'checkoutUrl' | 'createdAt' | 'updatedAt' | 'paidAt' | 'accessExpiresAt'
> & { userId: string }

export type GatewayCheckout = { checkoutUrl: string }

export interface PaymentGateway {
  readonly provider: PaymentProvider
  createCheckout(order: PaymentOrder, returnUrl: string, cancelUrl: string): Promise<GatewayCheckout>
  verifyWebhook(payload: Record<string, unknown>): boolean
}
