import type { GatewayCheckout, PaymentGateway, PaymentOrder } from './types.js'
import { hmacSha256, payosDataString, secureSignatureEqual } from './signatures.js'

type PayosConfig = { clientId: string; apiKey: string; checksumKey: string }

export class PayosGateway implements PaymentGateway {
  readonly provider = 'payos' as const
  constructor(private readonly config: PayosConfig) {}

  async createCheckout(order: PaymentOrder, returnUrl: string, cancelUrl: string): Promise<GatewayCheckout> {
    const description = 'FITSY ' + order.planId.toUpperCase() + ' ' + order.providerOrderId.slice(-6)
    const signed = {
      amount: order.amountVnd,
      cancelUrl,
      description,
      orderCode: Number(order.providerOrderId),
      returnUrl,
    }
    const response = await fetch('https://api-merchant.payos.vn/v2/payment-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': this.config.clientId,
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify({ ...signed, signature: hmacSha256(this.config.checksumKey, payosDataString(signed)) }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json().catch(() => null) as { code?: string; desc?: string; data?: { checkoutUrl?: string } } | null
    if (!response.ok || body?.code !== '00' || !body.data?.checkoutUrl) {
      throw new Error('payOS không tạo được phiên thanh toán' + (body?.desc ? ': ' + body.desc : '.'))
    }
    return { checkoutUrl: body.data.checkoutUrl }
  }

  verifyWebhook(payload: Record<string, unknown>): boolean {
    const data = payload.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    const expected = hmacSha256(this.config.checksumKey, payosDataString(data as Record<string, unknown>))
    return secureSignatureEqual(expected, payload.signature)
  }
}
