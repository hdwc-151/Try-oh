// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../__tests__/pglite-pool.js'
import { PostgresOAuthStore } from './oauth-store.js'

describe('PostgresOAuthStore', () => {
  let test: TestDatabase
  beforeEach(async () => { test = await createTestDatabase() })
  afterEach(async () => { await test.close() })

  it('hands each state and session out exactly once, from any instance', async () => {
    const first = new PostgresOAuthStore(test.pool)
    const second = new PostgresOAuthStore(test.pool)
    const state = await first.start({ codeVerifier: 'v', browserSecret: 's', redirectTo: '/app', client: 'web' })
    expect(await second.finish(state)).toEqual({ codeVerifier: 'v', browserSecret: 's', redirectTo: '/app', client: 'web' })
    expect(await first.finish(state)).toBeNull()

    const code = await second.holdSession({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 })
    expect(await first.finish(code)).toBeNull()
    expect(await first.claimSession(code)).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 })
    expect(await second.claimSession(code)).toBeNull()
  })

  it('stores only a hash of the key and refuses expired entries', async () => {
    const store = new PostgresOAuthStore(test.pool)
    const state = await store.start({ codeVerifier: 'v', redirectTo: '/', client: 'mobile' })
    const rows = (await test.db.query<{ key_hash: string }>('select key_hash from oauth_states')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]!.key_hash).not.toBe(state)
    await test.db.query("update oauth_states set expires_at = now() - interval '1 second'")
    expect(await store.finish(state)).toBeNull()
    expect(await store.finish(undefined)).toBeNull()
  })
})
