import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, GetBucketCorsCommand, GetObjectCommand, PutBucketCorsCommand, PutObjectCommand, S3Client, type CORSRule } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ImageStorage, StoredImage } from './image-storage.js'
import { optimizeImageForStorage } from './optimize-image.js'

const extensionByMimeType: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

export type R2ImageStorageOptions = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  prefix?: string
}

export class R2ImageStorage implements ImageStorage {
  private readonly client: S3Client
  private readonly prefix: string
  // Signed redirects work for normal <img> traffic without bucket CORS.
  // Browser-side pixel processing explicitly requests the same-origin proxy.
  private directReadReady = true

  constructor(private readonly options: R2ImageStorageOptions) {
    for (const [name, value] of Object.entries(options)) {
      if (name !== 'prefix' && !value) throw new Error(`Thiếu cấu hình R2: ${name}`)
    }
    this.prefix = options.prefix?.replace(/[^a-zA-Z0-9_-]/g, '') || 'uploads'
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      // Fail (and let the SDK retry) instead of leaving an upload or delete hanging
      // on a stalled connection.
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    })
  }

  async save(buffer: Buffer, mimeType: string): Promise<string> {
    const prepared = await optimizeImageForStorage(buffer, mimeType)
    const extension = extensionByMimeType[prepared.mimeType]
    if (!extension) throw new Error('Định dạng ảnh không được hỗ trợ.')
    const key = `${this.prefix}_${randomUUID()}${extension}`
    await this.client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: key,
      Body: prepared.buffer,
      ContentType: prepared.mimeType,
      CacheControl: 'private, max-age=86400, immutable',
    }))
    return key
  }

  async read(key: string): Promise<StoredImage> {
    this.assertKey(key)
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }))
    if (!object.Body) throw new Error('Ảnh không tồn tại.')
    return {
      buffer: Buffer.from(await object.Body.transformToByteArray()),
      mimeType: object.ContentType ?? 'application/octet-stream',
    }
  }

  async openStream(key: string) {
    this.assertKey(key)
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }))
    if (!object.Body) throw new Error('Ảnh không tồn tại.')
    return {
      body: object.Body as AsyncIterable<Uint8Array>,
      mimeType: object.ContentType ?? 'application/octet-stream',
      contentLength: object.ContentLength,
    }
  }

  async createReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    this.assertKey(key)
    const expiresIn = Math.min(3_600, Math.max(60, Math.trunc(expiresInSeconds)))
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
      }),
      { expiresIn },
    )
  }

  isDirectReadReady(): boolean {
    return this.directReadReady
  }

  async configureBrowserCors(origins: string[]): Promise<void> {
    const allowedOrigins = [...new Set(origins.map(origin => origin.trim()).filter(Boolean))]
    if (!allowedOrigins.length) throw new Error('Không có web origin hợp lệ để cấu hình R2 CORS.')

    let existingRules: CORSRule[] = []
    try {
      const current = await this.client.send(new GetBucketCorsCommand({ Bucket: this.options.bucket }))
      existingRules = current.CORSRules ?? []
    } catch (error) {
      const detail = error as { name?: string; $metadata?: { httpStatusCode?: number } }
      const missing = detail.name === 'NoSuchCORSConfiguration' || detail.$metadata?.httpStatusCode === 404
      if (!missing) throw error
    }

    const supportsOrigin = (origin: string) => existingRules.some(rule =>
      rule.AllowedMethods?.includes('GET') && rule.AllowedOrigins?.some(value => value === '*' || value === origin),
    )
    if (!allowedOrigins.every(supportsOrigin)) {
      await this.client.send(new PutBucketCorsCommand({
        Bucket: this.options.bucket,
        CORSConfiguration: {
          CORSRules: [
            ...existingRules,
            {
              AllowedOrigins: allowedOrigins,
              AllowedMethods: ['GET', 'HEAD'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['Content-Length', 'Content-Type', 'ETag'],
              MaxAgeSeconds: 3_600,
            },
          ],
        },
      }))
    }
    this.directReadReady = true
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key)
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }))
  }

  publicUrl(key: string): string {
    this.assertKey(key)
    return `/uploads/${encodeURIComponent(key)}`
  }

  private assertKey(key: string): void {
    if (!key || key.includes('/') || key.includes('..') || !key.startsWith(`${this.prefix}_`)) {
      throw new Error('Khoá ảnh không hợp lệ.')
    }
  }
}
