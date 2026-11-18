import { normalize } from '../core/pipeline'
import { DEFAULT_CONFIG, type Config, type CoreNormalizeResult, type NormalizedGarment, type NormalizeOptions, type RGBAImage } from '../types'
import { exportNormalizedAssets } from './export'
import { loadBlobToRGBAImage } from './load'

class NormalizerWorkerClient {
  private worker: Worker | null = null
  private pending = new Map<
    string,
    {
      resolve: (res: CoreNormalizeResult) => void
      reject: (err: Error) => void
    }
  >()
  private counter = 0

  private getWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null
    if (!this.worker) {
      try {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
          type: 'module',
        })
        this.worker.onmessage = (event) => {
          const { type, id, image, maskBuffer, meta, error } = event.data
          const handler = this.pending.get(id)
          if (!handler) return
          this.pending.delete(id)

          if (type === 'SUCCESS') {
            handler.resolve({
              image: {
                data: new Uint8ClampedArray(image.buffer),
                width: image.width,
                height: image.height,
              },
              mask: new Uint8Array(maskBuffer),
              meta,
            })
          } else {
            handler.reject(new Error(error || 'Worker normalization failed'))
          }
        }
        this.worker.onerror = (err) => {
          console.error('Normalizer worker error:', err)
        }
      } catch {
        this.worker = null
      }
    }
    return this.worker
  }

  public async run(
    image: RGBAImage,
    options: NormalizeOptions,
  ): Promise<CoreNormalizeResult> {
    const worker = this.getWorker()

    // Fallback directly to core pipeline if Worker is unavailable (e.g. testing in Node)
    if (!worker) {
      return normalize(
        image,
        options.category,
        options.config,
        options.scaleMode,
        options.sizeCm,
        options.manualRotationDeg,
      )
    }

    const id = `req_${Date.now()}_${++this.counter}`
    const buffer = image.data.buffer

    return new Promise<CoreNormalizeResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage(
        {
          type: 'NORMALIZE',
          id,
          buffer,
          width: image.width,
          height: image.height,
          category: options.category,
          config: options.config,
          scaleMode: options.scaleMode,
          sizeCm: options.sizeCm,
          manualRotationDeg: options.manualRotationDeg,
        },
        [buffer], // Zero-copy transfer
      )
    })
  }

  public terminate(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    for (const [, handler] of this.pending) {
      handler.reject(new Error('Normalizer worker terminated'))
    }
    this.pending.clear()
  }
}

export const workerClient = new NormalizerWorkerClient()

/**
 * Top-level normalization function accepting a raw image Blob/File.
 * 1. Loads image with EXIF orientation & downscales if needed.
 * 2. Processes via Web Worker (transferable buffers).
 * 3. Exports standard output assets (item.png, itemFlat.png, mask.png, thumb.webp, meta).
 */
export async function normalizeBlob(
  blob: Blob,
  options: NormalizeOptions,
): Promise<NormalizedGarment> {
  const config: Config = { ...DEFAULT_CONFIG, ...options.config }
  const rgbaImage = await loadBlobToRGBAImage(blob, config.maxInputPx)
  const coreResult = await workerClient.run(rgbaImage, options)
  return exportNormalizedAssets(coreResult.image, coreResult.meta, config)
}
