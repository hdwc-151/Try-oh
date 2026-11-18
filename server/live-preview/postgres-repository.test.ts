// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../__tests__/pglite-pool.js'
import { PostgresLivePreviewRepository } from './postgres-repository.js'

const USER = '00000000-0000-4000-8000-000000000001'
const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
const session = () => ({ id: randomUUID(), userId: USER, planId: 'plus' as const, source: 'upload' as const, garmentId: null, category: 'tops' as const, speed: 'standard' as const, cost: 1, seconds: 10 })

describe('PostgresLivePreviewRepository', () => {
  let test: TestDatabase
  beforeEach(async () => {
    test = await createTestDatabase()
    await test.createUser(USER, 'user@example.com')
  })
  afterEach(async () => { await test.close() })

  it('enforces the quota, even for concurrent starts', async () => {
    const repository = new PostgresLivePreviewRepository(test.pool)
    const results = await Promise.all([1, 2, 3].map(() => repository.tryCreate(session(), 2, longAgo)))
    expect(results.filter(Boolean)).toHaveLength(2)
    expect(await repository.listUsageSince(USER, longAgo)).toHaveLength(2)
    expect(await repository.tryCreate(session(), null, longAgo)).not.toBeNull()
  })

  it('counts a fast session by its cost', async () => {
    const repository = new PostgresLivePreviewRepository(test.pool)
    expect(await repository.tryCreate({ ...session(), speed: 'fast', cost: 2 }, 3, longAgo)).not.toBeNull()
    expect(await repository.tryCreate({ ...session(), speed: 'fast', cost: 2 }, 3, longAgo)).toBeNull()
    expect(await repository.tryCreate(session(), 3, longAgo)).not.toBeNull()
    expect(await repository.listUsageSince(USER, longAgo)).toEqual([
      expect.objectContaining({ cost: 2 }), expect.objectContaining({ cost: 1 }),
    ])
  })

  it('counts tokens per session and refunds an unused session', async () => {
    const repository = new PostgresLivePreviewRepository(test.pool)
    const created = (await repository.tryCreate(session(), 5, longAgo))!
    expect((await repository.tryIssueToken(USER, created.id, 2, longAgo))?.tokensIssued).toBe(1)
    expect((await repository.tryIssueToken(USER, created.id, 2, longAgo))?.tokensIssued).toBe(2)
    expect(await repository.tryIssueToken(USER, created.id, 2, longAgo)).toBeNull()
    await repository.releaseToken(USER, created.id)
    await repository.releaseToken(USER, created.id)
    await repository.deleteUnused(USER, created.id)
    expect(await repository.listUsageSince(USER, longAgo)).toHaveLength(0)
  })

  it('does not issue tokens for sessions older than the window', async () => {
    const repository = new PostgresLivePreviewRepository(test.pool)
    const created = (await repository.tryCreate(session(), 5, longAgo))!
    expect(await repository.tryIssueToken(USER, created.id, 2, new Date(Date.now() + 1000))).toBeNull()
  })
})
