import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { PostgresPool } from '../storage/postgres.js'
import { withTransaction } from '../storage/postgres.js'

export type Migration = { name: string; sql: string; checksum: string }

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort()
  if (!names.length) throw new Error('No database migrations found: ' + directory)
  return Promise.all(names.map(async name => {
    const sql = (await readFile(path.join(directory, name), 'utf8')).replace(/\r\n/g, '\n')
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') }
  }))
}

export async function applyMigrations(pool: PostgresPool, migrations: Migration[]) {
  return withTransaction(pool, async client => {
    // Transaction-scoped lock works through Supabase's transaction pooler.
    await client.query('SELECT pg_advisory_xact_lock(785310261)')
    await client.query('CREATE TABLE IF NOT EXISTS public.tryoh_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    await client.query('REVOKE ALL ON public.tryoh_schema_migrations FROM anon, authenticated')
    const current = await client.query('SELECT name, checksum FROM public.tryoh_schema_migrations')
    const recorded = new Map(current.rows.map(row => [row.name as string, row.checksum as string]))
    for (const row of current.rows) {
      if (!migrations.some(item => item.name === row.name)) throw new Error('Applied migration is missing from this release: ' + row.name)
    }
    const applied: string[] = []
    for (const migration of migrations) {
      const checksum = recorded.get(migration.name)
      if (checksum && checksum !== migration.checksum) throw new Error('Applied migration was edited: ' + migration.name + '. Add a new migration instead.')
      if (checksum) continue
      await client.query(migration.sql)
      await client.query('INSERT INTO public.tryoh_schema_migrations(name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum])
      applied.push(migration.name)
    }
    return applied
  })
}

export async function migrationStatus(pool: PostgresPool, migrations: Migration[]) {
  const exists = await pool.query("SELECT to_regclass('public.tryoh_schema_migrations') AS name")
  const recorded = exists.rows[0]?.name ? (await pool.query('SELECT name, checksum FROM public.tryoh_schema_migrations')).rows : []
  const checksums = new Map(recorded.map(row => [row.name as string, row.checksum as string]))
  return migrations.map(item => ({
    name: item.name,
    status: !checksums.has(item.name) ? 'pending' : checksums.get(item.name) === item.checksum ? 'applied' : 'modified',
  }))
}
