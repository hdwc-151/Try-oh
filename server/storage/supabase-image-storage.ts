import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { ImageStorage, StoredImage } from './image-storage.js'
import { optimizeImageForStorage } from './optimize-image.js'

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
}
export type SupabaseImageStorageOptions = {
  url: string; secretKey: string; bucket?: string; prefix?: string
}

/** The API checks ownership before issuing a short-lived private object URL. */
export class SupabaseImageStorage implements ImageStorage {
  private readonly client
  private readonly bucket: string
  private readonly prefix: string

  constructor(options: SupabaseImageStorageOptions) {
    if (!options.url || !options.secretKey) throw new Error('Supabase Storage requires a server URL and secret key.')
    this.bucket = options.bucket ?? 'tryoh-private'
    this.prefix = options.prefix ?? 'production'
    if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(this.bucket)) throw new Error('Invalid Supabase Storage bucket name.')
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(this.prefix)) throw new Error('Invalid Supabase Storage prefix.')
    this.client = createClient(options.url, options.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, init) => fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
            : AbortSignal.timeout(30_000),
        }),
      },
    })
  }

  async ensureReady(): Promise<void> {
    let result = await this.client.storage.getBucket(this.bucket)
    if (result.error) {
      const missing = String(result.error.statusCode) === '404' || result.error.message.toLowerCase() === 'bucket not found'
      if (!missing) throw new Error('Could not inspect the private image bucket. Check the Supabase server key.')
      const created = await this.client.storage.createBucket(this.bucket, {
        public: false, fileSizeLimit: MAX_IMAGE_BYTES, allowedMimeTypes: Object.keys(MIME_EXTENSIONS),
      })
      // A rolling deploy may race another instance creating the same bucket.
      if (created.error && !['409', '400'].includes(String(created.error.statusCode))) {
        throw new Error('Could not create the private image bucket.')
      }
      result = await this.client.storage.getBucket(this.bucket)
    }
    if (result.error || !result.data) throw new Error('The private image bucket is not ready.')
    if (result.data.public) throw new Error('Refusing to store user images in a public bucket.')
  }

  async save(buffer: Buffer, mimeType: string): Promise<string> {
    const image = await optimizeImageForStorage(buffer, mimeType)
    const extension = MIME_EXTENSIONS[image.mimeType]
    if (!extension || image.buffer.length > MAX_IMAGE_BYTES) throw new Error('Unsupported image or image exceeds 8 MB.')
    const key = this.prefix + '_' + randomUUID() + extension
    const { error } = await this.client.storage.from(this.bucket).upload(key, image.buffer, {
      contentType: image.mimeType, cacheControl: '300', upsert: false,
    })
    if (error) throw new Error('Could not upload the image to private storage.')
    return key
  }

  async read(key: string): Promise<StoredImage> {
    this.assertKey(key)
    const { data, error } = await this.client.storage.from(this.bucket).download(key)
    if (error || !data) throw new Error('Could not read the private image.')
    return { buffer: Buffer.from(await data.arrayBuffer()), mimeType: data.type || 'application/octet-stream' }
  }

  async createReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    this.assertKey(key)
    const expiresIn = Number.isFinite(expiresInSeconds)
      ? Math.min(3_600, Math.max(60, Math.trunc(expiresInSeconds))) : 300
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, expiresIn)
    if (error || !data?.signedUrl) throw new Error('Could not sign the private image URL.')
    return data.signedUrl
  }

  isDirectReadReady(): boolean { return true }

  async delete(key: string): Promise<void> {
    this.assertKey(key)
    const { error } = await this.client.storage.from(this.bucket).remove([key])
    if (error) throw new Error('Could not delete the private image.')
  }

  publicUrl(key: string): string {
    this.assertKey(key)
    return '/uploads/' + encodeURIComponent(key)
  }

  private assertKey(key: string): void {
    if (!key.startsWith(this.prefix + '_') || key.length > 160 || !/^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(key)) {
      throw new Error('Invalid private image key.')
    }
  }
}
