import Database from 'better-sqlite3'
import type { PersonImageRecord } from './person-image.js'
import type { SavedOutfitRecord } from './saved-outfit.js'
import type { TryOnResultRecord } from './try-on-result.js'
import type { TryOnAngle } from '../providers/image-provider.js'
import type { DeletedUserData, UserDataRepository } from './user-data-repository.js'
import type { ListOptions } from '../http/pagination.js'

type PersonImageRow = {
  user_id: string
  image_key: string
  width: number
  height: number
  warnings_json: string
  created_at: string
}

export class SqliteUserDataRepository implements UserDataRepository {
  private readonly database: Database.Database

  constructor(databasePath: string) {
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS person_image (
        user_id TEXT PRIMARY KEY,
        image_key TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        warnings_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS try_on_results (
        id TEXT PRIMARY KEY,
        image_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS try_on_images (
        user_id TEXT NOT NULL,
        angle TEXT NOT NULL CHECK (angle IN ('front', 'back')),
        image_url TEXT NOT NULL,
        image_key TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, angle)
      );

      CREATE TABLE IF NOT EXISTS saved_outfits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        front_image_url TEXT NOT NULL,
        front_image_key TEXT,
        back_image_url TEXT,
        back_image_key TEXT,
        garment_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
    const personColumns = this.database.pragma('table_info(person_image)') as Array<{ name: string }>
    if (!personColumns.some((column) => column.name === 'user_id')) {
      this.database.exec(`
        BEGIN;
        ALTER TABLE person_image RENAME TO person_image_legacy;
        CREATE TABLE person_image (
          user_id TEXT PRIMARY KEY,
          image_key TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          warnings_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO person_image (user_id, image_key, width, height, warnings_json, created_at)
          SELECT 'legacy', image_key, width, height, warnings_json, created_at FROM person_image_legacy;
        DROP TABLE person_image_legacy;
        COMMIT;
      `)
    }
    const resultColumns = this.database.pragma('table_info(try_on_images)') as Array<{ name: string }>
    if (!resultColumns.some((column) => column.name === 'image_key')) {
      this.database.exec('ALTER TABLE try_on_images ADD COLUMN image_key TEXT')
    }
    if (!resultColumns.some((column) => column.name === 'user_id')) {
      this.database.exec(`
        BEGIN;
        ALTER TABLE try_on_images RENAME TO try_on_images_legacy;
        CREATE TABLE try_on_images (
          user_id TEXT NOT NULL,
          angle TEXT NOT NULL CHECK (angle IN ('front', 'back')),
          image_url TEXT NOT NULL,
          image_key TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, angle)
        );
        INSERT INTO try_on_images (user_id, angle, image_url, image_key, created_at)
          SELECT 'legacy', angle, image_url, image_key, created_at FROM try_on_images_legacy;
        DROP TABLE try_on_images_legacy;
        COMMIT;
      `)
    }
    const savedOutfitColumns = this.database.pragma('table_info(saved_outfits)') as Array<{ name: string; notnull: number }>
    const backImageUrlColumn = savedOutfitColumns.find((column) => column.name === 'back_image_url')
    if (backImageUrlColumn?.notnull === 1) {
      this.database.exec(`
        BEGIN;
        CREATE TABLE saved_outfits_next (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL DEFAULT 'legacy',
          front_image_url TEXT NOT NULL,
          front_image_key TEXT,
          back_image_url TEXT,
          back_image_key TEXT,
          garment_ids_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO saved_outfits_next
          SELECT id, 'legacy', front_image_url, front_image_key, back_image_url, back_image_key,
            garment_ids_json, created_at
          FROM saved_outfits;
        DROP TABLE saved_outfits;
        ALTER TABLE saved_outfits_next RENAME TO saved_outfits;
        COMMIT;
      `)
    }
    const refreshedSavedColumns = this.database.pragma('table_info(saved_outfits)') as Array<{ name: string }>
    if (!refreshedSavedColumns.some((column) => column.name === 'user_id')) {
      this.database.exec("ALTER TABLE saved_outfits ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy'")
    }
    this.database.exec('CREATE INDEX IF NOT EXISTS idx_saved_outfits_user_created ON saved_outfits(user_id, created_at DESC)')
    if (this.listSavedOutfits('legacy').length === 0) {
      const currentResults = this.listTryOnResults('legacy')
      const front = currentResults.find((result) => result.angle === 'front')
      const back = currentResults.find((result) => result.angle === 'back')
      if (front && back) {
        this.saveOutfit('legacy', {
          id: `imported-${Date.now()}`,
          frontImageUrl: front.imageUrl,
          frontImageKey: front.imageKey,
          backImageUrl: back.imageUrl,
          backImageKey: back.imageKey,
          garmentIds: [],
          createdAt: front.createdAt > back.createdAt ? front.createdAt : back.createdAt,
        })
      }
    }
  }

  getPersonImage(userId: string): PersonImageRecord | null {
    const row = this.database.prepare('SELECT * FROM person_image WHERE user_id = ?').get(userId) as PersonImageRow | undefined
    if (!row) return null
    return {
      id: 'current',
      imageKey: row.image_key,
      width: row.width,
      height: row.height,
      warnings: JSON.parse(row.warnings_json) as string[],
      createdAt: row.created_at,
    }
  }

  upsertPersonImage(userId: string, record: PersonImageRecord): string | null {
    const previous = this.getPersonImage(userId)
    this.database.prepare(`
      INSERT INTO person_image (user_id, image_key, width, height, warnings_json, created_at)
      VALUES (@userId, @imageKey, @width, @height, @warningsJson, @createdAt)
      ON CONFLICT(user_id) DO UPDATE SET
        image_key = excluded.image_key,
        width = excluded.width,
        height = excluded.height,
        warnings_json = excluded.warnings_json,
        created_at = excluded.created_at
    `).run({
      userId,
      ...record,
      warningsJson: JSON.stringify(record.warnings),
    })
    this.database.prepare('DELETE FROM try_on_images WHERE user_id = ?').run(userId)
    return previous?.imageKey ?? null
  }

  deletePersonImage(userId: string): string | null {
    const remove = this.database.transaction(() => {
      const imageKey = this.getPersonImage(userId)?.imageKey ?? null
      this.database.prepare('DELETE FROM person_image WHERE user_id = ?').run(userId)
      return imageKey
    })
    return remove()
  }

  listTryOnResults(userId: string): TryOnResultRecord[] {
    const rows = this.database.prepare(
      'SELECT angle, image_url, image_key, created_at FROM try_on_images WHERE user_id = ?',
    ).all(userId) as Array<{ angle: TryOnAngle; image_url: string; image_key: string | null; created_at: string }>
    return rows.map((row) => ({
      angle: row.angle,
      imageUrl: row.image_url,
      imageKey: row.image_key,
      createdAt: row.created_at,
    }))
  }

  upsertTryOnResult(userId: string, record: TryOnResultRecord): void {
    this.database.prepare(`
      INSERT INTO try_on_images (user_id, angle, image_url, image_key, created_at)
      VALUES (@userId, @angle, @imageUrl, @imageKey, @createdAt)
      ON CONFLICT(user_id, angle) DO UPDATE SET
        image_url = excluded.image_url,
        image_key = excluded.image_key,
        created_at = excluded.created_at
    `).run({ userId, ...record })
  }

  deleteTryOnResult(userId: string, angle: TryOnResultRecord['angle']): string | null {
    const row = this.database.prepare(
      'SELECT image_key FROM try_on_images WHERE user_id = ? AND angle = ?',
    ).get(userId, angle) as { image_key: string | null } | undefined
    this.database.prepare('DELETE FROM try_on_images WHERE user_id = ? AND angle = ?').run(userId, angle)
    return row?.image_key ?? null
  }

  listSavedOutfits(userId: string, options?: ListOptions): SavedOutfitRecord[] {
    const paginated = options?.limit !== undefined
    const rows = this.database.prepare(`
      SELECT id, front_image_url, front_image_key, back_image_url, back_image_key,
        garment_ids_json, created_at
      FROM saved_outfits
      WHERE user_id = ?
      ORDER BY created_at DESC
      ${paginated ? 'LIMIT ? OFFSET ?' : ''}
    `).all(...(paginated ? [userId, options.limit!, options.offset ?? 0] : [userId])) as Array<{
      id: string
      front_image_url: string
      front_image_key: string | null
      back_image_url: string | null
      back_image_key: string | null
      garment_ids_json: string
      created_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      frontImageUrl: row.front_image_url,
      frontImageKey: row.front_image_key,
      backImageUrl: row.back_image_url,
      backImageKey: row.back_image_key,
      garmentIds: JSON.parse(row.garment_ids_json) as string[],
      createdAt: row.created_at,
    }))
  }

  countSavedOutfits(userId: string): number {
    const row = this.database.prepare('SELECT count(*) AS count FROM saved_outfits WHERE user_id = ?').get(userId) as { count: number }
    return row.count
  }

  findPendingOutfit(userId: string, frontImageUrl: string): SavedOutfitRecord | null {
    return this.listSavedOutfits(userId).find((outfit) => (
      outfit.frontImageUrl === frontImageUrl && outfit.backImageUrl === null
    )) ?? null
  }

  saveOutfit(userId: string, record: SavedOutfitRecord): void {
    this.database.prepare(`
      INSERT INTO saved_outfits (
        id, user_id, front_image_url, front_image_key, back_image_url, back_image_key,
        garment_ids_json, created_at
      ) VALUES (
        @id, @userId, @frontImageUrl, @frontImageKey, @backImageUrl, @backImageKey,
        @garmentIdsJson, @createdAt
      )
      ON CONFLICT(id) DO UPDATE SET
        front_image_url = excluded.front_image_url,
        front_image_key = excluded.front_image_key,
        back_image_url = excluded.back_image_url,
        back_image_key = excluded.back_image_key,
        garment_ids_json = excluded.garment_ids_json,
        created_at = excluded.created_at
    `).run({ userId, ...record, garmentIdsJson: JSON.stringify(record.garmentIds) })
  }

  saveOutfitIfBelowLimit(userId: string, record: SavedOutfitRecord, maxItems: number): boolean {
    const saveWithinLimit = this.database.transaction(() => {
      const existing = this.database
        .prepare('SELECT 1 FROM saved_outfits WHERE user_id = ? AND id = ?')
        .get(userId, record.id)
      if (!existing) {
        const row = this.database
          .prepare('SELECT count(*) AS count FROM saved_outfits WHERE user_id = ?')
          .get(userId) as { count: number }
        if (row.count >= maxItems) return false
      }
      this.saveOutfit(userId, record)
      return true
    })
    return saveWithinLimit()
  }

  deleteSavedOutfit(userId: string, id: string): SavedOutfitRecord | null {
    const outfit = this.listSavedOutfits(userId).find((item) => item.id === id) ?? null
    if (outfit) this.database.prepare('DELETE FROM saved_outfits WHERE user_id = ? AND id = ?').run(userId, id)
    return outfit
  }

  isImageKeySaved(userId: string, key: string): boolean {
    return Boolean(this.database.prepare(`
      SELECT 1 FROM saved_outfits
      WHERE user_id = ? AND (front_image_key = ? OR back_image_key = ?)
      LIMIT 1
    `).get(userId, key, key))
  }

  clearAllUserData(userId: string): DeletedUserData {
    const clear = this.database.transaction(() => {
      const personImageKey = this.getPersonImage(userId)?.imageKey ?? null
      const resultRows = this.database.prepare(
        'SELECT image_key FROM try_on_images WHERE user_id = ? AND image_key IS NOT NULL',
      ).all(userId) as Array<{ image_key: string }>
      const savedRows = this.database.prepare(`
        SELECT front_image_key, back_image_key FROM saved_outfits WHERE user_id = ?
      `).all(userId) as Array<{ front_image_key: string | null; back_image_key: string | null }>
      this.database.prepare('DELETE FROM person_image WHERE user_id = ?').run(userId)
      this.database.prepare('DELETE FROM try_on_images WHERE user_id = ?').run(userId)
      this.database.prepare('DELETE FROM saved_outfits WHERE user_id = ?').run(userId)
      return {
        personImageKey,
        resultImageKeys: [...new Set([
          ...resultRows.map((row) => row.image_key),
          ...savedRows.flatMap((row) => [row.front_image_key, row.back_image_key]),
        ].filter((key): key is string => Boolean(key)))],
      }
    })
    return clear()
  }

  close(): void {
    this.database.close()
  }
}
