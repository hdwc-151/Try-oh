import { createHash } from 'node:crypto'

/*
 * Shopee Affiliate Open API (GraphQL) client.
 *
 * Every request is signed: Authorization: SHA256 Credential={AppId}, Timestamp={unix s},
 * Signature=sha256(AppId + Timestamp + Payload + Secret), where Payload is the exact
 * JSON body sent. The server rejects timestamps more than 10 minutes off.
 * AppId and Secret come from the affiliate portal and must stay server-side.
 */

export const DEFAULT_SHOPEE_AFFILIATE_ENDPOINT = 'https://open-api.affiliate.shopee.vn/graphql'

export type ShopeeAffiliateConfig = {
  appId: string
  secret: string
  endpoint?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
}

export type ShopeeAffiliateErrorKind = 'auth' | 'rate_limit' | 'invalid_request' | 'unavailable'

export class ShopeeAffiliateError extends Error {
  constructor(
    readonly kind: ShopeeAffiliateErrorKind,
    message: string,
    readonly code?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ShopeeAffiliateError'
  }
}

/** Signature exactly as the affiliate documentation defines it. */
export const signShopeeAffiliateRequest = (appId: string, timestamp: number, payload: string, secret: string): string =>
  createHash('sha256').update(`${appId}${timestamp}${payload}${secret}`, 'utf8').digest('hex')

export const shopeeAffiliateAuthorization = (appId: string, timestamp: number, payload: string, secret: string): string =>
  `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signShopeeAffiliateRequest(appId, timestamp, payload, secret)}`

// Documented error codes: 10020 and 10031–10035 are credential/signature problems,
// 10030 is the rate limit, 11001 an invalid argument (e.g. limit above 50).
const AUTH_CODES = new Set([10020, 10031, 10032, 10033, 10034, 10035])
const classify = (code: number | undefined, status: number): ShopeeAffiliateErrorKind => {
  if (code !== undefined && AUTH_CODES.has(code)) return 'auth'
  if (code === 10030 || status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (code === 11001 || (status >= 400 && status < 500)) return 'invalid_request'
  return 'unavailable'
}

type GraphqlError = { message?: string; extensions?: { code?: number | string; message?: string } }

export class ShopeeAffiliateClient {
  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number

  constructor(private readonly config: ShopeeAffiliateConfig) {
    if (!config.appId?.trim() || !config.secret?.trim()) throw new Error('Thiếu SHOPEE_AFFILIATE_APP_ID hoặc SHOPEE_AFFILIATE_SECRET.')
    this.endpoint = config.endpoint?.trim() || DEFAULT_SHOPEE_AFFILIATE_ENDPOINT
    this.fetchImpl = config.fetchImpl ?? fetch
    this.now = config.now ?? Date.now
  }

  /** Runs one GraphQL query or mutation. Retries once on a timeout or HTTP 5xx. */
  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    try {
      return await this.send<T>(query, variables)
    } catch (error) {
      if (error instanceof ShopeeAffiliateError && error.kind === 'unavailable') return this.send<T>(query, variables)
      throw error
    }
  }

  private async send<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    // The signature covers these exact bytes, so the body is built once and sent as is.
    const payload = JSON.stringify(variables ? { query, variables } : { query })
    const timestamp = Math.floor(this.now() / 1000)
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: shopeeAffiliateAuthorization(this.config.appId, timestamp, payload, this.config.secret),
        },
        body: payload,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      })
    } catch (error) {
      throw new ShopeeAffiliateError('unavailable', 'Không kết nối được Shopee Affiliate API.', undefined, { cause: error })
    }
    const body = await response.json().catch(() => null) as { data?: T; errors?: GraphqlError[] } | null
    const first = body?.errors?.[0]
    if (!response.ok || first) {
      const rawCode = first?.extensions?.code
      const code = typeof rawCode === 'number' ? rawCode : Number.isFinite(Number(rawCode)) ? Number(rawCode) : undefined
      const kind = classify(code, response.status)
      const detail = first?.extensions?.message ?? first?.message ?? `HTTP ${response.status}`
      throw new ShopeeAffiliateError(kind, `Shopee Affiliate API: ${detail}`, code)
    }
    if (!body?.data) throw new ShopeeAffiliateError('unavailable', 'Shopee Affiliate API trả về dữ liệu rỗng.')
    return body.data
  }

  /** Short affiliate link for any Shopee URL; `subIds` (up to 5) tag clicks, e.g. by KOC. */
  async generateShortLink(originUrl: string, subIds: string[] = []): Promise<string> {
    const data = await this.query<{ generateShortLink: { shortLink: string } }>(
      'mutation($input: ShortLinkInput!) { generateShortLink(input: $input) { shortLink } }',
      { input: { originUrl, subIds: subIds.slice(0, 5) } },
    )
    return data.generateShortLink.shortLink
  }
}

export const createShopeeAffiliateClientFromEnv = (env: NodeJS.ProcessEnv = process.env): ShopeeAffiliateClient | null => {
  const appId = env.SHOPEE_AFFILIATE_APP_ID?.trim()
  const secret = env.SHOPEE_AFFILIATE_SECRET?.trim()
  if (!appId || !secret) return null
  return new ShopeeAffiliateClient({ appId, secret, endpoint: env.SHOPEE_AFFILIATE_ENDPOINT })
}
