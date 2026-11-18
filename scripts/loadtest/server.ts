/**
 * Máy chủ dùng cho đo tải: ghép đúng các thành phần production (PostgreSQL, router, hàng đợi AI,
 * ảnh thu nhỏ, nén phản hồi) nhưng thay hai thứ bên ngoài:
 *  - Đăng nhập: token chính là id người dùng đã seed (không gọi Supabase Auth).
 *  - OpenRouter: trả ảnh sau LOADTEST_AI_DELAY_MS (mặc định 25 giây) thay vì gọi mạng thật.
 * Ảnh lưu trên đĩa local. KHÔNG dùng cho production.
 *
 *   DATABASE_URL=postgres://... DATA_DIR=/tmp/fitsy-load npx tsx scripts/loadtest/server.ts
 */
import { createServer } from 'node:http'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { createApp } from '../../server/app.js'
import { AdminService } from '../../server/admin/admin-service.js'
import { PostgresAdminRepository } from '../../server/admin/postgres-admin-repository.js'
import type { AuthBackend } from '../../server/auth/auth-backend.js'
import type { PublicUser } from '../../server/auth/auth-store.js'
import { PostgresOAuthStore } from '../../server/auth/oauth-store.js'
import { CreditService } from '../../server/credits/credit-service.js'
import { PostgresCreditRepository } from '../../server/credits/postgres-credit-repository.js'
import { PostgresGarmentRepository } from '../../server/garments/postgres-garment-repository.js'
import { PostgresRateLimitStore } from '../../server/http/rate-limit.js'
import { PlanService } from '../../server/plans/plan-service.js'
import { PostgresPlanRepository } from '../../server/plans/postgres-plan-repository.js'
import { OpenRouterImageProvider } from '../../server/providers/openrouter-image-provider.js'
import { PostgresSocialStore } from '../../server/social/postgres-social-store.js'
import { PostgresGenerationRequestStore } from '../../server/services/generation-requests.js'
import { LocalImageStorage } from '../../server/storage/local-image-storage.js'
import { PostgresStorageCleanup } from '../../server/storage/storage-cleanup.js'
import { configureSharp } from '../../server/storage/sharp-config.js'
import { withThumbnailWarmup } from '../../server/storage/thumbnails.js'
import type { PostgresPool } from '../../server/storage/postgres.js'
import { PostgresUserDataRepository } from '../../server/user-data/postgres-user-data-repository.js'

const port = Number(process.env.PORT ?? 8850)
const aiDelayMs = Number(process.env.LOADTEST_AI_DELAY_MS ?? 25_000)
const uploads = path.join(path.resolve(process.env.DATA_DIR ?? '/tmp/fitsy-load'), 'uploads')

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
}) as unknown as PostgresPool
await pool.query('SELECT 1')

const localImages = new LocalImageStorage(uploads)
await localImages.ensureReady()
const images = withThumbnailWarmup(localImages)

/** Token = id người dùng; tra tên/email một lần rồi giữ trong RAM như cache 60 giây của bản Supabase. */
const users = new Map<string, PublicUser>()
const auth: AuthBackend = {
  register: async () => { throw new Error('not supported') },
  login: async () => { throw new Error('not supported') },
  logout: () => undefined,
  authenticate: async (token) => {
    if (!token || !/^[0-9a-f-]{36}$/.test(token)) return null
    const cached = users.get(token)
    if (cached) return cached
    const row = (await pool.query<{ email: string; display_name: string; created_at: Date }>(
      'SELECT email, display_name, created_at FROM profiles WHERE id = $1', [token])).rows[0]
    if (!row) return null
    const user: PublicUser = { id: token, email: row.email, displayName: row.display_name, createdAt: row.created_at.toISOString(), role: 'user', status: 'active' }
    users.set(token, user)
    return user
  },
}

// Ảnh "AI trả về": JPEG 768×960 ~ cỡ ảnh FLUX thật, mã hoá base64 như API OpenRouter.
configureSharp()

const fakeOutput = (await sharp({ create: { width: 768, height: 960, channels: 3, background: '#8a6f5a' } })
  .composite([{ input: Buffer.from('<svg width="768" height="960"><circle cx="384" cy="380" r="200" fill="#d9c2a5"/></svg>') }])
  .jpeg({ quality: 88 }).toBuffer()).toString('base64')
const fakeOpenRouter: typeof fetch = async (_input, init) => {
  // Đọc body như fetch thật phải gửi đi (ảnh tham chiếu base64 vài trăm KB).
  JSON.parse(String(init?.body ?? '{}'))
  await new Promise(resolve => setTimeout(resolve, aiDelayMs * (0.8 + Math.random() * 0.4)))
  return new Response(JSON.stringify({ data: [{ b64_json: fakeOutput }] }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const provider = new OpenRouterImageProvider({
  apiKey: 'loadtest', model: 'black-forest-labs/flux-3-image-klein', resolution: '768', aspectRatio: '4:5',
  baseUrl: `http://127.0.0.1:${port}`, outputStorage: images, timeoutMs: 120_000, fetchImpl: fakeOpenRouter,
})

const plans = new PlanService(new PostgresPlanRepository(pool))
const credits = new CreditService(new PostgresCreditRepository(pool), plans)
const social = new PostgresSocialStore(pool)
const cleanup = new PostgresStorageCleanup(pool, images)
const garments = new PostgresGarmentRepository(pool)

const app = createApp(
  garments,
  new PostgresUserDataRepository(pool),
  images,
  uploads,
  provider,
  auth,
  false,
  undefined,
  social,
  new AdminService(new PostgresAdminRepository(pool), []),
  new PostgresRateLimitStore(pool),
  credits,
  plans,
  undefined,
  async () => { await pool.query('SELECT 1') },
  cleanup,
  new PostgresGenerationRequestStore(pool),
  undefined,
  new PostgresOAuthStore(pool),
)
const server = createServer(app)
server.keepAliveTimeout = 75_000
server.headersTimeout = 76_000

// Độ trễ vòng lặp sự kiện: chỉ số cho biết CPU đã bão hoà chưa.
let lagMax = 0
let lagSum = 0
let lagCount = 0
let last = performance.now()
setInterval(() => {
  const now = performance.now()
  const lag = Math.max(0, now - last - 100)
  lagMax = Math.max(lagMax, lag)
  lagSum += lag
  lagCount += 1
  last = now
}, 100).unref()
setInterval(() => {
  const memory = process.memoryUsage()
  console.log(JSON.stringify({
    type: 'loadtest_stats',
    rssMb: Math.round(memory.rss / 1e6),
    heapMb: Math.round(memory.heapUsed / 1e6),
    lagAvgMs: lagCount ? Math.round(lagSum / lagCount) : 0,
    lagMaxMs: Math.round(lagMax),
  }))
  lagMax = 0
  lagSum = 0
  lagCount = 0
}, 5_000).unref()

server.listen(port, '127.0.0.1', () => console.log(`[loadtest] listening on ${port}, AI delay ${aiDelayMs}ms`))
process.on('SIGTERM', () => process.exit(0))
