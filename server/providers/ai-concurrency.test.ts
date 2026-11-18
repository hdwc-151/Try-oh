import { describe, expect, it } from 'vitest'
import { AiQueueBusyError, AsyncSemaphore } from './ai-concurrency.js'

describe('AsyncSemaphore', () => {
  it('bounds the waiting queue and releases the next request', async () => {
    const semaphore = new AsyncSemaphore(1, { maxWaiting: 1, waitTimeoutMs: 1_000 })
    let releaseFirst!: () => void
    const first = semaphore.run(() => new Promise<void>((resolve) => { releaseFirst = resolve }))
    const second = semaphore.run(async () => 'second')

    await expect(semaphore.run(async () => 'third')).rejects.toBeInstanceOf(AiQueueBusyError)
    releaseFirst()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBe('second')
  })

  it('times out queued work instead of waiting forever', async () => {
    const semaphore = new AsyncSemaphore(1, { maxWaiting: 1, waitTimeoutMs: 10 })
    let releaseFirst!: () => void
    const first = semaphore.run(() => new Promise<void>((resolve) => { releaseFirst = resolve }))
    await expect(semaphore.run(async () => 'late')).rejects.toMatchObject({ name: 'AiQueueBusyError' })
    releaseFirst()
    await first
  })
})

