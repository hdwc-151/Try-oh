import type { PostgresPool } from '../storage/postgres.js'
import type { CreditRepository } from './credit-repository.js'

export class PostgresCreditRepository implements CreditRepository {
  constructor(private readonly pool: PostgresPool) {}

  async getBalance(userId: string): Promise<number | null> {
    const result = await this.pool.query<{ credit_balance: number }>(
      'SELECT credit_balance FROM profiles WHERE id = $1',
      [userId],
    )
    return result.rows[0]?.credit_balance ?? null
  }

  async tryConsume(userId: string, amount: number): Promise<number | null> {
    const result = await this.pool.query<{ credit_balance: number }>(
      `WITH changed AS (
         UPDATE profiles
         SET credit_balance = credit_balance - $2
         WHERE id = $1 AND credit_balance >= $2
         RETURNING credit_balance
       )
       INSERT INTO credit_ledger(user_id,delta,balance_after,event_type)
       SELECT $1,-$2,credit_balance,'generation_reserved' FROM changed
       RETURNING balance_after AS credit_balance`,
      [userId, amount],
    )
    return result.rows[0]?.credit_balance ?? null
  }

  async refund(userId: string, amount: number): Promise<number | null> {
    const result = await this.pool.query<{ credit_balance: number }>(
      `WITH changed AS (
         UPDATE profiles
         SET credit_balance = least(1000000, credit_balance + $2)
         WHERE id = $1
         RETURNING credit_balance
       )
       INSERT INTO credit_ledger(user_id,delta,balance_after,event_type)
       SELECT $1,$2,credit_balance,'generation_refunded' FROM changed
       RETURNING balance_after AS credit_balance`,
      [userId, amount],
    )
    return result.rows[0]?.credit_balance ?? null
  }

  async close(): Promise<void> {}
}
