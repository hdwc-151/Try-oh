import type { PostgresPool } from '../storage/postgres.js'
import { isSubscriptionPlanId } from './catalog.js'
import type { PlanRepository } from './plan-repository.js'
import type { SubscriptionPlanId } from './types.js'

export class PostgresPlanRepository implements PlanRepository {
  constructor(private readonly pool: PostgresPool) {}
  async getPlan(userId: string): Promise<SubscriptionPlanId | null> {
    // Expiry zeroes the remaining paid credits; the removal is written to the ledger
    // in the same statement so balances stay reconstructible from ledger entries.
    const result = await this.pool.query<{ subscription_plan: string }>(`WITH previous AS (
      SELECT id, credit_balance FROM profiles
      WHERE id=$1 AND subscription_expires_at IS NOT NULL AND subscription_expires_at<=now()
      FOR UPDATE
    ), expired AS (
      UPDATE profiles p
      SET subscription_plan='free',credit_balance=0,subscription_expires_at=NULL
      FROM previous
      WHERE p.id=previous.id
      RETURNING p.subscription_plan
    ), ledger AS (
      INSERT INTO credit_ledger(user_id,delta,balance_after,event_type)
      SELECT id,-credit_balance,0,'subscription_expired' FROM previous WHERE credit_balance>0
    )
    SELECT subscription_plan FROM expired
    UNION ALL
    SELECT subscription_plan FROM profiles WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM expired)
    LIMIT 1`, [userId])
    const value = result.rows[0]?.subscription_plan
    return isSubscriptionPlanId(value) ? value : null
  }
  async close(): Promise<void> {}
}
