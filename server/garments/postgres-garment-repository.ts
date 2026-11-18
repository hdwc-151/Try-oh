import type { GarmentCategory, GarmentRecord, UpdateGarmentInput } from './garment.js'
import type { GarmentRepository } from './garment-repository.js'
import type { PostgresPool } from '../storage/postgres.js'
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
  created_at: Date | string
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
  createdAt: new Date(row.created_at).toISOString(),
})

export class PostgresGarmentRepository implements GarmentRepository {
  constructor(private readonly pool: PostgresPool) {}

  async list(userId: string, options?: ListOptions): Promise<GarmentRecord[]> {
    const values: Array<string | number> = [userId]
    const pagination = options?.limit !== undefined
      ? ` LIMIT $${values.push(options.limit)} OFFSET $${values.push(options.offset ?? 0)}`
      : ''
    const result = await this.pool.query<GarmentRow>(
      `SELECT id,user_id,name,category,front_original_key,front_processed_key,back_original_key,back_processed_key,created_at
       FROM garments WHERE user_id = $1 ORDER BY created_at DESC${pagination}`,
      values,
    )
    return result.rows.map(fromRow)
  }

  async count(userId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM garments WHERE user_id=$1', [userId])
    return Number(result.rows[0]?.count ?? 0)
  }

  async findById(userId: string, id: string): Promise<GarmentRecord | null> {
    const result = await this.pool.query<GarmentRow>(
      'SELECT * FROM garments WHERE user_id = $1 AND id = $2 LIMIT 1',
      [userId, id],
    )
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }

  async create(garment: GarmentRecord): Promise<GarmentRecord> {
    await this.pool.query(`
      INSERT INTO garments (
        id, user_id, name, category, front_original_key, front_processed_key,
        back_original_key, back_processed_key, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      garment.id, garment.userId, garment.name, garment.category,
      garment.frontOriginalKey, garment.frontProcessedKey,
      garment.backOriginalKey, garment.backProcessedKey, garment.createdAt,
    ])
    return garment
  }

  async createIfBelowLimit(garment: GarmentRecord, maxItems: number): Promise<GarmentRecord | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [garment.userId])
      const countResult = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM garments WHERE user_id=$1',
        [garment.userId],
      )
      if (Number(countResult.rows[0]?.count ?? 0) >= maxItems) {
        await client.query('ROLLBACK')
        return null
      }
      await client.query(
        'INSERT INTO garments(id,user_id,name,category,front_original_key,front_processed_key,back_original_key,back_processed_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          garment.id, garment.userId, garment.name, garment.category,
          garment.frontOriginalKey, garment.frontProcessedKey,
          garment.backOriginalKey, garment.backProcessedKey, garment.createdAt,
        ],
      )
      await client.query('COMMIT')
      return garment
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async update(userId: string, id: string, input: UpdateGarmentInput): Promise<GarmentRecord | null> {
    const result = await this.pool.query<GarmentRow>(`
      UPDATE garments
      SET name = COALESCE($3, name), category = COALESCE($4, category)
      WHERE user_id = $1 AND id = $2
      RETURNING *
    `, [userId, id, input.name ?? null, input.category ?? null])
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM garments WHERE user_id = $1 AND id = $2', [userId, id])
    return (result.rowCount ?? 0) > 0
  }

  async close(): Promise<void> {}
}
