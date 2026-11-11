import type { GatewayCheckout, PaymentGateway, PaymentOrder } from './types.js'
import { hmacSha256, secureSignatureEqual } from './signatures.js'

type MomoConfig = {
  partnerCode: string
  accessKey: string
  secretKey: string
  endpoint: string
  requestType: string
}

const text = (payload: Record<string, unknown>, key: string) => String(payload[key] ?? '')

export class MomoGateway implements PaymentGateway {
  readonly provider = 'momo' as const
  constructor(private readonly config: MomoConfig) {}

  async createCheckout(order: PaymentOrder, returnUrl: string, _cancelUrl: string): Promise<GatewayCheckout> {
    const requestId = order.providerOrderId
    const orderInfo = 'Thanh toan goi Fitsy ' + order.planId.toUpperCase()
    const extraData = ''
    const ipnUrl = new URL('/api/billing/webhooks/momo', returnUrl).toString()
    const redirectUrl = returnUrl
    const rawSignature = [
      'accessKey=' + this.config.accessKey,
      'amount=' + order.amountVnd,
      'extraData=' + extraData,
      'ipnUrl=' + ipnUrl,
      'orderId=' + order.providerOrderId,
      'orderInfo=' + orderInfo,
      'partnerCode=' + this.config.partnerCode,
      'redirectUrl=' + redirectUrl,
      'requestId=' + requestId,
      'requestType=' + this.config.requestType,
    ].join('&')
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partnerCode: this.config.partnerCode,
        partnerName: 'Fitsy',
        storeId: 'Fitsy',
        requestType: this.config.requestType,
        ipnUrl,
        redirectUrl,
        orderId: order.providerOrderId,
        amount: order.amountVnd,
        lang: 'vi',
        orderInfo,
        requestId,
        extraData,
        autoCapture: true,
        signature: hmacSha256(this.config.secretKey, rawSignature),
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const body = await response.json().catch(() => null) as { resultCode?: number; message?: string; payUrl?: string } | null
    if (!response.ok || body?.resultCode !== 0 || !body.payUrl) {
      throw new Error('MoMo không tạo được phiên thanh toán' + (body?.message ? ': ' + body.message : '.'))
    }
    return { checkoutUrl: body.payUrl }
  }

  verifyWebhook(payload: Record<string, unknown>): boolean {
    const rawSignature = [
      'accessKey=' + this.config.accessKey,
      'amount=' + text(payload, 'amount'),
      'extraData=' + text(payload, 'extraData'),
      'message=' + text(payload, 'message'),
      'orderId=' + text(payload, 'orderId'),
      'orderInfo=' + text(payload, 'orderInfo'),
      'orderType=' + text(payload, 'orderType'),
      'partnerCode=' + text(payload, 'partnerCode'),
      'payType=' + text(payload, 'payType'),
      'requestId=' + text(payload, 'requestId'),
      'responseTime=' + text(payload, 'responseTime'),
      'resultCode=' + text(payload, 'resultCode'),
      'transId=' + text(payload, 'transId'),
    ].join('&')
    return text(payload, 'partnerCode') === this.config.partnerCode
      && secureSignatureEqual(hmacSha256(this.config.secretKey, rawSignature), payload.signature)
  }
}
