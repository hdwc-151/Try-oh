export type StoredImage = {
  buffer: Buffer
  mimeType: string
}

export type StoredImageStream = {
  body: AsyncIterable<Uint8Array>
  mimeType: string
  contentLength?: number
}

export interface ImageStorage {
  save(buffer: Buffer, mimeType: string): Promise<string>
  read(key: string): Promise<StoredImage>
  openStream?(key: string): Promise<StoredImageStream>
  createReadUrl?(key: string, expiresInSeconds: number): Promise<string>
  isDirectReadReady?(): boolean
  /** Lưu đúng khoá cho trước (ảnh thu nhỏ suy ra từ khoá gốc); không tối ưu lại ảnh. */
  saveWithKey?(key: string, buffer: Buffer, mimeType: string): Promise<void>
  exists?(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  publicUrl(key: string): string
}
