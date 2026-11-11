import pg from 'pg'

const { Pool } = pg

export type PostgresPool = pg.Pool

const readDatabaseCa = (): string | undefined => {
  const encoded = process.env.DATABASE_CA_CERT_BASE64?.trim()
  if (!encoded) return undefined
  const certificate = Buffer.from(encoded, 'base64').toString('utf8').trim()
  if (!certificate.includes('-----BEGIN CERTIFICATE-----') || !certificate.includes('-----END CERTIFICATE-----')) {
    throw new Error('DATABASE_CA_CERT_BASE64 không chứa certificate PEM hợp lệ.')
  }
  return certificate
}

export const createPostgresPool = (connectionString: string): PostgresPool => {
  if (!connectionString.trim()) throw new Error('DATABASE_URL chưa được cấu hình.')
  const url = new URL(connectionString)
  const ca = readDatabaseCa()

  // Khi truyền TLS options trực tiếp, phải bỏ các tham số SSL khỏi URL vì
  // pg-connection-string có thể ghi đè object `ssl` và làm mất CA đã cấu hình.
  if (ca) {
    url.searchParams.delete('sslmode')
    url.searchParams.delete('sslrootcert')
    url.searchParams.delete('uselibpqcompat')
  } else if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'verify-full')
  }
  const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX ?? 5)
  const poolMax = Number.isInteger(configuredPoolMax) && configuredPoolMax > 0 && configuredPoolMax <= 20
    ? configuredPoolMax
    : 5
  const configuredQueryTimeout = Number(process.env.DATABASE_QUERY_TIMEOUT_MS ?? 20_000)
  const pool = new Pool({
    connectionString: url.toString(),
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Client-side deadline per query: a stuck query fails the request instead of
    // holding a pooled connection (and every request queued behind it) forever.
    // Enforced by the driver, so it also works through Supabase's poolers.
    query_timeout: Number.isFinite(configuredQueryTimeout) && configuredQueryTimeout >= 1_000 ? configuredQueryTimeout : 20_000,
    // Detect connections silently dropped by the pooler or a NAT gateway.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  })
  // Idle connections are recycled by the pooler. Without a listener, the resulting
  // 'error' event is unhandled and takes the whole process down.
  pool.on('error', (error) => {
    console.error('[postgres] Idle connection error:', error.message)
  })
  return pool
}

/**
 * Runs `fn` inside a single transaction on one pooled connection.
 * Rolls back on any error and always releases the connection.
 */
export const withTransaction = async <T>(pool: PostgresPool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
