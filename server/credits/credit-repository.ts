import type { MaybePromise } from '../storage/maybe-promise.js'

export interface CreditRepository {
  getBalance(userId: string): MaybePromise<number | null>
  tryConsume(userId: string, amount: number): MaybePromise<number | null>
  refund(userId: string, amount: number): MaybePromise<number | null>
  close(): MaybePromise<void>
}
