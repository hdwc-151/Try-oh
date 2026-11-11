import { createHash } from 'node:crypto'
import sharp from 'sharp'

export type EncodedReference = Readonly<{ data: string; mimeType: string }>
type Entry = { value: EncodedReference; bytes: number; timer: NodeJS.Timeout }

/** Caches preprocessing, never AI outputs. Callers still read authorized input. */
export class ReferenceImageEncoder {
  private readonly cache = new Map<string, Entry>()
  private readonly pending = new Map<string, Promise<EncodedReference>>()
  private bytes = 0
  private epoch = 0
  constructor(private readonly maxBytes = 16 * 1024 * 1024, private readonly ttlMs = 300_000) {}

  async encode(buffer: Buffer): Promise<EncodedReference> {
    const key = createHash('sha256').update(buffer).digest('hex')
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached.value
    }
    const existing = this.pending.get(key)
    if (existing) return existing
    const epoch = this.epoch
    const operation = async () => {
      const prepared = await sharp(buffer, { limitInputPixels: 24_000_000 })
        .rotate()
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86, effort: 3 })
        .toBuffer()
      const value = Object.freeze({ data: prepared.toString('base64'), mimeType: 'image/webp' })
      const bytes = value.data.length
      if (bytes <= this.maxBytes && this.epoch === epoch) {
        while (this.bytes + bytes > this.maxBytes || this.cache.size >= 128) {
          const oldest = this.cache.keys().next().value
          if (oldest === undefined) break
          this.remove(oldest)
        }
        const timer = setTimeout(() => this.remove(key), this.ttlMs)
        timer.unref()
        this.cache.set(key, { value, bytes, timer })
        this.bytes += bytes
      }
      return value
    }
    const result = operation()
    this.pending.set(key, result)
    try { return await result }
    finally { if (this.pending.get(key) === result) this.pending.delete(key) }
  }

  clear() {
    this.epoch += 1
    for (const entry of this.cache.values()) clearTimeout(entry.timer)
    this.cache.clear()
    this.pending.clear()
    this.bytes = 0
  }
  private remove(key: string) {
    const entry = this.cache.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    this.cache.delete(key)
    this.bytes -= entry.bytes
  }
}
