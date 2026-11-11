import type { MaybePromise } from '../storage/maybe-promise.js'
import type { CreatePaymentOrder, PaymentOrder, PaymentProvider, PaymentStatus } from './types.js'

export interface BillingRepository {
  create(order: CreatePaymentOrder): MaybePromise<PaymentOrder>
  setCheckoutUrl(id: string, checkoutUrl: string): MaybePromise<PaymentOrder | null>
  getOwned(id: string, userId: string): MaybePromise<PaymentOrder | null>
  getByProviderOrder(provider: PaymentProvider, providerOrderId: string): MaybePromise<PaymentOrder | null>
  listAll(): MaybePromise<PaymentOrder[]>
  complete(provider: PaymentProvider, providerOrderId: string, transactionId: string, imageCredits: number): MaybePromise<PaymentOrder | null>
  setStatus(provider: PaymentProvider, providerOrderId: string, status: Exclude<PaymentStatus, 'paid'>): MaybePromise<void>
  close(): MaybePromise<void>
}
