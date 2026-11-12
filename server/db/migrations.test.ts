// @vitest-environment node
import path from 'node:path'
import { expect, it } from 'vitest'
import { createTestDatabase } from '../__tests__/pglite-pool.js'
import { applyMigrations, loadMigrations, migrationStatus } from './migrations.js'

it('migrates a fresh database once and rejects edited history', async () => {
  const db = await createTestDatabase(false)
  try {
    const migrations = await loadMigrations(path.resolve('supabase/migrations'))
    expect((await migrationStatus(db.pool, migrations)).every(item => item.status === 'pending')).toBe(true)
    expect(await applyMigrations(db.pool, migrations)).toHaveLength(migrations.length)
    expect(await applyMigrations(db.pool, migrations)).toEqual([])
    expect((await migrationStatus(db.pool, migrations)).every(item => item.status === 'applied')).toBe(true)
    const changed = migrations.map((item, index) => index === 0 ? { ...item, checksum: 'edited' } : item)
    await expect(applyMigrations(db.pool, changed)).rejects.toThrow('Applied migration was edited')
  } finally { await db.close() }
})

it('rolls back the whole release when any migration fails', async () => {
  const db = await createTestDatabase(false)
  try {
    await expect(applyMigrations(db.pool, [
      { name: '001_first.sql', sql: 'create table public.rollback_probe(id int)', checksum: 'one' },
      { name: '002_broken.sql', sql: 'THIS IS NOT SQL', checksum: 'two' },
    ])).rejects.toThrow()
    expect((await db.pool.query("select to_regclass('public.rollback_probe') as name")).rows[0]?.name).toBeNull()
  } finally { await db.close() }
})

it('keeps internal trigger RPCs inaccessible while signup triggers still work', async () => {
  const db = await createTestDatabase()
  try {
    const permissions = await db.pool.query(`select
      has_function_privilege('anon', 'public.handle_new_auth_user()', 'EXECUTE') as anon_signup,
      has_function_privilege('authenticated', 'public.anonymize_payment_orders_before_profile_delete()', 'EXECUTE') as user_anonymize`)
    expect(permissions.rows[0]).toEqual({ anon_signup: false, user_anonymize: false })
    const id = '11111111-1111-4111-8111-111111111111'
    await db.createUser(id, 'test@example.com', 'Test User')
    expect((await db.pool.query('select display_name from public.profiles where id=$1', [id])).rows[0]?.display_name).toBe('Test User')
  } finally { await db.close() }
})
