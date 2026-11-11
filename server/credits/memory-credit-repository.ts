import type { CreditRepository } from './credit-repository.js'
import { DEFAULT_IMAGE_CREDITS } from './types.js'

export class MemoryCreditRepository implements CreditRepository {
  private readonly balances = new Map<string, number>()

  getBalance(userId: string): number {
    return this.balances.get(userId) ?? DEFAULT_IMAGE_CREDITS
  }

  tryConsume(userId: string, amount: number): number | null {
    const current = this.getBalance(userId)
    if (current < amount) return null
    const next = current - amount
    this.balances.set(userId, next)
    return next
  }

  refund(userId: string, amount: number): number {
    const next = this.getBalance(userId) + amount
    this.balances.set(userId, next)
    return next
  }

  close(): void {}
}
