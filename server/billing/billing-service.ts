import { randomInt, randomUUID } from 'node:crypto'
import type { PublicUser } from '../auth/auth-store.js'
import { AuthError } from '../auth/auth-service.js'
import { SUBSCRIPTION_PLANS, isSubscriptionPlanId } from '../plans/catalog.js'
import type { BillingRepository } from './billing-repository.js'
import type { ExcelPaymentLedger } from './excel-payment-ledger.js'
import type { PaymentGateway, PaymentOrder, PaymentProvider } from './types.js'

const isProvider = (value: unknown): value is PaymentProvider => value === 'payos' || value === 'momo'

export class BillingService {
  private readonly gateways: Map<PaymentProvider, PaymentGateway>

  constructor(
    private readonly repository: BillingRepository,
    gateways: PaymentGateway[],
    private readonly appBaseUrl: string,
    private readonly ledger?: ExcelPaymentLedger,
  ) {
    this.gateways = new Map(gateways.map((gateway) => [gateway.provider, gateway]))
  }

  providers() {
    return (['payos', 'momo'] as const).map((id) => ({ id, available: this.gateways.has(id) }))
  }

  async createCheckout(user: PublicUser, input: { planId?: unknown; provider?: unknown }) {
    if (!isSubscriptionPlanId(input.planId) || input.planId === 'free') {
      throw new AuthError(400, 'Gói thanh toán không hợp lệ.')
    }
    if (!isProvider(input.provider)) throw new AuthError(400, 'Phương thức thanh toán không hợp lệ.')
    const gateway = this.gateways.get(input.provider)
    if (!gateway) throw new AuthError(503, 'Phương thức thanh toán này chưa được cấu hình.')

    const providerOrderId = input.provider === 'payos'
      ? String(Date.now() * 1000 + randomInt(0, 1000))
      : 'TR' + Date.now() + randomInt(100000, 999999)
    const plan = SUBSCRIPTION_PLANS[input.planId]
    let order = await this.repository.create({
      id: randomUUID(),
      userId: user.id,
      customerEmail: user.email,
      customerName: user.displayName,
      planId: input.planId,
      provider: input.provider,
      providerOrderId,
      amountVnd: plan.monthlyPriceVnd,
    })

    const returnUrl = new URL('/goi-dang-ky', this.appBaseUrl)
    returnUrl.searchParams.set('payment', 'pending')
    returnUrl.searchParams.set('order', order.id)
    const cancelUrl = new URL(returnUrl)
    cancelUrl.searchParams.set('payment', 'cancelled')

    try {
      const checkout = await gateway.createCheckout(order, returnUrl.toString(), cancelUrl.toString())
      order = await this.repository.setCheckoutUrl(order.id, checkout.checkoutUrl) ?? order
      return { orderId: order.id, checkoutUrl: checkout.checkoutUrl }
    } catch (error) {
      await this.repository.setStatus(order.provider, order.providerOrderId, 'failed')
      // The gateway refused or timed out: a temporary upstream failure, not a server bug.
      console.error('[billing.checkout] Gateway error:', error instanceof Error ? error.message : 'Unknown error')
      throw new AuthError(502, 'Cổng thanh toán đang gặp sự cố. Vui lòng thử lại sau ít phút.')
    }
  }

  async getOrder(user: PublicUser, id: string): Promise<PaymentOrder> {
    const order = await this.repository.getOwned(id, user.id)
    if (!order) throw new AuthError(404, 'Không tìm thấy giao dịch.')
    return order
  }

  async exportLedger(user: PublicUser): Promise<Buffer> {
    if (user.role !== 'admin') throw new AuthError(403, 'Chỉ quản trị viên được tải sổ giao dịch.')
    if (!this.ledger) throw new AuthError(503, 'Sổ giao dịch chưa được cấu hình.')
    return this.ledger.toBuffer()
  }

  async handlePayosWebhook(payload: Record<string, unknown>): Promise<void> {
    const gateway = this.gateways.get('payos')
    if (!gateway || !gateway.verifyWebhook(payload)) throw new AuthError(401, 'Chữ ký payOS không hợp lệ.')
    const data = payload.data as Record<string, unknown>
    const providerOrderId = String(data.orderCode ?? '')
    if (!providerOrderId) return
    const order = await this.repository.getByProviderOrder('payos', providerOrderId)
    if (!order) return
    if (Number(data.amount) !== order.amountVnd) throw new AuthError(400, 'Số tiền giao dịch không khớp.')
    if (payload.success === true && String(data.code ?? '') === '00') {
      await this.activate(order, String(data.reference ?? data.paymentLinkId ?? providerOrderId))
    } else {
      await this.repository.setStatus('payos', providerOrderId, 'failed')
    }
  }

  async handleMomoWebhook(payload: Record<string, unknown>): Promise<void> {
    const gateway = this.gateways.get('momo')
    if (!gateway || !gateway.verifyWebhook(payload)) throw new AuthError(401, 'Chữ ký MoMo không hợp lệ.')
    const providerOrderId = String(payload.orderId ?? '')
    if (!providerOrderId) return
    const order = await this.repository.getByProviderOrder('momo', providerOrderId)
    if (!order) return
    if (Number(payload.amount) !== order.amountVnd) throw new AuthError(400, 'Số tiền giao dịch không khớp.')
    const resultCode = Number(payload.resultCode)
    if (resultCode === 0) {
      await this.activate(order, String(payload.transId ?? providerOrderId))
    } else if (resultCode !== 9000) {
      await this.repository.setStatus('momo', providerOrderId, 'failed')
    }
  }

  close() { return this.repository.close() }

  private async activate(order: PaymentOrder, transactionId: string) {
    const plan = SUBSCRIPTION_PLANS[order.planId]
    await this.repository.complete(order.provider, order.providerOrderId, transactionId, plan.entitlements.imageCredits)
  }
}
