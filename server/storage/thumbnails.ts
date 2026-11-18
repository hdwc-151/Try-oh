import sharp from 'sharp'
import type { ImageStorage } from './image-storage.js'

/** Chiều rộng ảnh thu nhỏ được phép xin qua `/uploads/:key?w=`. */
export const THUMBNAIL_WIDTHS = [160, 320, 640] as const
export type ThumbnailWidth = (typeof THUMBNAIL_WIDTHS)[number]

export const isThumbnailWidth = (value: unknown): value is ThumbnailWidth =>
  THUMBNAIL_WIDTHS.includes(Number(value) as ThumbnailWidth)

/** Khoá ảnh thu nhỏ suy ra từ khoá gốc, nên không cần thêm cột nào trong database. */
export const thumbnailKey = (key: string, width: ThumbnailWidth) =>
  `${key.replace(/\.[a-z0-9]+$/i, '')}__w${width}.webp`

export const isThumbnailKey = (key: string) => /__w\d+\.webp$/.test(key)

/** Mọi biến thể thu nhỏ có thể có của một ảnh gốc (để xoá kèm khi xoá ảnh gốc). */
export const thumbnailKeysOf = (key: string) => (isThumbnailKey(key) ? [] : THUMBNAIL_WIDTHS.map(width => thumbnailKey(key, width)))

/**
 * Ảnh thu nhỏ WebP tạo lần đầu có người xem rồi lưu cạnh ảnh gốc. Màn lưới (tủ đồ, outfit)
 * tải ảnh vài chục KB thay vì ảnh gốc hàng trăm KB. Giới hạn số ảnh resize cùng lúc để
 * một trang đầy thumbnail không chiếm hết CPU của máy chủ nhỏ.
 */
export class ThumbnailService {
  private readonly known = new Set<string>()
  private readonly inflight = new Map<string, Promise<string>>()
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(
    private readonly images: ImageStorage,
    private readonly maxConcurrent = 2,
    private readonly maxKnown = 50_000,
    private readonly maxQueued = 300,
  ) {}

  get supported() {
    return Boolean(this.images.saveWithKey && this.images.exists)
  }

  /** Trả khoá ảnh thu nhỏ, tạo nếu chưa có. Lỗi (ảnh gốc hỏng, storage lỗi) thì ném ra để nơi gọi dùng ảnh gốc. */
  ensure(key: string, width: ThumbnailWidth): Promise<string> {
    const target = thumbnailKey(key, width)
    if (this.known.has(target)) return Promise.resolve(target)
    const pending = this.inflight.get(target)
    if (pending) return pending
    const job = this.create(key, target, width).finally(() => this.inflight.delete(target))
    this.inflight.set(target, job)
    return job
  }

  /**
   * Như `ensure` nhưng không bắt người xem chờ lâu: nếu ảnh thu nhỏ chưa xong trong `waitMs`
   * (lúc nhiều người mở tủ đồ cùng lúc, hàng resize dài) thì trả `null` để nơi gọi gửi ảnh gốc,
   * còn việc tạo vẫn chạy tiếp ở nền cho lần xem sau. Hàng chờ quá dài thì không xếp thêm.
   */
  async ensureWithin(key: string, width: ThumbnailWidth, waitMs: number): Promise<string | null> {
    const target = thumbnailKey(key, width)
    if (this.known.has(target)) return target
    if (!this.inflight.has(target) && this.active >= this.maxConcurrent && this.waiting.length >= this.maxQueued) return null
    const job = this.ensure(key, width)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), waitMs) })
    // Lỗi của việc chạy nền đã được nơi gọi `ensure` đầu tiên xử lý; ở đây chỉ chặn unhandled rejection.
    job.catch(() => undefined)
    try {
      return await Promise.race([job, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  private async create(key: string, target: string, width: ThumbnailWidth): Promise<string> {
    if (!this.images.saveWithKey || !this.images.exists) throw new Error('Storage không hỗ trợ ảnh thu nhỏ.')
    if (!(await this.images.exists(target))) {
      await this.acquire()
      try {
        const original = await this.images.read(key)
        const buffer = await sharp(original.buffer, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 74, alphaQuality: 80, effort: 3 })
          .toBuffer()
        await this.images.saveWithKey(target, buffer, 'image/webp')
      } finally {
        this.release()
      }
    }
    if (this.known.size >= this.maxKnown) this.known.delete(this.known.values().next().value as string)
    this.known.add(target)
    return target
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise(resolve => this.waiting.push(() => { this.active += 1; resolve() }))
  }

  private release() {
    this.active -= 1
    this.waiting.shift()?.()
  }
}

/** Cỡ được xin nhiều nhất (lưới tủ đồ, outfit, kết quả): tạo sẵn ngay khi ảnh được lưu. */
export const WARM_THUMBNAIL_WIDTH: ThumbnailWidth = 320

/**
 * Bọc storage để mỗi ảnh vừa lưu được tạo sẵn ảnh thu nhỏ 320px ở nền.
 * Đo tải cho thấy tạo thumbnail lúc có người xem lần đầu tốn ~40 ms CPU mỗi ảnh; trên 0.1 CPU
 * cả trăm ảnh "lạnh" cùng lúc làm chậm mọi API khác. Lúc tải lên thì lượng ảnh rải đều hơn nhiều.
 */
export function withThumbnailWarmup(storage: ImageStorage, service = new ThumbnailService(storage, 1)): ImageStorage {
  if (!storage.saveWithKey || !storage.exists) return storage
  const save: ImageStorage['save'] = async (buffer, mimeType) => {
    const key = await storage.save(buffer, mimeType)
    if (mimeType.startsWith('image/') && !isThumbnailKey(key)) {
      service.ensure(key, WARM_THUMBNAIL_WIDTH).catch((error: unknown) => {
        console.warn('[thumbnail] warmup failed:', error instanceof Error ? error.message : 'Unknown error')
      })
    }
    return key
  }
  return new Proxy(storage, {
    get(target, property, receiver) {
      if (property === 'save') return save
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
