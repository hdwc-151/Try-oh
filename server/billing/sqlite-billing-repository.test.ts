import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthStore } from '../auth/auth-store.js'
import { SqliteCreditRepository } from '../credits/sqlite-credit-repository.js'
import { SqlitePlanRepository } from '../plans/sqlite-plan-repository.js'
import { SqliteBillingRepository } from './sqlite-billing-repository.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('SqliteBillingRepository', () => {
  it('activates a plan atomically and does not apply a repeated webhook twice', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'tryoh-billing-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'test.sqlite')
    const auth = new AuthStore(databasePath)
    auth.createUser({
      id: 'user-1', email: 'customer@example.com', displayName: 'Customer',
      passwordHash: 'hash', passwordSalt: 'salt', createdAt: new Date().toISOString(),
    })
    const credits = new SqliteCreditRepository(databasePath)
    const plans = new SqlitePlanRepository(databasePath)
    const billing = new SqliteBillingRepository(databasePath)
    const order = billing.create({
      id: 'order-1', userId: 'user-1', customerEmail: 'customer@example.com',
      customerName: 'Customer', planId: 'pro', provider: 'payos',
      providerOrderId: '1234567890123', amountVnd: 149_000,
    })

    const first = billing.complete('payos', order.providerOrderId, 'transaction-1', 300)
    const repeated = billing.complete('payos', order.providerOrderId, 'transaction-1', 300)
    const database = new Database(databasePath, { readonly: true })
    const user = database.prepare('SELECT subscription_plan,credit_balance FROM users WHERE id=?').get('user-1') as { subscription_plan: string; credit_balance: number }

    expect(first?.status).toBe('paid')
    expect(repeated?.paidAt).toBe(first?.paidAt)
    expect(user).toEqual({ subscription_plan: 'pro', credit_balance: 310 })
    const ledger = database.prepare('SELECT delta,balance_after,event_type FROM credit_ledger WHERE payment_order_id=?').get(order.id)
    expect(ledger).toEqual({ delta: 300, balance_after: 310, event_type: 'subscription_granted' })

    database.close()
    billing.close()
    plans.close()
    credits.close()
    auth.close()
  })
})
