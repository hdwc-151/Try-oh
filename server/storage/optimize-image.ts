import sharp from 'sharp'

export type PreparedImage = {
  buffer: Buffer
  mimeType: string
}

const MAX_INPUT_PIXELS = 24_000_000
const MAX_STORED_EDGE = 2_048

export async function optimizeImageForStorage(buffer: Buffer, mimeType: string): Promise<PreparedImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) return { buffer, mimeType }

  const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
  const metadata = await image.metadata()
  const webp = await image
    .rotate()
    .resize({ width: MAX_STORED_EDGE, height: MAX_STORED_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({
    quality: metadata.hasAlpha ? 92 : 86,
    alphaQuality: 100,
    nearLossless: Boolean(metadata.hasAlpha),
    smartSubsample: true,
    effort: 4,
    })
    .toBuffer()

  return { buffer: webp, mimeType: 'image/webp' }
}
