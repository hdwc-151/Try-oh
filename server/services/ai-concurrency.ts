export class AiQueueBusyError extends Error {
  constructor(message = 'Hệ thống tạo ảnh đang bận. Vui lòng thử lại sau ít phút.') {
    super(message)
    this.name = 'AiQueueBusyError'
  }
}

type Waiter = { activate: () => void; timer: NodeJS.Timeout }

export class AsyncSemaphore {
  private active = 0
  private readonly waiting: Waiter[] = []

  constructor(
    private readonly limit: number,
    private readonly options: { maxWaiting?: number; waitTimeoutMs?: number } = {},
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('AI concurrency limit must be positive.')
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await operation()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    if (this.waiting.length >= (this.options.maxWaiting ?? 8)) {
      return Promise.reject(new AiQueueBusyError())
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        activate: () => {
          clearTimeout(waiter.timer)
          this.active += 1
          resolve()
        },
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(waiter)
          if (index >= 0) this.waiting.splice(index, 1)
          reject(new AiQueueBusyError('Yêu cầu tạo ảnh đã chờ quá lâu. Vui lòng thử lại.'))
        }, this.options.waitTimeoutMs ?? 30_000),
      }
      this.waiting.push(waiter)
    })
  }

  private release() {
    this.active -= 1
    this.waiting.shift()?.activate()
  }
}

const parsedLimit = Number(process.env.AI_MAX_CONCURRENCY ?? 1)
const parsedMaxWaiting = Number(process.env.AI_MAX_WAITING_REQUESTS ?? 8)
const parsedWaitTimeout = Number(process.env.AI_QUEUE_TIMEOUT_MS ?? 30_000)
export const aiImageSemaphore = new AsyncSemaphore(
  Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 1,
  {
    maxWaiting: Number.isInteger(parsedMaxWaiting) && parsedMaxWaiting >= 0 ? parsedMaxWaiting : 8,
    waitTimeoutMs: Number.isInteger(parsedWaitTimeout) && parsedWaitTimeout > 0 ? parsedWaitTimeout : 30_000,
  },
)
