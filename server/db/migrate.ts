import 'dotenv/config'
import path from 'node:path'
import { createPostgresPool } from '../storage/postgres.js'
import { applyMigrations, loadMigrations, migrationStatus } from './migrations.js'

const pool = createPostgresPool(process.env.DATABASE_URL ?? '')
try {
  const migrations = await loadMigrations(path.resolve('supabase/migrations'))
  if (process.argv.includes('--status')) {
    const status = await migrationStatus(pool, migrations)
    console.table(status)
    if (status.some(item => item.status === 'modified')) process.exitCode = 1
  } else {
    const applied = await applyMigrations(pool, migrations)
    console.info('Migrations applied: ' + (applied.join(', ') || 'none; database is current'))
  }
} finally { await pool.end() }
