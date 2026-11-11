import Database from 'better-sqlite3'
import type { GarmentCategory, GarmentRecord, UpdateGarmentInput } from '../domain/garment.js'
import type { GarmentRepository } from './garment-repository.js'
import type { ListOptions } from '../http/pagination.js'

type GarmentRow = {
  id: string
  user_id: string
  name: string
  category: GarmentCategory
  front_original_key: string
  front_processed_key: string
  back_original_key: string | null
  back_processed_key: string | null
  created_at: string
}

const fromRow = (row: GarmentRow): GarmentRecord => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  category: row.category,
  frontOriginalKey: row.front_original_key,
  frontProcessedKey: row.front_processed_key,
  backOriginalKey: row.back_original_key,
  backProcessedKey: row.back_processed_key,
  createdAt: row.created_at,
})

export class SqliteGarmentRepository implements GarmentRepository {
  private readonly database: Database.Database

  constructor(databasePath: string) {
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS garments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('tops', 'outerwear', 'bottoms', 'shoes', 'accessories')),
        front_original_key TEXT NOT NULL,
        front_processed_key TEXT NOT NULL,
        back_original_key TEXT,
        back_processed_key TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_garments_created_at
      ON garments(created_at DESC);
    `)
    const columns = this.database.pragma('table_info(garments)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'user_id')) {
      this.database.exec("ALTER TABLE garments ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy'")
    }
    const tableDefinition = this.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'garments'")
      .get() as { sql: string } | undefined
    if (tableDefinition && !tableDefinition.sql.includes("'outerwear'")) {
      this.database.exec(`
        BEGIN;
        CREATE TABLE garments_next (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('tops', 'outerwear', 'bottoms', 'shoes', 'accessories')),
          front_original_key TEXT NOT NULL,
          front_processed_key TEXT NOT NULL,
          back_original_key TEXT,
          back_processed_key TEXT,
          created_at TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT 'legacy'
        );

        INSERT INTO garments_next (
          id, name, category, front_original_key, front_processed_key,
          back_original_key, back_processed_key, created_at, user_id
        )
        SELECT
          id, name, category, front_original_key, front_processed_key,
          back_original_key, back_processed_key, created_at, user_id
        FROM garments;

        DROP TABLE garments;
        ALTER TABLE garments_next RENAME TO garments;
        COMMIT;
      `)
    }
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_garments_created_at
      ON garments(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_garments_user_created
      ON garments(user_id, created_at DESC);
    `)
  }

  list(userId: string, options?: ListOptions): GarmentRecord[] {
    const paginated = options?.limit !== undefined
    const rows = this.database
      .prepare(`SELECT * FROM garments WHERE user_id = ? ORDER BY created_at DESC${paginated ? ' LIMIT ? OFFSET ?' : ''}`)
      .all(...(paginated ? [userId, options.limit!, options.offset ?? 0] : [userId])) as GarmentRow[]
    return rows.map(fromRow)
  }

  count(userId: string): number {
    const row = this.database.prepare('SELECT count(*) AS count FROM garments WHERE user_id = ?').get(userId) as { count: number }
    return row.count
  }

  findById(userId: string, id: string): GarmentRecord | null {
    const row = this.database
      .prepare('SELECT * FROM garments WHERE user_id = ? AND id = ?')
      .get(userId, id) as GarmentRow | undefined
    return row ? fromRow(row) : null
  }

  create(garment: GarmentRecord): GarmentRecord {
    this.database
      .prepare(`
        INSERT INTO garments (
          id, user_id, name, category, front_original_key, front_processed_key,
          back_original_key, back_processed_key, created_at
        ) VALUES (
          @id, @userId, @name, @category, @frontOriginalKey, @frontProcessedKey,
          @backOriginalKey, @backProcessedKey, @createdAt
        )
      `)
      .run(garment)
    return garment
  }

  createIfBelowLimit(garment: GarmentRecord, maxItems: number): GarmentRecord | null {
    const createWithinLimit = this.database.transaction(() => {
      const row = this.database
        .prepare('SELECT count(*) AS count FROM garments WHERE user_id = ?')
        .get(garment.userId) as { count: number }
      if (row.count >= maxItems) return null
      return this.create(garment)
    })
    return createWithinLimit()
  }

  update(userId: string, id: string, input: UpdateGarmentInput): GarmentRecord | null {
    const existing = this.findById(userId, id)
    if (!existing) return null

    const updated: GarmentRecord = {
      ...existing,
      name: input.name !== undefined ? input.name : existing.name,
      category: input.category !== undefined ? input.category : existing.category,
    }

    this.database
      .prepare(`
        UPDATE garments
        SET name = @name, category = @category
        WHERE user_id = @userId AND id = @id
      `)
      .run(updated)

    return updated
  }

  delete(userId: string, id: string): boolean {
    return this.database.prepare('DELETE FROM garments WHERE user_id = ? AND id = ?').run(userId, id).changes > 0
  }

  close(): void {
    this.database.close()
  }
}
