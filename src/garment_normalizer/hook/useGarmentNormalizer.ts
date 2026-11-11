import { useCallback, useEffect, useRef, useState } from 'react'
import type { NormalizedGarment, NormalizeOptions } from '../types'
import { normalizeBlob, workerClient } from '../io/worker-client'

export interface UseGarmentNormalizerReturn {
  run: (blob: Blob, options: NormalizeOptions) => Promise<NormalizedGarment | null>
  status: 'idle' | 'loading' | 'success' | 'error'
  progress: number
  result: NormalizedGarment | null
  error: string | null
  cancel: () => void
  reset: () => void
}

/**
 * React hook for running garment normalization in a Web Worker without freezing the main thread.
 * Supports progress tracking and cancellation.
 */
export function useGarmentNormalizer(): UseGarmentNormalizerReturn {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<NormalizedGarment | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeRequestId = useRef(0)

  const cancel = useCallback(() => {
    activeRequestId.current++
    workerClient.terminate()
    setStatus('idle')
    setProgress(0)
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setProgress(0)
    setResult(null)
    setError(null)
  }, [])

  const run = useCallback(
    async (blob: Blob, options: NormalizeOptions): Promise<NormalizedGarment | null> => {
      const currentId = ++activeRequestId.current
      setStatus('loading')
      setProgress(10)
      setError(null)

      try {
        setProgress(30)
        const output = await normalizeBlob(blob, options)

        if (activeRequestId.current !== currentId) {
          return null // Request was cancelled or superseded
        }

        setProgress(100)
        setResult(output)
        setStatus('success')
        return output
      } catch (err) {
        if (activeRequestId.current !== currentId) {
          return null
        }
        const errorMsg = err instanceof Error ? err.message : 'Chuẩn hoá trang phục thất bại'
        setError(errorMsg)
        setStatus('error')
        return null
      }
    },
    [],
  )

  useEffect(() => {
    return () => {
      activeRequestId.current++
      workerClient.terminate()
    }
  }, [])

  return {
    run,
    status,
    progress,
    result,
    error,
    cancel,
    reset,
  }
}
