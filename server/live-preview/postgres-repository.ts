import type { PostgresPool } from '../storage/postgres.js'
import type { LivePreviewRepository, LivePreviewUsage } from './repository.js'
import type { LivePreviewSessionRecord, NewLivePreviewSession } from './types.js'

type Row = {
  id: string
  user_id: string
  plan_id: LivePreviewSessionRecord['planId']
  source: LivePreviewSessionRecord['source']
  garment_id: string | null
  category: LivePreviewSessionRecord['category']
  speed: LivePreviewSessionRecord['speed']
  cost: number
  seconds: number
  tokens_issued: number
  created_at: Date | string
}

const columns = 'id,user_id,plan_id,source,garment_id,category,speed,cost,seconds,tokens_issued,created_at'
const toIso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString()
const fromRow = (row: Row): LivePreviewSessionRecord => ({
  id: row.id,
  userId: row.user_id,
  planId: row.plan_id,
  source: row.source,
  garmentId: row.garment_id,
  category: row.category,
  speed: row.speed,
  cost: Number(row.cost),
  seconds: Number(row.seconds),
  tokensIssued: Number(row.tokens_issued),
  createdAt: toIso(row.created_at),
})

export class PostgresLivePreviewRepository implements LivePreviewRepository {
  constructor(private readonly pool: PostgresPool) {}

  async listUsageSince(userId: string, since: Date): Promise<LivePreviewUsage[]> {
    const result = await this.pool.query<{ created_at: Date | string; cost: number }>(
      'SELECT created_at,cost FROM live_preview_sessions WHERE user_id=$1 AND created_at>$2 ORDER BY created_at ASC',
      [userId, since],
    )
    return result.rows.map(row => ({ createdAt: toIso(row.created_at), cost: Number(row.cost) }))
  }

  async tryCreate(session: NewLivePreviewSession, limit: number | null, since: Date): Promise<LivePreviewSessionRecord | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      try {
        // Serialises concurrent starts of one account. The count runs as its own
        // statement after the lock, so it sees sessions committed while waiting.
        const profile = await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [session.userId])
        if (!profile.rows.length) throw new Error('Không tìm thấy hồ sơ người dùng.')
        if (limit !== null) {
          const used = await client.query<{ used: number }>(
            'SELECT coalesce(sum(cost),0)::int AS used FROM live_preview_sessions WHERE user_id=$1 AND created_at>$2',
            [session.userId, since],
          )
          if ((used.rows[0]?.used ?? 0) + session.cost > limit) {
            await client.query('ROLLBACK')
            return null
          }
        }
        const inserted = await client.query<Row>(
          `INSERT INTO live_preview_sessions(id,user_id,plan_id,source,garment_id,category,speed,cost,seconds)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${columns}`,
          [session.id, session.userId, session.planId, session.source, session.garmentId, session.category, session.speed, session.cost, session.seconds],
        )
        await client.query('COMMIT')
        return fromRow(inserted.rows[0]!)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    } finally {
      client.release()
    }
  }

  async tryIssueToken(userId: string, sessionId: string, maxTokens: number, createdAfter: Date): Promise<LivePreviewSessionRecord | null> {
    const result = await this.pool.query<Row>(
      `UPDATE live_preview_sessions SET tokens_issued=tokens_issued+1
       WHERE id=$1 AND user_id=$2 AND tokens_issued<$3 AND created_at>$4
       RETURNING ${columns}`,
      [sessionId, userId, maxTokens, createdAfter],
    )
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }

  async releaseToken(userId: string, sessionId: string): Promise<void> {
    await this.pool.query(
      'UPDATE live_preview_sessions SET tokens_issued=tokens_issued-1 WHERE id=$1 AND user_id=$2 AND tokens_issued>0',
      [sessionId, userId],
    )
  }

  async deleteUnused(userId: string, sessionId: string): Promise<void> {
    await this.pool.query('DELETE FROM live_preview_sessions WHERE id=$1 AND user_id=$2 AND tokens_issued=0', [sessionId, userId])
  }

  async close(): Promise<void> {}
}
