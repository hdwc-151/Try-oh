// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../__tests__/pglite-pool.js'
import { PostgresAdminRepository } from '../admin/postgres-admin-repository.js'
import { PostgresBillingRepository } from '../billing/postgres-billing-repository.js'
import { PostgresPlanRepository } from '../plans/postgres-plan-repository.js'
import { PostgresCreditRepository } from './postgres-credit-repository.js'

const USER = '00000000-0000-4000-8000-000000000001'
const ADMIN = '00000000-0000-4000-8000-0000000000aa'

const ledgerSum = async (test: TestDatabase, userId: string) =>
  (await test.db.query<{ sum: number | null }>('select sum(delta)::int as sum from credit_ledger where user_id=$1', [userId])).rows[0]?.sum ?? 0
const balance = async (test: TestDatabase, userId: string) =>
  (await test.db.query<{ credit_balance: number }>('select credit_balance from profiles where id=$1', [userId])).rows[0]!.credit_balance

describe('PostgreSQL credit ledger', () => {
  let test: TestDatabase
  beforeEach(async () => {
    test = await createTestDatabase()
    await test.createUser(USER, 'user@example.com')
    await test.createUser(ADMIN, 'admin@example.com')
  })
  afterEach(async () => { await test.close() })

  it('records every balance change so the ledger reconciles with the balance', async () => {
    const credits = new PostgresCreditRepository(test.pool)
    const admin = new PostgresAdminRepository(test.pool)
    const opening = await balance(test, USER)

    expect(await credits.tryConsume(USER, 3)).toBe(opening - 3)
    expect(await credits.refund(USER, 1)).toBe(opening - 2)
    expect(await credits.tryConsume(USER, 1_000)).toBeNull()

    const adjusted = await admin.updateUser(USER, { creditBalance: 25 }, ADMIN)
    expect(adjusted?.creditBalance).toBe(25)
    const entry = (await test.db.query<{ delta: number; event_type: string; actor_id: string }>(
      "select delta,event_type,actor_id from credit_ledger where user_id=$1 and event_type='admin_adjustment'", [USER])).rows[0]
    expect(entry).toEqual({ delta: 25 - (opening - 2), event_type: 'admin_adjustment', actor_id: ADMIN })

    // Changing only the role must not add a ledger row.
    await admin.updateUser(USER, { role: 'koc' }, ADMIN)
    expect(opening + await ledgerSum(test, USER)).toBe(await balance(test, USER))
  })

  it('writes the removed credits to the ledger when a subscription expires', async () => {
    const plans = new PostgresPlanRepository(test.pool)
    await test.db.query("update profiles set subscription_plan='pro', credit_balance=42, subscription_expires_at=now()-interval '1 minute' where id=$1", [USER])

    expect(await plans.getPlan(USER)).toBe('free')
    expect(await balance(test, USER)).toBe(0)
    const rows = (await test.db.query<{ delta: number; event_type: string }>('select delta,event_type from credit_ledger where user_id=$1', [USER])).rows
    expect(rows).toEqual([{ delta: -42, event_type: 'subscription_expired' }])

    // A second read is a no-op.
    expect(await plans.getPlan(USER)).toBe('free')
    expect((await test.db.query('select 1 from credit_ledger where user_id=$1', [USER])).rows).toHaveLength(1)
  })

  it('adds paid credits on top of the balance exactly once per order', async () => {
    const billing = new PostgresBillingRepository(test.pool)
    const opening = await balance(test, USER)
    const order = await billing.create({
      id: randomUUID(), userId: USER, customerEmail: 'user@example.com', customerName: 'User',
      planId: 'pro', provider: 'payos', providerOrderId: '123456', amountVnd: 99_000,
    })
    const first = await billing.complete('payos', '123456', 'txn-1', 300)
    const repeated = await billing.complete('payos', '123456', 'txn-1', 300)

    expect(first?.status).toBe('paid')
    expect(repeated?.paidAt).toEqual(first?.paidAt)
    expect(await balance(test, USER)).toBe(opening + 300)
    const grants = (await test.db.query('select 1 from credit_ledger where payment_order_id=$1', [order.id])).rows
    expect(grants).toHaveLength(1)
  })
})
