import { createHash } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { PostgresPool } from '../storage/postgres.js'

export type RateLimitCounter = { count: number; resetAt: number }

export interface RateLimitStore {
  consume(key: string, windowMs: number): Promise<RateLimitCounter>
  reset(key: string): Promise<void>
  close?(): Promise<void>
}

type MemoryEntry = RateLimitCounter & { lastSeenAt: number }

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, MemoryEntry>()
  private nextSweepAt = 0

  constructor(private readonly options: { now?: () => number; maxEntries?: number } = {}) {}

  async consume(key: string, windowMs: number): Promise<RateLimitCounter> {
    const now = this.options.now?.() ?? Date.now()
    this.sweep(now, windowMs)
    const current = this.entries.get(key)
    const entry = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowMs, lastSeenAt: now }
      : { ...current, count: current.count + 1, lastSeenAt: now }
    this.entries.delete(key)
    this.entries.set(key, entry)
    this.trim()
    return { count: entry.count, resetAt: entry.resetAt }
  }

  async reset(key: string): Promise<void> { this.entries.delete(key) }
  async close(): Promise<void> { this.entries.clear() }

  private sweep(now: number, windowMs: number) {
    if (now < this.nextSweepAt) return
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key)
    this.nextSweepAt = now + Math.min(windowMs, 60_000)
  }

  private trim() {
    const maxEntries = this.options.maxEntries ?? 50_000
    while (this.entries.size > maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined
      if (!oldestKey) return
      this.entries.delete(oldestKey)
    }
  }
}

export class PostgresRateLimitStore implements RateLimitStore {
  private consumeCount = 0
  constructor(private readonly pool: PostgresPool) {}

  async consume(key: string, windowMs: number): Promise<RateLimitCounter> {
    const result = await this.pool.query<{ request_count: number; reset_at: string }>(
      "INSERT INTO api_rate_limits(bucket_key,request_count,window_started_at,expires_at) VALUES($1,1,now(),now()+($2::bigint*interval '1 millisecond')) ON CONFLICT(bucket_key) DO UPDATE SET request_count=CASE WHEN api_rate_limits.expires_at<=now() THEN 1 ELSE api_rate_limits.request_count+1 END,window_started_at=CASE WHEN api_rate_limits.expires_at<=now() THEN now() ELSE api_rate_limits.window_started_at END,expires_at=CASE WHEN api_rate_limits.expires_at<=now() THEN now()+($2::bigint*interval '1 millisecond') ELSE api_rate_limits.expires_at END RETURNING request_count,(extract(epoch from expires_at)*1000)::bigint::text AS reset_at",
      [key, windowMs],
    )
    this.consumeCount += 1
    if (this.consumeCount % 500 === 0) void this.pool.query("DELETE FROM api_rate_limits WHERE expires_at < now()-interval '1 day'").catch(() => undefined)
    const row = result.rows[0]
    if (!row) throw new Error('Không thể cập nhật rate limit trong PostgreSQL.')
    return { count: Number(row.request_count), resetAt: Number(row.reset_at) }
  }

  async reset(key: string): Promise<void> { await this.pool.query('DELETE FROM api_rate_limits WHERE bucket_key=$1', [key]) }
  async close(): Promise<void> {}
}

export const buildRateLimitKey = (namespace: string, identifier: string): string => {
  const digest = createHash('sha256').update(identifier).digest('base64url')
  return namespace + ':' + digest
}

const clientAddress = (request: Request): string => request.ip ?? request.socket.remoteAddress ?? 'unknown'

const setRateLimitHeaders = (response: Response, limit: number, remaining: number, resetAt: number, now: number) => {
  const resetSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000))
  response.setHeader('RateLimit-Limit', String(limit))
  response.setHeader('RateLimit-Remaining', String(Math.max(0, remaining)))
  response.setHeader('RateLimit-Reset', String(resetSeconds))
  response.setHeader('X-RateLimit-Limit', String(limit))
  response.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)))
  response.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
}

export const createFixedWindowRateLimit = (options: {
  max: number
  windowMs: number
  namespace?: string
  store?: RateLimitStore
  key: (request: Request) => string | string[]
  message?: string
  skip?: (request: Request) => boolean
  now?: () => number
}): RequestHandler => {
  const store = options.store ?? new MemoryRateLimitStore()
  const namespace = options.namespace ?? 'api'
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (options.skip?.(request)) { next(); return }
      const rawKeys = [options.key(request)].flat().filter(Boolean)
      for (const rawKey of rawKeys) {
        const now = options.now?.() ?? Date.now()
        const counter = await store.consume(buildRateLimitKey(namespace, rawKey), options.windowMs)
        setRateLimitHeaders(response, options.max, options.max - counter.count, counter.resetAt, now)
        if (counter.count > options.max) {
          response.setHeader('Retry-After', String(Math.max(1, Math.ceil((counter.resetAt - now) / 1000))))
          response.setHeader('Cache-Control', 'no-store')
          response.status(429).json({ message: options.message ?? 'Bạn đang gửi quá nhiều yêu cầu. Vui lòng thử lại sau.', code: 'rate_limit_exceeded' })
          return
        }
      }
      next()
    } catch (error) { next(error) }
  }
}

type TokenBucketEntry = { tokens: number; updatedAt: number; lastSeenAt: number }

export const createTokenBucketRateLimit = (options: {
  requestsPerMinute: number
  burst: number
  key?: (request: Request) => string
  message?: string
  skip?: (request: Request) => boolean
  now?: () => number
  maxEntries?: number
}): RequestHandler => {
  const buckets = new Map<string, TokenBucketEntry>()
  const refillPerMs = options.requestsPerMinute / 60_000
  let nextSweepAt = 0
  return (request, response, next) => {
    if (options.skip?.(request)) { next(); return }
    const now = options.now?.() ?? Date.now()
    if (now >= nextSweepAt) {
      const inactiveBefore = now - 10 * 60_000
      for (const [key, entry] of buckets) if (entry.lastSeenAt < inactiveBefore) buckets.delete(key)
      nextSweepAt = now + 60_000
    }
    const rawKey = options.key?.(request) ?? clientAddress(request)
    const key = buildRateLimitKey('api.burst.ip', rawKey)
    const current = buckets.get(key) ?? { tokens: options.burst, updatedAt: now, lastSeenAt: now }
    const tokens = Math.min(options.burst, current.tokens + Math.max(0, now - current.updatedAt) * refillPerMs)
    const allowed = tokens >= 1
    const entry = { tokens: allowed ? tokens - 1 : tokens, updatedAt: now, lastSeenAt: now }
    buckets.delete(key)
    buckets.set(key, entry)
    while (buckets.size > (options.maxEntries ?? 50_000)) {
      const oldestKey = buckets.keys().next().value as string | undefined
      if (!oldestKey) break
      buckets.delete(oldestKey)
    }
    const waitMs = allowed ? 0 : Math.ceil((1 - tokens) / refillPerMs)
    setRateLimitHeaders(response, options.burst, Math.floor(entry.tokens), now + waitMs, now)
    if (!allowed) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil(waitMs / 1000))))
      response.setHeader('Cache-Control', 'no-store')
      response.status(429).json({ message: options.message ?? 'Hệ thống đang nhận quá nhiều yêu cầu. Vui lòng thử lại sau.', code: 'rate_limit_exceeded' })
      return
    }
    next()
  }
}

export const rateLimitIdentity = {
  ip: clientAddress,
  account: (value: unknown): string[] => {
    if (typeof value !== 'string' || !value.trim()) return []
    return ['account:' + value.trim().toLowerCase()]
  },
}
