import { apiFetch } from './api-client'
import type { PaymentOrder, PaymentProvider } from '../types/billing'
import type { SubscriptionPlanId } from '../types/plans'

const readError = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => null) as { message?: string } | null
  return body?.message ?? fallback
}

export const billingApi = {
  async createCheckout(planId: SubscriptionPlanId, provider: PaymentProvider) {
    const response = await apiFetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, provider }),
    })
    if (!response.ok) throw new Error(await readError(response, 'Không thể bắt đầu thanh toán.'))
    return response.json() as Promise<{ orderId: string; checkoutUrl: string }>
  },
  async getOrder(id: string) {
    const response = await fetch('/api/billing/orders/' + encodeURIComponent(id), { cache: 'no-store' })
    if (!response.ok) throw new Error(await readError(response, 'Không thể kiểm tra giao dịch.'))
    return response.json() as Promise<PaymentOrder>
  },
}
