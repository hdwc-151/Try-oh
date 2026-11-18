import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GarmentRecord } from './garment.js'
import { SqliteGarmentRepository } from './sqlite-garment-repository.js'

const garment: GarmentRecord = {
  id: 'item-1',
  userId: 'user-1',
  name: 'Áo sơ mi',
  category: 'tops',
  frontOriginalKey: 'front.jpg',
  frontProcessedKey: 'front.png',
  backOriginalKey: null,
  backProcessedKey: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('SqliteGarmentRepository', () => {
  it('không tạo món mới khi tủ đồ đã chạm giới hạn', () => {
    const repository = new SqliteGarmentRepository(':memory:')
    const garment = (id: string): GarmentRecord => ({
      id,
      userId: 'user-limit',
      name: id,
      category: 'tops',
      frontOriginalKey: id + '-original',
      frontProcessedKey: id + '-processed',
      backOriginalKey: null,
      backProcessedKey: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(repository.createIfBelowLimit(garment('one'), 1)).not.toBeNull()
    expect(repository.createIfBelowLimit(garment('two'), 1)).toBeNull()
    expect(repository.list('user-limit')).toHaveLength(1)
    repository.close()
  })

  it('tạo, đọc và xóa món đồ', () => {
    const repository = new SqliteGarmentRepository(':memory:')
    repository.create(garment)
    expect(repository.list(garment.userId)).toEqual([garment])
    expect(repository.list('user-2')).toEqual([])
    expect(repository.findById(garment.userId, garment.id)).toEqual(garment)

    const updated = repository.update(garment.userId, garment.id, { name: 'Áo sơ mi mới', category: 'outerwear' })
    expect(updated?.name).toBe('Áo sơ mi mới')
    expect(updated?.category).toBe('outerwear')
    expect(repository.findById(garment.userId, garment.id)?.name).toBe('Áo sơ mi mới')

    expect(repository.delete('user-2', garment.id)).toBe(false)
    expect(repository.delete(garment.userId, garment.id)).toBe(true)
    expect(repository.findById(garment.userId, garment.id)).toBeNull()
    repository.close()
  })

  it('đếm và phân trang tủ đồ theo thứ tự mới nhất', () => {
    const repository = new SqliteGarmentRepository(':memory:')
    repository.create({ ...garment, id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })
    repository.create({ ...garment, id: 'new', createdAt: '2026-01-02T00:00:00.000Z' })
    expect(repository.count(garment.userId)).toBe(2)
    expect(repository.list(garment.userId, { limit: 1, offset: 0 }).map(item => item.id)).toEqual(['new'])
    expect(repository.list(garment.userId, { limit: 1, offset: 1 }).map(item => item.id)).toEqual(['old'])
    repository.close()
  })

  it('lưu được áo khoác như một nhóm riêng', () => {
    const repository = new SqliteGarmentRepository(':memory:')
    const outerwear = { ...garment, id: 'jacket-1', name: 'Áo khoác denim', category: 'outerwear' as const }
    repository.create(outerwear)
    expect(repository.findById(outerwear.userId, outerwear.id)).toEqual(outerwear)
    repository.close()
  })

  it('nâng cấp database cũ mà vẫn giữ nguyên tủ đồ', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fitting-room-garments-'))
    const databasePath = join(directory, 'garments.sqlite')
    const legacyDatabase = new Database(databasePath)
    legacyDatabase.exec([
      "CREATE TABLE garments (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('tops', 'bottoms', 'shoes', 'accessories')), front_original_key TEXT NOT NULL, front_processed_key TEXT NOT NULL, back_original_key TEXT, back_processed_key TEXT, created_at TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT 'legacy')",
      "INSERT INTO garments (id, name, category, front_original_key, front_processed_key, created_at, user_id) VALUES ('legacy-shirt', 'Áo cũ', 'tops', 'old.jpg', 'old.png', '2026-01-01T00:00:00.000Z', 'user-1')",
    ].join(';'))
    legacyDatabase.close()

    const repository = new SqliteGarmentRepository(databasePath)
    try {
      expect(repository.findById('user-1', 'legacy-shirt')?.name).toBe('Áo cũ')
      repository.create({ ...garment, id: 'new-jacket', category: 'outerwear' })
      expect(repository.findById(garment.userId, 'new-jacket')?.category).toBe('outerwear')
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
