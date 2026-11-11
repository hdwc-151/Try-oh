import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ImageStorage } from './image-storage.js'
import { optimizeImageForStorage } from './optimize-image.js'

const extensionByMimeType: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

const mimeTypeByExtension = Object.fromEntries(
  Object.entries(extensionByMimeType).map(([mimeType, extension]) => [extension, mimeType]),
) as Record<string, string>

export class LocalImageStorage implements ImageStorage {
  constructor(private readonly uploadDirectory: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.uploadDirectory, { recursive: true })
  }

  async save(buffer: Buffer, mimeType: string): Promise<string> {
    const prepared = await optimizeImageForStorage(buffer, mimeType)
    const extension = extensionByMimeType[prepared.mimeType]
    if (!extension) {
      throw new Error('Định dạng ảnh không được hỗ trợ.')
    }
    const key = `${randomUUID()}${extension}`
    await writeFile(path.join(this.uploadDirectory, key), prepared.buffer)
    return key
  }

  async read(key: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const safeKey = path.basename(key)
    if (!key || safeKey !== key) {
      throw new Error('Khoá ảnh không hợp lệ.')
    }
    const mimeType = mimeTypeByExtension[path.extname(safeKey).toLowerCase()]
    if (!mimeType) {
      throw new Error('Định dạng ảnh không được hỗ trợ.')
    }
    return {
      buffer: await readFile(path.join(this.uploadDirectory, safeKey)),
      mimeType,
    }
  }

  async openStream(key: string) {
    const safeKey = path.basename(key)
    if (!key || safeKey !== key) throw new Error('Khoá ảnh không hợp lệ.')
    const mimeType = mimeTypeByExtension[path.extname(safeKey).toLowerCase()]
    if (!mimeType) throw new Error('Định dạng ảnh không được hỗ trợ.')
    const filePath = path.join(this.uploadDirectory, safeKey)
    const metadata = await stat(filePath)
    return { body: createReadStream(filePath), mimeType, contentLength: metadata.size }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(path.join(this.uploadDirectory, path.basename(key)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  publicUrl(key: string): string {
    return `/uploads/${encodeURIComponent(path.basename(key))}`
  }
}
