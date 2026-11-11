import multer from 'multer'
import sharp from 'sharp'

export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_IMAGE_PIXELS = 24_000_000

export const createImageUpload = (files: number) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE, files },
  fileFilter: (_request, file, callback) => {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) callback(null, true)
    else callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname))
  },
})

export const validateImageContent = async (
  file: Express.Multer.File,
  options?: { maxDimension?: number },
) => {
  const metadata = await sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
  const mimeType = metadata.format === 'jpeg'
    ? 'image/jpeg'
    : metadata.format === 'png'
      ? 'image/png'
      : metadata.format === 'webp'
        ? 'image/webp'
        : null
  if (!mimeType || mimeType !== file.mimetype || !metadata.width || !metadata.height) {
    throw new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname)
  }
  if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
    throw new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname)
  }
  if (options?.maxDimension && Math.max(metadata.width, metadata.height) > options.maxDimension) {
    throw new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname)
  }
  return { width: metadata.width, height: metadata.height, mimeType }
}
