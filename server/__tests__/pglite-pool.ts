// Test-only helper: an in-process PostgreSQL (PGlite) exposed through the small
// subset of the `pg.Pool` API the repositories use, with every migration applied.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { PostgresPool } from '../storage/postgres.js'

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../supabase/migrations')

// Minimal stand-ins for the Supabase objects the migrations reference.
const SUPABASE_STUBS = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`

export type TestDatabase = { pool: PostgresPool; db: PGlite; createUser: (id: string, email: string, name?: string) => Promise<void>; close: () => Promise<void> }

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  for (const file of readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
  }
  // PGlite is a single connection, so serialise access the way a pool would.
  let queue: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn)
    queue = next.catch(() => undefined)
    return next
  }
  const run = async (text: string, values?: unknown[]) => {
    const result = await db.query(text, values as never[])
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length }
  }
  const pool = {
    query: (text: string, values?: unknown[]) => exclusive(() => run(text, values)),
    connect: async () => {
      let release!: () => void
      const held = new Promise<void>(resolve => { release = resolve })
      let ready!: () => void
      const acquired = new Promise<void>(resolve => { ready = resolve })
      void exclusive(async () => { ready(); await held })
      await acquired
      return { query: run, release: () => release() }
    },
    end: async () => undefined,
  } as unknown as PostgresPool
  return {
    pool,
    db,
    createUser: async (id, email, name) => {
      await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, email, JSON.stringify({ display_name: name ?? email.split('@')[0] })])
    },
    close: () => db.close(),
  }
}
