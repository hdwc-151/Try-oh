import { normalize } from '../core/pipeline'
import type { Category, Config, ScaleMode } from '../types'

interface WorkerRequest {
  type: 'NORMALIZE'
  id: string
  buffer: ArrayBuffer
  width: number
  height: number
  category: Category
  config?: Partial<Config>
  scaleMode?: ScaleMode
  sizeCm?: number
  manualRotationDeg?: number
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const {
    id,
    buffer,
    width,
    height,
    category,
    config,
    scaleMode,
    sizeCm,
    manualRotationDeg,
  } = event.data

  try {
    const data = new Uint8ClampedArray(buffer)
    const result = normalize(
      { data, width, height },
      category,
      config,
      scaleMode,
      sizeCm,
      manualRotationDeg,
    )

    // Transfer buffers back with zero-copy
    const returnImageBuffer = result.image.data.buffer
    const returnMaskBuffer = result.mask.buffer

    ;(self as unknown as { postMessage: (msg: unknown, transfer?: Transferable[]) => void }).postMessage(
      {
        type: 'SUCCESS',
        id,
        image: {
          buffer: returnImageBuffer,
          width: result.image.width,
          height: result.image.height,
        },
        maskBuffer: returnMaskBuffer,
        meta: result.meta,
      },
      [returnImageBuffer, returnMaskBuffer],
    )
  } catch (error) {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage({
      type: 'ERROR',
      id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
