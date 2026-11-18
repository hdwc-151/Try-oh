/**
 * Ảnh thu nhỏ do máy chủ tạo sẵn (`/uploads/:key?w=`), dùng cho các màn lưới: tải vài chục KB
 * thay vì ảnh gốc. Chỉ áp cho ảnh của Try-oh; ảnh ngoài (data:, blob:, http) giữ nguyên.
 */
export type ThumbnailWidth = 160 | 320 | 640

export function thumbnailUrl(url: string | null | undefined, width: ThumbnailWidth): string {
  if (!url) return ''
  if (!url.startsWith('/uploads/') || url.includes('?')) return url
  return `${url}?w=${width}`
}

/** `src` + `srcSet` để trình duyệt tự chọn 320 hay 640 theo kích thước hiển thị và mật độ điểm ảnh. */
export function thumbnailProps(url: string | null | undefined, sizes = '(min-width: 1024px) 220px, 45vw') {
  if (!url || !url.startsWith('/uploads/') || url.includes('?')) return { src: url ?? '' }
  return { src: thumbnailUrl(url, 320), srcSet: `${thumbnailUrl(url, 320)} 320w, ${thumbnailUrl(url, 640)} 640w`, sizes }
}
