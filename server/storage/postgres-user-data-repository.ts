import type { PersonImageRecord } from '../domain/person-image.js'
import type { SavedOutfitRecord } from '../domain/saved-outfit.js'
import type { TryOnResultRecord } from '../domain/try-on-result.js'
import type { TryOnAngle } from '../providers/image-provider.js'
import type { PostgresPool } from './postgres.js'
import type { ListOptions } from '../http/pagination.js'
import type { DeletedUserData, UserDataRepository } from './user-data-repository.js'

const iso = (value: Date | string): string => new Date(value).toISOString()

export class PostgresUserDataRepository implements UserDataRepository {
  constructor(private readonly pool: PostgresPool) {}

  async getPersonImage(userId: string): Promise<PersonImageRecord | null> {
    const result = await this.pool.query<{
      image_key: string; width: number; height: number; warnings: string[]; created_at: Date | string
    }>('SELECT image_key, width, height, warnings, created_at FROM person_images WHERE user_id = $1', [userId])
    const row = result.rows[0]
    return row ? {
      id: 'current', imageKey: row.image_key, width: row.width, height: row.height,
      warnings: row.warnings ?? [], createdAt: iso(row.created_at),
    } : null
  }

  async upsertPersonImage(userId: string, record: PersonImageRecord): Promise<string | null> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const previous = await client.query<{ image_key: string }>(
        'SELECT image_key FROM person_images WHERE user_id = $1 FOR UPDATE', [userId],
      )
      await client.query(`
        INSERT INTO person_images (user_id, image_key, width, height, warnings, created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (user_id) DO UPDATE SET
          image_key=EXCLUDED.image_key, width=EXCLUDED.width, height=EXCLUDED.height,
          warnings=EXCLUDED.warnings, created_at=EXCLUDED.created_at
      `, [userId, record.imageKey, record.width, record.height, record.warnings, record.createdAt])
      await client.query('DELETE FROM try_on_images WHERE user_id = $1', [userId])
      await client.query('COMMIT')
      return previous.rows[0]?.image_key ?? null
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async deletePersonImage(userId: string): Promise<string | null> {
    const result = await this.pool.query<{ image_key: string }>(
      'DELETE FROM person_images WHERE user_id = $1 RETURNING image_key',
      [userId],
    )
    return result.rows[0]?.image_key ?? null
  }

  async listTryOnResults(userId: string): Promise<TryOnResultRecord[]> {
    const result = await this.pool.query<{
      angle: TryOnAngle; image_url: string; image_key: string | null; created_at: Date | string
    }>('SELECT angle, image_url, image_key, created_at FROM try_on_images WHERE user_id = $1', [userId])
    return result.rows.map((row) => ({
      angle: row.angle, imageUrl: row.image_url, imageKey: row.image_key, createdAt: iso(row.created_at),
    }))
  }

  async upsertTryOnResult(userId: string, record: TryOnResultRecord): Promise<void> {
    await this.pool.query(`
      INSERT INTO try_on_images (user_id, angle, image_url, image_key, created_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (user_id, angle) DO UPDATE SET
        image_url=EXCLUDED.image_url, image_key=EXCLUDED.image_key, created_at=EXCLUDED.created_at
    `, [userId, record.angle, record.imageUrl, record.imageKey, record.createdAt])
  }

  async deleteTryOnResult(userId: string, angle: TryOnResultRecord['angle']): Promise<string | null> {
    const result = await this.pool.query<{ image_key: string | null }>(
      'DELETE FROM try_on_images WHERE user_id = $1 AND angle = $2 RETURNING image_key',
      [userId, angle],
    )
    return result.rows[0]?.image_key ?? null
  }

  async listSavedOutfits(userId: string, options?: ListOptions): Promise<SavedOutfitRecord[]> {
    const values: Array<string | number> = [userId]
    const pagination = options?.limit !== undefined
      ? ` LIMIT $${values.push(options.limit)} OFFSET $${values.push(options.offset ?? 0)}`
      : ''
    const result = await this.pool.query<{
      id: string; front_image_url: string; front_image_key: string | null;
      back_image_url: string | null; back_image_key: string | null;
      garment_ids: string[]; created_at: Date | string
    }>(`SELECT id, front_image_url, front_image_key, back_image_url, back_image_key,
        garment_ids, created_at FROM saved_outfits WHERE user_id = $1 ORDER BY created_at DESC${pagination}`, values)
    return result.rows.map((row) => ({
      id: row.id, frontImageUrl: row.front_image_url, frontImageKey: row.front_image_key,
      backImageUrl: row.back_image_url, backImageKey: row.back_image_key,
      garmentIds: row.garment_ids ?? [], createdAt: iso(row.created_at),
    }))
  }

  async countSavedOutfits(userId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM saved_outfits WHERE user_id=$1', [userId])
    return Number(result.rows[0]?.count ?? 0)
  }

