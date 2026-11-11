import type { ImageStorage } from './image-storage.js'
import type { PostgresPool } from './postgres.js'

/** Deletes stored image objects that are no longer referenced. */
export interface StorageCleanup {
  /** Schedules objects for deletion. Never throws for a single failed object. */
  enqueue(keys: Iterable<string>, reason: string): Promise<void>
  start?(intervalMs?: number): void
  stop?(): void
}

/**
 * Best-effort removal of images that are no longer needed. Never throws: a
 * storage hiccup must not fail a request whose database work already succeeded.
 */
export const discardImages = async (cleanup: StorageCleanup, keys: Iterable<string | null | undefined>, reason: string): Promise<void> => {
  const unique = [...new Set(keys)].filter((key): key is string => Boolean(key))
  if (!unique.length) return
  try {
    await cleanup.enqueue(unique, reason)
  } catch (error) {
    console.error(`[storage.cleanup] Could not schedule ${unique.length} objects (${reason}):`, toError(error))
  }
}

const MAX_ATTEMPTS = 12
const BATCH_SIZE = 50
const toError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500)

/** Local/SQLite mode: delete immediately and log failures. */
export class ImmediateStorageCleanup implements StorageCleanup {
  constructor(private readonly images: ImageStorage) {}
  async enqueue(keys: Iterable<string>, reason: string): Promise<void> {
    const unique = [...new Set(keys)].filter(Boolean)
    const results = await Promise.allSettled(unique.map(key => this.images.delete(key)))
    const failed = results.filter(result => result.status === 'rejected').length
    if (failed) console.error(`[storage.cleanup] ${failed}/${unique.length} objects could not be deleted (${reason}).`)
  }
}

/**
 * Production mode: a durable queue in PostgreSQL (storage_cleanup_queue) drained by
 * a background loop with exponential backoff. Objects still referenced by any
 * row are skipped, so a queued key can never break live content.
 */
export class PostgresStorageCleanup implements StorageCleanup {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null

  constructor(private readonly pool: PostgresPool, private readonly images: ImageStorage) {}

  async enqueue(keys: Iterable<string>, reason: string): Promise<void> {
    const unique = [...new Set(keys)].filter(Boolean)
    if (!unique.length) return
    await this.pool.query(
      `INSERT INTO storage_cleanup_queue(image_key, reason) SELECT unnest($1::text[]), $2
       ON CONFLICT (image_key) DO UPDATE SET next_attempt_at = now()`, [unique, reason])
    void this.runOnce().catch(error => console.error('[storage.cleanup]', toError(error)))
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.runOnce().catch(error => console.error('[storage.cleanup]', toError(error)))
    }, intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One drain pass. Concurrent calls share the same pass. */
  runOnce(): Promise<void> {
    this.running ??= this.drain().finally(() => { this.running = null })
    return this.running
  }

  private async drain(): Promise<void> {
    await this.pool.query(
      `WITH expired AS (DELETE FROM temporary_images WHERE expires_at <= now() RETURNING image_key)
       INSERT INTO storage_cleanup_queue(image_key, reason) SELECT image_key, 'temporary_expired' FROM expired
       ON CONFLICT (image_key) DO NOTHING`)
    const claimed = await this.pool.query<{ image_key: string }>(
      `UPDATE storage_cleanup_queue
       SET attempts = attempts + 1,
           next_attempt_at = now() + make_interval(mins => least(1440, power(2, attempts)::int))
       WHERE image_key IN (
         SELECT image_key FROM storage_cleanup_queue
         WHERE next_attempt_at <= now() AND attempts < ${MAX_ATTEMPTS}
         ORDER BY next_attempt_at LIMIT ${BATCH_SIZE}
         FOR UPDATE SKIP LOCKED
       )
       RETURNING image_key`)
    for (const { image_key: key } of claimed.rows) {
      try {
        if (await this.isReferenced(key)) {
          await this.pool.query('DELETE FROM storage_cleanup_queue WHERE image_key = $1', [key])
          continue
        }
        await this.images.delete(key)
        await this.pool.query('DELETE FROM storage_cleanup_queue WHERE image_key = $1', [key])
      } catch (error) {
        await this.pool.query('UPDATE storage_cleanup_queue SET last_error = $2 WHERE image_key = $1', [key, toError(error)])
      }
    }
  }

  private async isReferenced(key: string): Promise<boolean> {
    const urls = [...new Set([`/uploads/${key}`, `/uploads/${encodeURIComponent(key)}`])]
    const result = await this.pool.query<{ used: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM garments WHERE front_original_key = $1 OR front_processed_key = $1 OR back_original_key = $1 OR back_processed_key = $1)
           OR EXISTS (SELECT 1 FROM person_images WHERE image_key = $1)
           OR EXISTS (SELECT 1 FROM try_on_images WHERE image_key = $1)
           OR EXISTS (SELECT 1 FROM saved_outfits WHERE front_image_key = $1 OR back_image_key = $1)
           OR EXISTS (SELECT 1 FROM temporary_images WHERE image_key = $1 AND expires_at > now())
           OR EXISTS (SELECT 1 FROM social_profiles WHERE avatar = ANY($2::text[]))
           OR EXISTS (SELECT 1 FROM social_posts WHERE image_urls && $2::text[])
           OR EXISTS (SELECT 1 FROM social_poll_options WHERE image_url = ANY($2::text[])) AS used`, [key, urls])
    return Boolean(result.rows[0]?.used)
  }
}
