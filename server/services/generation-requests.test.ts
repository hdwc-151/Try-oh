// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteGenerationRequestStore, PostgresGenerationRequestStore } from './generation-requests.js'
import { createTestDatabase } from '../__tests__/pglite-pool.js'

describe('durable generation receipts', () => {
  it('keeps pending claims and completed responses across SQLite restarts', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tryoh-receipts-'))
    let store = new SqliteGenerationRequestStore(path.join(dir, 'test.sqlite'))
    try {
      expect(await store.claim('user-a', 'request-0001', 'hash-a')).toEqual({ claimed: true })
      store.close()
      store = new SqliteGenerationRequestStore(path.join(dir, 'test.sqlite'))
      expect(await store.claim('user-a', 'request-0001', 'hash-a')).toMatchObject({ claimed: false, previous: { status: null } })
      await store.complete('user-a', 'request-0001', 200, { imageUrl: '/uploads/private.webp' })
      store.close()
      store = new SqliteGenerationRequestStore(path.join(dir, 'test.sqlite'))
      expect(await store.claim('user-a', 'request-0001', 'hash-a')).toMatchObject({ claimed: false, previous: { status: 200, body: { imageUrl: '/uploads/private.webp' } } })
      expect(await store.claim('user-b', 'request-0001', 'hash-a')).toEqual({ claimed: true })
      await store.deleteUser('user-a')
      expect(await store.claim('user-a', 'request-0001', 'hash-a')).toEqual({ claimed: true })
    } finally {
      store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('allows only one PostgreSQL instance to claim a paid request', async () => {
    const db = await createTestDatabase()
    try {
      const userId = 'f183b9ed-2354-4e5d-80d3-b493c6f13cda'
      await db.createUser(userId, 'tryoh@example.com')
      const first = new PostgresGenerationRequestStore(db.pool)
      const second = new PostgresGenerationRequestStore(db.pool)
      const claims = await Promise.all([first.claim(userId, 'request-0001', 'hash'), second.claim(userId, 'request-0001', 'hash')])
      expect(claims.filter(item => item.claimed)).toHaveLength(1)
      await first.complete(userId, 'request-0001', 200, { credits: 9 })
      expect(await second.claim(userId, 'request-0001', 'hash')).toMatchObject({ claimed: false, previous: { status: 200, body: { credits: 9 } } })
      await db.pool.query('delete from auth.users where id = $1', [userId])
      const rows = await db.pool.query('select * from public.generation_requests')
      expect(rows.rows).toHaveLength(0)
    } finally { await db.close() }
  })
})