  async findPendingOutfit(userId: string, frontImageUrl: string): Promise<SavedOutfitRecord | null> {
    const result = await this.pool.query<{
      id: string; front_image_url: string; front_image_key: string | null; back_image_url: string | null;
      back_image_key: string | null; garment_ids: string[]; created_at: Date | string
    }>(`SELECT id,front_image_url,front_image_key,back_image_url,back_image_key,garment_ids,created_at
        FROM saved_outfits WHERE user_id=$1 AND front_image_url=$2 AND back_image_url IS NULL LIMIT 1`, [userId, frontImageUrl])
    const row = result.rows[0]
    return row ? { id: row.id, frontImageUrl: row.front_image_url, frontImageKey: row.front_image_key,
      backImageUrl: row.back_image_url, backImageKey: row.back_image_key, garmentIds: row.garment_ids ?? [], createdAt: iso(row.created_at) } : null
  }

  async saveOutfit(userId: string, record: SavedOutfitRecord): Promise<void> {
    await this.pool.query(`
      INSERT INTO saved_outfits (
        id,user_id,front_image_url,front_image_key,back_image_url,back_image_key,garment_ids,created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (id) DO UPDATE SET
        front_image_url=EXCLUDED.front_image_url, front_image_key=EXCLUDED.front_image_key,
        back_image_url=EXCLUDED.back_image_url, back_image_key=EXCLUDED.back_image_key,
        garment_ids=EXCLUDED.garment_ids, created_at=EXCLUDED.created_at
      WHERE saved_outfits.user_id = EXCLUDED.user_id
    `, [record.id, userId, record.frontImageUrl, record.frontImageKey, record.backImageUrl,
      record.backImageKey, record.garmentIds, record.createdAt])
  }

  async saveOutfitIfBelowLimit(userId: string, record: SavedOutfitRecord, maxItems: number): Promise<boolean> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))', [userId])
      const existing = await client.query('SELECT 1 FROM saved_outfits WHERE user_id=$1 AND id=$2', [userId, record.id])
      if ((existing.rowCount ?? 0) === 0) {
        const countResult = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM saved_outfits WHERE user_id=$1',
          [userId],
        )
        if (Number(countResult.rows[0]?.count ?? 0) >= maxItems) {
          await client.query('ROLLBACK')
          return false
        }
      }
      await client.query(
        'INSERT INTO saved_outfits(id,user_id,front_image_url,front_image_key,back_image_url,back_image_key,garment_ids,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET front_image_url=EXCLUDED.front_image_url,front_image_key=EXCLUDED.front_image_key,back_image_url=EXCLUDED.back_image_url,back_image_key=EXCLUDED.back_image_key,garment_ids=EXCLUDED.garment_ids,created_at=EXCLUDED.created_at WHERE saved_outfits.user_id=EXCLUDED.user_id',
        [record.id, userId, record.frontImageUrl, record.frontImageKey, record.backImageUrl, record.backImageKey, record.garmentIds, record.createdAt],
      )
      await client.query('COMMIT')
      return true
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async deleteSavedOutfit(userId: string, id: string): Promise<SavedOutfitRecord | null> {
    const result = await this.pool.query<{
      id: string; front_image_url: string; front_image_key: string | null; back_image_url: string | null;
      back_image_key: string | null; garment_ids: string[]; created_at: Date | string
    }>(`DELETE FROM saved_outfits WHERE user_id=$1 AND id=$2 RETURNING
        id,front_image_url,front_image_key,back_image_url,back_image_key,garment_ids,created_at`, [userId, id])
    const row = result.rows[0]
    return row ? { id: row.id, frontImageUrl: row.front_image_url, frontImageKey: row.front_image_key,
      backImageUrl: row.back_image_url, backImageKey: row.back_image_key, garmentIds: row.garment_ids ?? [], createdAt: iso(row.created_at) } : null
  }

  async isImageKeySaved(userId: string, key: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM saved_outfits WHERE user_id=$1 AND (front_image_key=$2 OR back_image_key=$2) LIMIT 1',
      [userId, key],
    )
    return result.rowCount === 1
  }

  async clearAllUserData(userId: string): Promise<DeletedUserData> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const person = await client.query<{ image_key: string }>('SELECT image_key FROM person_images WHERE user_id=$1', [userId])
      const results = await client.query<{ image_key: string | null }>('SELECT image_key FROM try_on_images WHERE user_id=$1', [userId])
      const outfits = await client.query<{ front_image_key: string | null; back_image_key: string | null }>(
        'SELECT front_image_key, back_image_key FROM saved_outfits WHERE user_id=$1', [userId],
      )
      await client.query('DELETE FROM person_images WHERE user_id=$1', [userId])
      await client.query('DELETE FROM try_on_images WHERE user_id=$1', [userId])
      await client.query('DELETE FROM saved_outfits WHERE user_id=$1', [userId])
      await client.query('COMMIT')
      return {
        personImageKey: person.rows[0]?.image_key ?? null,
        resultImageKeys: [...new Set([
          ...results.rows.map((row) => row.image_key),
          ...outfits.rows.flatMap((row) => [row.front_image_key, row.back_image_key]),
        ].filter((key): key is string => Boolean(key)))],
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {}
}
