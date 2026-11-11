import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { describe, expect, it } from 'vitest'
import {
  buildRateLimitKey,
  createFixedWindowRateLimit,
  createTokenBucketRateLimit,
  MemoryRateLimitStore,
} from './rate-limit.js'

type MiddlewareResult = {
  next: boolean
  status: number
  body?: unknown
  headers: Map<string, string>
}

const runMiddleware = (handler: RequestHandler, ip = '203.0.113.10'): Promise<MiddlewareResult> => new Promise((resolve, reject) => {
  const headers = new Map<string, string>()
  let status = 200
  const request = { ip, socket: { remoteAddress: ip }, body: {} } as Request
  const response = {
    setHeader: (name: string, value: string | number | readonly string[]) => { headers.set(name.toLowerCase(), String(value)); return response },
    status: (value: number) => { status = value; return response },
    json: (body: unknown) => { resolve({ next: false, status, body, headers }); return response },
  } as unknown as Response
  const next: NextFunction = (error?: unknown) => error
    ? reject(error)
    : resolve({ next: true, status, headers })
  Promise.resolve(handler(request, response, next)).catch(reject)
})

describe('rate limit', () => {
  it('chia sẻ fixed window, trả 429 và header chuẩn', async () => {
    let now = 1_000
    const store = new MemoryRateLimitStore({ now: () => now })
    const middleware = createFixedWindowRateLimit({
      namespace: 'test', store, max: 1, windowMs: 10_000, key: (request) => request.ip ?? 'unknown',
      now: () => now,
    })

    expect((await runMiddleware(middleware)).next).toBe(true)
    const blocked = await runMiddleware(middleware)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('10')
    expect(blocked.body).toMatchObject({ code: 'rate_limit_exceeded' })

    now += 10_001
    expect((await runMiddleware(middleware)).next).toBe(true)
  })

  it('token bucket cho burst ngắn và tự nạp lại token', async () => {
    let now = 5_000
    const middleware = createTokenBucketRateLimit({
      requestsPerMinute: 60,
      burst: 2,
      now: () => now,
    })

    expect((await runMiddleware(middleware)).next).toBe(true)
    expect((await runMiddleware(middleware)).next).toBe(true)
    expect((await runMiddleware(middleware)).status).toBe(429)
    now += 1_000
    expect((await runMiddleware(middleware)).next).toBe(true)
  })

  it('không lưu email hoặc IP thô trong bucket key', () => {
    const key = buildRateLimitKey('auth.login.account', 'account:user@example.com')
    expect(key).toMatch(/^auth\.login\.account:/)
    expect(key).not.toContain('user@example.com')
  })
})
