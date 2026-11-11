// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../__tests__/pglite-pool.js'
import type { ImageStorage } from './image-storage.js'
import { PostgresStorageCleanup } from './storage-cleanup.js'

const USER = '00000000-0000-4000-8000-000000000001'

describe('PostgresStorageCleanup', () => {
  let test: TestDatabase
  let deleted: string[]
  let images: ImageStorage
  beforeEach(async () => {
    test = await createTestDatabase()
    await test.createUser(USER, 'user@example.com')
    deleted = []
    images = { delete: vi.fn(async (key: string) => { if (key === 'flaky.webp') throw new Error('R2 unavailable'); deleted.push(key) }) } as unknown as ImageStorage
  })
  afterEach(async () => { await test.close() })

  it('deletes unreferenced objects, skips referenced ones and retries failures', async () => {
    await test.db.query("insert into person_images(user_id,image_key,width,height) values($1,'in-use.webp',10,10)", [USER])
    const cleanup = new PostgresStorageCleanup(test.pool, images)
    await test.db.query("insert into storage_cleanup_queue(image_key,reason) values('orphan.webp','test'),('in-use.webp','test'),('flaky.webp','test')")
    await cleanup.runOnce()

    expect(deleted).toEqual(['orphan.webp'])
    const remaining = (await test.db.query<{ image_key: string; attempts: number; last_error: string | null }>('select image_key,attempts,last_error from storage_cleanup_queue')).rows
    expect(remaining).toEqual([{ image_key: 'flaky.webp', attempts: 1, last_error: 'R2 unavailable' }])
  })

  it('moves expired temporary images into the queue and deletes them', async () => {
    await test.db.query("insert into temporary_images(image_key,owner_id,expires_at) values('old.webp',$1,now()-interval '1 minute'),('fresh.webp',$1,now()+interval '1 hour')", [USER])
    await new PostgresStorageCleanup(test.pool, images).runOnce()
    expect(deleted).toEqual(['old.webp'])
    expect((await test.db.query('select image_key from temporary_images')).rows).toEqual([{ image_key: 'fresh.webp' }])
  })
})
