import sharp from 'sharp'

/**
 * Cấu hình libvips cho máy chủ ít RAM (Render free 512 MB).
 * - Tắt cache: mỗi ảnh tải lên đều khác nhau nên cache chỉ tốn RAM.
 * - Giới hạn luồng: mặc định libvips mở số luồng bằng số nhân CPU của máy chủ vật lý
 *   (Render báo cả chục nhân dù chỉ cấp 0.1 CPU); mỗi luồng giữ bộ đệm riêng nên RSS phình nhanh.
 */
export function configureSharp(env: NodeJS.ProcessEnv = process.env) {
  sharp.cache(false)
  const threads = Number(env.SHARP_CONCURRENCY ?? 1)
  sharp.concurrency(Number.isFinite(threads) && threads > 0 ? Math.floor(threads) : 1)
}
