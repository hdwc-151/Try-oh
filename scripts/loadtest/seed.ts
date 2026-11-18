/**
 * Tạo dữ liệu cho đo tải: LOADTEST_USERS người dùng (mặc định 120) gói Pro, mỗi người có ảnh toàn
 * thân, 30 món đồ, 5 outfit đã lưu và 3 bạn bè. Ghi danh sách id vào LOADTEST_USERS_FILE.
 *
 *   DATABASE_URL=postgres://... DATA_DIR=/tmp/fitsy-load npx tsx scripts/loadtest/seed.ts
 */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { PostgresGarmentRepository } from '../../server/garments/postgres-garment-repository.js'
import { GARMENT_CATEGORIES } from '../../server/garments/garment.js'
import { LocalImageStorage } from '../../server/storage/local-image-storage.js'
import type { PostgresPool } from '../../server/storage/postgres.js'
import { PostgresUserDataRepository } from '../../server/user-data/postgres-user-data-repository.js'

const count = Number(process.env.LOADTEST_USERS ?? 120)
const garmentsPerUser = 30
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 }) as unknown as PostgresPool
const images = new LocalImageStorage(path.join(path.resolve(process.env.DATA_DIR ?? '/tmp/fitsy-load'), 'uploads'))
await images.ensureReady()
const garments = new PostgresGarmentRepository(pool)
const userData = new PostgresUserDataRepository(pool)

/** Ảnh có vân (không phải màu trơn) để kích thước file và chi phí resize gần với ảnh chụp thật. */
const texture = async (width: number, height: number, seed: number, alpha: boolean) => {
  const small = Buffer.alloc(Math.ceil(width / 4) * Math.ceil(height / 4) * 3)
  let value = seed * 2654435761
  for (let i = 0; i < small.length; i += 1) { value = (value * 1103515245 + 12345) >>> 0; small[i] = value >>> 24 }
  let image = sharp(small, { raw: { width: Math.ceil(width / 4), height: Math.ceil(height / 4), channels: 3 } }).resize(width, height).blur(1.2)
  if (alpha) {
    const mask = await sharp(Buffer.from(`<svg width="${width}" height="${height}"><ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.42}" ry="${height * 0.46}" fill="#fff"/></svg>`)).png().toBuffer()
    image = sharp(await image.png().toBuffer()).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }])
  }
  // Mã hoá sẵn như ảnh đã qua optimizeImageForStorage, rồi chép theo khoá mới cho từng người dùng.
  return image.webp({ quality: 80 }).toBuffer()
}

const garmentImages = await Promise.all(Array.from({ length: 6 }, (_, i) => texture(800, 1000, i + 1, true)))
const personImage = await texture(1000, 1500, 99, false)
const resultImage = await texture(768, 960, 77, false)

/** Mỗi người dùng một file riêng (để ảnh thu nhỏ không được dùng chung giữa các tài khoản). */
const store = async (buffer: Buffer) => {
  const key = `${randomUUID()}.webp`
  await images.saveWithKey(key, buffer, 'image/webp')
  return key
}

const ids: string[] = []
for (let u = 0; u < count; u += 1) {
  const id = randomUUID()
  ids.push(id)
  await pool.query('INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES($1, $2, $3)', [id, `load${u}@example.com`, JSON.stringify({ display_name: `Load ${u}` })])
  await pool.query("UPDATE profiles SET subscription_plan='pro', credit_balance=100000, subscription_expires_at=now() + interval '30 days' WHERE id=$1", [id])

  const personKey = await store(personImage)
  await userData.upsertPersonImage(id, { id: 'current', imageKey: personKey, width: 1000, height: 1500, warnings: [], createdAt: new Date().toISOString() })
  const garmentIds: string[] = []
  for (let g = 0; g < garmentsPerUser; g += 1) {
    const original = await store(garmentImages[(u + g) % garmentImages.length]!)
    const processed = await store(garmentImages[(u + g + 1) % garmentImages.length]!)
    const garmentId = randomUUID()
    garmentIds.push(garmentId)
    await garments.create({
      id: garmentId, userId: id, name: `Món ${g + 1}`, category: GARMENT_CATEGORIES[g % GARMENT_CATEGORIES.length]!,
      frontOriginalKey: original, frontProcessedKey: processed, backOriginalKey: null, backProcessedKey: null,
      createdAt: new Date(Date.now() - g * 86_400_000).toISOString(),
    })
  }
  for (let o = 0; o < 5; o += 1) {
    const key = await store(resultImage)
    await userData.saveOutfit(id, {
      id: randomUUID(), frontImageUrl: images.publicUrl(key), frontImageKey: key, backImageUrl: null, backImageKey: null,
      garmentIds: garmentIds.slice(o * 3, o * 3 + 3), createdAt: new Date(Date.now() - o * 3_600_000).toISOString(),
    })
  }
  if ((u + 1) % 20 === 0) console.log(`seeded ${u + 1}/${count}`)
}
for (let u = 0; u < ids.length; u += 1) {
  for (let step = 1; step <= 3; step += 1) {
    const [a, b] = [ids[u]!, ids[(u + step) % ids.length]!].sort()
    await pool.query('INSERT INTO friendships(user_a, user_b) VALUES($1, $2) ON CONFLICT DO NOTHING', [a, b])
  }
}
await writeFile(process.env.LOADTEST_USERS_FILE ?? '/tmp/fitsy-load/users.json', JSON.stringify(ids))
console.log(`done: ${ids.length} users`)
await (pool as unknown as pg.Pool).end()
