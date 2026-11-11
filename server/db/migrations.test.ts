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
