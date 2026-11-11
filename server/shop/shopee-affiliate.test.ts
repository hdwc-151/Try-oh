// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ShopeeAffiliateClient, ShopeeAffiliateError, shopeeAffiliateAuthorization, signShopeeAffiliateRequest } from './shopee-affiliate.js'

// Worked example from the Shopee Affiliate Open API authentication page.
const DOC_PAYLOAD = '{"query":"{\\nbrandOffer{\\n    nodes{\\n        commissionRate\\n        offerName\\n    }\\n}\\n}"}'

describe('Shopee Affiliate signing', () => {
  it('matches the documented example signature', () => {
    expect(signShopeeAffiliateRequest('123456', 1577836800, DOC_PAYLOAD, 'demo'))
      .toBe('dc88d72feea70c80c52c3399751a7d34966763f51a7f056aa070a5e9df645412')
    expect(shopeeAffiliateAuthorization('123456', 1577836800, DOC_PAYLOAD, 'demo'))
      .toBe('SHA256 Credential=123456, Timestamp=1577836800, Signature=dc88d72feea70c80c52c3399751a7d34966763f51a7f056aa070a5e9df645412')
  })
})

describe('ShopeeAffiliateClient', () => {
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('signs the exact body it sends', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => respond(200, { data: { ok: true } }))
    const client = new ShopeeAffiliateClient({ appId: '123456', secret: 'demo', fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 1577836800_000 })
    await client.query('{ ok }')
    const init = fetchImpl.mock.calls[0]![1]!
    const body = String(init.body)
    expect(body).toBe('{"query":"{ ok }"}')
    expect((init.headers as Record<string, string>).Authorization).toBe(shopeeAffiliateAuthorization('123456', 1577836800, body, 'demo'))
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://open-api.affiliate.shopee.vn/graphql')
  })

  it('maps documented error codes and does not retry auth or rate-limit errors', async () => {
    const fetchImpl = vi.fn(async () => respond(200, { errors: [{ message: 'Invalid Signature', extensions: { code: 10020 } }] }))
    const client = new ShopeeAffiliateClient({ appId: 'a', secret: 'b', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.query('{ x }')).rejects.toMatchObject({ kind: 'auth', code: 10020 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const limited = vi.fn(async () => respond(429, { errors: [{ message: 'Too many requests', extensions: { code: 10030 } }] }))
    const limitedClient = new ShopeeAffiliateClient({ appId: 'a', secret: 'b', fetchImpl: limited as unknown as typeof fetch })
    await expect(limitedClient.query('{ x }')).rejects.toBeInstanceOf(ShopeeAffiliateError)
    await expect(limitedClient.query('{ x }')).rejects.toMatchObject({ kind: 'rate_limit' })
  })

  it('retries once on a server error', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(respond(502, {}))
      .mockResolvedValueOnce(respond(200, { data: { generateShortLink: { shortLink: 'https://s.shopee.vn/abc' } } }))
    const client = new ShopeeAffiliateClient({ appId: 'a', secret: 'b', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.generateShortLink('https://shopee.vn/product/1/2', ['koc_1'])).resolves.toBe('https://s.shopee.vn/abc')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1].body)).variables).toEqual({ input: { originUrl: 'https://shopee.vn/product/1/2', subIds: ['koc_1'] } })
  })
})
