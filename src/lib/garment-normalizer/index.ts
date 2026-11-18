/**
 * Garment Normalizer: chuẩn hoá ảnh món đồ đã tách nền (căn giữa, chỉnh nghiêng, đặt vào khung)
 * ngay trên trình duyệt, trong Web Worker. Ứng dụng chỉ cần `normalizeBlob`; các bước bên trong
 * nằm ở `core/` (thuật toán) và `io/` (đọc/ghi ảnh, worker).
 */
export * from './types'
export { normalizeBlob } from './io/worker-client'
