import Database from 'better-sqlite3'
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
  created_at: string
}

const fromRow = (row: Row): LivePreviewSessionRecord => ({
  id: row.id,
  userId: row.user_id,
  planId: row.plan_id,
  source: row.source,
  garmentId: row.garment_id,
  category: row.category,
  speed: row.speed,
  cost: row.cost,
  seconds: row.seconds,
  tokensIssued: row.tokens_issued,
  createdAt: row.created_at,
})

export class SqliteLivePreviewRepository implements LivePreviewRepository {
  private readonly database: Database.Database

  constructor(databasePath: string) {
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`CREATE TABLE IF NOT EXISTS live_preview_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      source TEXT NOT NULL,
      garment_id TEXT,
      category TEXT NOT NULL,
      speed TEXT NOT NULL DEFAULT 'standard',
      cost INTEGER NOT NULL DEFAULT 1,
      seconds INTEGER NOT NULL,
      tokens_issued INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`)
    // Databases created before the speed tier existed.
    const columns = this.database.pragma('table_info(live_preview_sessions)') as Array<{ name: string }>
    if (!columns.some(column => column.name === 'speed')) this.database.exec("ALTER TABLE live_preview_sessions ADD COLUMN speed TEXT NOT NULL DEFAULT 'standard'")
    if (!columns.some(column => column.name === 'cost')) this.database.exec('ALTER TABLE live_preview_sessions ADD COLUMN cost INTEGER NOT NULL DEFAULT 1')
    this.database.exec('CREATE INDEX IF NOT EXISTS live_preview_sessions_user_created_idx ON live_preview_sessions(user_id, created_at)')
  }

  listUsageSince(userId: string, since: Date): LivePreviewUsage[] {
    const rows = this.database.prepare('SELECT created_at,cost FROM live_preview_sessions WHERE user_id=? AND created_at>? ORDER BY created_at ASC')
      .all(userId, since.toISOString()) as Array<{ created_at: string; cost: number }>
    return rows.map(row => ({ createdAt: row.created_at, cost: row.cost }))
  }

  tryCreate(session: NewLivePreviewSession, limit: number | null, since: Date): LivePreviewSessionRecord | null {
    return this.database.transaction(() => {
      const used = this.listUsageSince(session.userId, since).reduce((sum, item) => sum + item.cost, 0)
      if (limit !== null && used + session.cost > limit) return null
      const createdAt = new Date().toISOString()
      this.database.prepare(`INSERT INTO live_preview_sessions(id,user_id,plan_id,source,garment_id,category,speed,cost,seconds,tokens_issued,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,0,?)`)
        .run(session.id, session.userId, session.planId, session.source, session.garmentId, session.category, session.speed, session.cost, session.seconds, createdAt)
      return { ...session, tokensIssued: 0, createdAt }
    }).immediate()
  }

  tryIssueToken(userId: string, sessionId: string, maxTokens: number, createdAfter: Date): LivePreviewSessionRecord | null {
    return this.database.transaction(() => {
      const changed = this.database.prepare('UPDATE live_preview_sessions SET tokens_issued=tokens_issued+1 WHERE id=? AND user_id=? AND tokens_issued<? AND created_at>?')
        .run(sessionId, userId, maxTokens, createdAfter.toISOString())
      if (changed.changes !== 1) return null
      const row = this.database.prepare('SELECT * FROM live_preview_sessions WHERE id=?').get(sessionId) as Row
      return fromRow(row)
    }).immediate()
  }

  releaseToken(userId: string, sessionId: string): void {
    this.database.prepare('UPDATE live_preview_sessions SET tokens_issued=tokens_issued-1 WHERE id=? AND user_id=? AND tokens_issued>0').run(sessionId, userId)
  }

  deleteUnused(userId: string, sessionId: string): void {
    this.database.prepare('DELETE FROM live_preview_sessions WHERE id=? AND user_id=? AND tokens_issued=0').run(sessionId, userId)
  }

  close(): void {
    this.database.close()
  }
}
