import { randomBytes } from 'node:crypto'

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

/**
 * Short-lived state for the Google sign-in round trip, held in this process.
 * Entries live for minutes and each is read once, so losing them on restart only
 * means "please sign in again"; with several instances the flow needs sticky routing.
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

export class OAuthStore {
  private readonly pending = new ExpiringStore<PendingOAuth>(PENDING_TTL_MS)
  private readonly sessions = new ExpiringStore<PendingSession>(SESSION_TTL_MS)

  start(pending: PendingOAuth): string { return this.pending.put(pending) }
  finish(state: string | null | undefined): PendingOAuth | null { return this.pending.take(state) }
  holdSession(session: PendingSession): string { return this.sessions.put(session) }
  claimSession(code: string | null | undefined): PendingSession | null { return this.sessions.take(code) }
}

export const newBrowserSecret = () => randomBytes(24).toString('base64url')
