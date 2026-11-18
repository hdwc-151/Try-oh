import { createHash, randomBytes } from 'node:crypto'
import type { MaybePromise } from '../storage/maybe-promise.js'
import type { PostgresPool } from '../storage/postgres.js'

/** A sign-in that left for Google and has not come back yet. */
export type PendingOAuth = {
  codeVerifier: string
  /** Web only: must match the browser cookie, so a forged callback cannot sign anyone in. */
  browserSecret?: string
  /** Same-site path to open afterwards (web), or the app's redirect URL (mobile). */
  redirectTo: string
  client: 'web' | 'mobile'
}

/** A finished sign-in waiting for the mobile app to collect it, exactly once. */
export type PendingSession = { accessToken: string; refreshToken: string; expiresAt: number }

const PENDING_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 2 * 60 * 1000
const MAX_ENTRIES = 2_000

/** Where the sign-in round trip keeps its state between leaving for Google and coming back. */
export interface OAuthStateStore {
  start(pending: PendingOAuth): MaybePromise<string>
  finish(state: string | null | undefined): MaybePromise<PendingOAuth | null>
  holdSession(session: PendingSession): MaybePromise<string>
  claimSession(code: string | null | undefined): MaybePromise<PendingSession | null>
}

/**
 * Short-lived state for the Google sign-in round trip, held in this process.
 * Entries live for minutes and each is read once, so losing them on restart only
 * means "please sign in again". With several instances use PostgresOAuthStore.
 */
class ExpiringStore<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>()

  constructor(private readonly ttlMs: number) {}

  put(value: T): string {
    const key = randomBytes(32).toString('base64url')
    this.sweep()
    if (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value as string)
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
    return key
  }

  /** Reads and removes: a state or hand-off code is never valid twice. */
  take(key: string | null | undefined): T | null {
    if (!key) return null
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key)
    return entry.expiresAt > Date.now() ? entry.value : null
  }

  private sweep() {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
      else break
    }
  }
}

export class OAuthStore implements OAuthStateStore {
  private readonly pending = new ExpiringStore<PendingOAuth>(PENDING_TTL_MS)
  private readonly sessions = new ExpiringStore<PendingSession>(SESSION_TTL_MS)

  start(pending: PendingOAuth): string { return this.pending.put(pending) }
  finish(state: string | null | undefined): PendingOAuth | null { return this.pending.take(state) }
  holdSession(session: PendingSession): string { return this.sessions.put(session) }
  claimSession(code: string | null | undefined): PendingSession | null { return this.sessions.take(code) }
}

export const newBrowserSecret = () => randomBytes(24).toString('base64url')

type Kind = 'pending' | 'session'
const hashKey = (key: string) => createHash('sha256').update(key).digest('base64url')

/**
 * Shared store for running several instances: the callback (or the app collecting its
 * session) may reach a different instance than the one that started the sign-in.
 * Only a hash of each one-time key is stored, so a database read alone cannot replay it.
 */
export class PostgresOAuthStore implements OAuthStateStore {
  constructor(private readonly pool: PostgresPool) {}

  start(pending: PendingOAuth) { return this.put('pending', pending, PENDING_TTL_MS) }
  finish(state: string | null | undefined) { return this.take<PendingOAuth>('pending', state) }
  holdSession(session: PendingSession) { return this.put('session', session, SESSION_TTL_MS) }
  claimSession(code: string | null | undefined) { return this.take<PendingSession>('session', code) }

  private async put(kind: Kind, value: unknown, ttlMs: number): Promise<string> {
    const key = randomBytes(32).toString('base64url')
    // Expired rows are swept as new ones arrive; the table stays tiny.
    await this.pool.query('DELETE FROM oauth_states WHERE expires_at < now()')
    await this.pool.query(
      'INSERT INTO oauth_states(key_hash, kind, payload, expires_at) VALUES($1, $2, $3, now() + make_interval(secs => $4))',
      [hashKey(key), kind, JSON.stringify(value), ttlMs / 1000],
    )
    return key
  }

  /** Reads and removes in one statement: two instances can never both accept the same key. */
  private async take<T>(kind: Kind, key: string | null | undefined): Promise<T | null> {
    if (!key || key.length > 200) return null
    const result = await this.pool.query<{ payload: T; live: boolean }>(
      'DELETE FROM oauth_states WHERE key_hash = $1 AND kind = $2 RETURNING payload, expires_at > now() AS live',
      [hashKey(key), kind],
    )
    const row = result.rows[0]
    if (!row?.live) return null
    return typeof row.payload === 'string' ? JSON.parse(row.payload) as T : row.payload
  }
}
