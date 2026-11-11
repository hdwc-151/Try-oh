import Database from 'better-sqlite3'
import type { PostgresPool } from '../storage/postgres.js'

export type GenerationRequest = {
  fingerprint: string
  status: number | null
  body: unknown
}
export type GenerationClaim = { claimed: true } | { claimed: false; previous: GenerationRequest }

/** A pending claim is never stolen: a timed out worker may still be spending money. */
export interface GenerationRequestStore {
  claim(userId: string, key: string, fingerprint: string): Promise<GenerationClaim>
  complete(userId: string, key: string, status: number, body: unknown): Promise<void>
  deleteUser(userId: string): Promise<void>
  close?(): void
}

// Retain pending claims too. Clearing one could repeat a paid call after a crash.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export class MemoryGenerationRequestStore implements GenerationRequestStore {
  private readonly entries = new Map<string, GenerationRequest & { expires: number }>()
  async claim(userId: string, key: string, fingerprint: string): Promise<GenerationClaim> {
    const id = JSON.stringify([userId, key])
    const now = Date.now()
    for (const [entryKey, value] of this.entries) if (value.expires <= now) this.entries.delete(entryKey)
    const previous = this.entries.get(id)
    if (previous) return { claimed: false, previous }
    this.entries.set(id, { fingerprint, status: null, body: null, expires: now + RETENTION_MS })
    return { claimed: true }
  }
  async complete(userId: string, key: string, status: number, body: unknown) {
    const entry = this.entries.get(JSON.stringify([userId, key]))
    if (entry) Object.assign(entry, { status, body })
  }
  async deleteUser(userId: string) {
    for (const key of this.entries.keys()) if (JSON.parse(key)[0] === userId) this.entries.delete(key)
  }
}

export class SqliteGenerationRequestStore implements GenerationRequestStore {
  private readonly db: Database.Database
  private lastPrunedAt = 0
  constructor(filename: string) {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec('CREATE TABLE IF NOT EXISTS generation_requests (user_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, status INTEGER, response_json TEXT, expires_at INTEGER NOT NULL, PRIMARY KEY (user_id, request_key)); CREATE INDEX IF NOT EXISTS generation_requests_expiry ON generation_requests(expires_at)')
  }
  async claim(userId: string, key: string, fingerprint: string): Promise<GenerationClaim> {
    const now = Date.now()
    if (now - this.lastPrunedAt > 60_000) {
      this.db.prepare('DELETE FROM generation_requests WHERE expires_at <= ?').run(now)
      this.lastPrunedAt = now
    }
    const inserted = this.db.prepare('INSERT OR IGNORE INTO generation_requests(user_id, request_key, fingerprint, expires_at) VALUES (?, ?, ?, ?)').run(userId, key, fingerprint, now + RETENTION_MS)
    if (inserted.changes) return { claimed: true }
    const row = this.db.prepare('SELECT fingerprint, status, response_json FROM generation_requests WHERE user_id = ? AND request_key = ?').get(userId, key) as { fingerprint: string; status: number | null; response_json: string | null }
    return { claimed: false, previous: { fingerprint: row.fingerprint, status: row.status, body: row.response_json === null ? null : JSON.parse(row.response_json) } }
  }
  async complete(userId: string, key: string, status: number, body: unknown) {
    this.db.prepare('UPDATE generation_requests SET status = ?, response_json = ? WHERE user_id = ? AND request_key = ? AND status IS NULL').run(status, JSON.stringify(body), userId, key)
  }
  async deleteUser(userId: string) { this.db.prepare('DELETE FROM generation_requests WHERE user_id = ?').run(userId) }
  close() { this.db.close() }
}

export class PostgresGenerationRequestStore implements GenerationRequestStore {
  private lastPrunedAt = 0
  constructor(private readonly pool: PostgresPool) {}
  async claim(userId: string, key: string, fingerprint: string): Promise<GenerationClaim> {
    const now = Date.now()
    if (now - this.lastPrunedAt > 60_000) {
      // A bounded batch avoids a long delete on the request path.
      await this.pool.query('DELETE FROM public.generation_requests WHERE ctid IN (SELECT ctid FROM public.generation_requests WHERE expires_at <= now() LIMIT 1000)')
      this.lastPrunedAt = now
    }
    const inserted = await this.pool.query('INSERT INTO public.generation_requests(user_id, request_key, fingerprint, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING request_key', [userId, key, fingerprint, new Date(now + RETENTION_MS).toISOString()])
    if (inserted.rows.length) return { claimed: true }
    const result = await this.pool.query('SELECT fingerprint, status, response_json FROM public.generation_requests WHERE user_id = $1 AND request_key = $2', [userId, key])
    const row = result.rows[0] as { fingerprint: string; status: number | null; response_json: unknown } | undefined
    // Account deletion may have removed the claim between queries. Do not run AI.
    if (!row) throw new Error('Generation request no longer exists.')
    return { claimed: false, previous: { fingerprint: row.fingerprint, status: row.status, body: row.response_json } }
  }
  async complete(userId: string, key: string, status: number, body: unknown) {
    await this.pool.query('UPDATE public.generation_requests SET status = $3, response_json = $4::jsonb WHERE user_id = $1 AND request_key = $2 AND status IS NULL', [userId, key, status, JSON.stringify(body)])
  }
  async deleteUser(userId: string) { await this.pool.query('DELETE FROM public.generation_requests WHERE user_id = $1', [userId]) }
}
