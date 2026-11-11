// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../__tests__/pglite-pool.js'
import { PostgresAdminRepository } from './postgres-admin-repository.js'

const USER = '00000000-0000-4000-8000-000000000001'
const claims = (displayName: string, role: 'user' | 'admin' = 'user') => ({
  id: USER, email: 'user@example.com', displayName, createdAt: new Date().toISOString(), role, status: 'active' as const,
})

describe('PostgresAdminRepository.syncUser', () => {
  let test: TestDatabase
  let repository: PostgresAdminRepository
  beforeEach(async () => {
    test = await createTestDatabase()
    await test.createUser(USER, 'user@example.com', 'Tên cũ')
    repository = new PostgresAdminRepository(test.pool)
  })
  afterEach(async () => { await test.close() })

  it('does not write a stale name from an old access token back over a rename', async () => {
    // The user renames themselves: Supabase updates auth.users and the trigger updates the profile.
    await test.db.query("update auth.users set raw_user_meta_data = '{\"display_name\":\"Tên mới\"}' where id = $1", [USER])
    // Requests still arrive with the token issued before the rename.
    const resolved = await repository.syncUser(claims('Tên cũ'), false)
    expect(resolved.displayName).toBe('Tên mới')
    const stored = await test.db.query<{ display_name: string }>('select display_name from profiles where id = $1', [USER])
    expect(stored.rows[0]?.display_name).toBe('Tên mới')
  })

  it('records activity at most once per window and promotes a trusted bootstrap admin', async () => {
    const first = await repository.syncUser(claims('Tên cũ'), false)
    expect(first.lastSeenAt).not.toBeNull()
    const again = await repository.syncUser(claims('Tên cũ'), false)
    expect(again.lastSeenAt).toBe(first.lastSeenAt)
    expect(again.role).toBe('user')
    const promoted = await repository.syncUser(claims('Tên cũ', 'admin'), true)
    expect(promoted.role).toBe('admin')
  })
})
