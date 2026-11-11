export interface CanvasWrapper {
  canvas: OffscreenCanvas | HTMLCanvasElement
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  width: number
  height: number
  toBlob(type?: string, quality?: number): Promise<Blob>
}

/**
 * Creates a canvas wrapper using OffscreenCanvas if available, with HTMLCanvasElement fallback.
 */
export function createCanvas(width: number, height: number): CanvasWrapper {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
    if (!ctx) throw new Error('Could not create OffscreenCanvas 2D context')

    return {
      canvas,
      ctx,
      width,
      height,
      async toBlob(type = 'image/png', quality = 0.92): Promise<Blob> {
        return canvas.convertToBlob({ type, quality })
      },
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    if (!ctx) throw new Error('Could not create HTMLCanvasElement 2D context')

    return {
      canvas,
      ctx,
      width,
      height,
      toBlob(type = 'image/png', quality = 0.92): Promise<Blob> {
        return new Promise((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob)
              else reject(new Error('canvas.toBlob returned null'))
            },
            type,
            quality,
          )
        })
      },
    }
  }

  throw new Error('Canvas API is not available in the current runtime environment.')
}
