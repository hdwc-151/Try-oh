import type { PoolClient } from 'pg'
import type { PostgresPool } from '../storage/postgres.js'
import type { BillingRepository } from './billing-repository.js'
import type { CreatePaymentOrder, PaymentOrder, PaymentProvider, PaymentStatus } from './types.js'

type Row = {
  id: string
  user_id: string | null
  customer_email: string
  customer_name: string
  plan_id: PaymentOrder['planId']
  provider: PaymentProvider
  provider_order_id: string
  provider_transaction_id: string | null
  amount_vnd: number
  status: PaymentStatus
  checkout_url: string | null
  created_at: Date | string
  updated_at: Date | string
  paid_at: Date | string | null
  access_expires_at: Date | string | null
}

const columns = 'id,user_id,customer_email,customer_name,plan_id,provider,provider_order_id,provider_transaction_id,amount_vnd,status,checkout_url,created_at,updated_at,paid_at,access_expires_at'
const fromRow = (row: Row): PaymentOrder => ({
  id: row.id,
  userId: row.user_id,
  customerEmail: row.customer_email,
  customerName: row.customer_name,
  planId: row.plan_id,
  provider: row.provider,
  providerOrderId: row.provider_order_id,
  providerTransactionId: row.provider_transaction_id,
  amountVnd: row.amount_vnd,
  status: row.status,
  checkoutUrl: row.checkout_url,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
  accessExpiresAt: row.access_expires_at ? new Date(row.access_expires_at).toISOString() : null,
})

export class PostgresBillingRepository implements BillingRepository {
  constructor(private readonly pool: PostgresPool) {}

  async create(order: CreatePaymentOrder): Promise<PaymentOrder> {
    const result = await this.pool.query<Row>(
      'INSERT INTO payment_orders(id,user_id,customer_email,customer_name,plan_id,provider,provider_order_id,amount_vnd) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ' + columns,
      [order.id, order.userId, order.customerEmail, order.customerName, order.planId, order.provider, order.providerOrderId, order.amountVnd],
    )
    return fromRow(result.rows[0]!)
  }

  async setCheckoutUrl(id: string, checkoutUrl: string): Promise<PaymentOrder | null> {
    const result = await this.pool.query<Row>(
      'UPDATE payment_orders SET checkout_url=$2,updated_at=now() WHERE id=$1 RETURNING ' + columns,
      [id, checkoutUrl],
    )
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }

  async getOwned(id: string, userId: string): Promise<PaymentOrder | null> {
    const result = await this.pool.query<Row>('SELECT ' + columns + ' FROM payment_orders WHERE id=$1 AND user_id=$2', [id, userId])
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }

  async getByProviderOrder(provider: PaymentProvider, providerOrderId: string): Promise<PaymentOrder | null> {
    const result = await this.pool.query<Row>('SELECT ' + columns + ' FROM payment_orders WHERE provider=$1 AND provider_order_id=$2', [provider, providerOrderId])
    return result.rows[0] ? fromRow(result.rows[0]) : null
  }

  async listAll(): Promise<PaymentOrder[]> {
    const result = await this.pool.query<Row>('SELECT ' + columns + ' FROM payment_orders ORDER BY created_at DESC')
    return result.rows.map(fromRow)
  }

  async complete(provider: PaymentProvider, providerOrderId: string, transactionId: string, imageCredits: number): Promise<PaymentOrder | null> {
    const client = await this.pool.connect()
    try {
      return await this.completeTransaction(client, provider, providerOrderId, transactionId, imageCredits)
    } finally {
      client.release()
    }
  }

  private async completeTransaction(client: PoolClient, provider: PaymentProvider, providerOrderId: string, transactionId: string, imageCredits: number) {
    await client.query('BEGIN')
    try {
      const found = await client.query<Row>('SELECT ' + columns + ' FROM payment_orders WHERE provider=$1 AND provider_order_id=$2 FOR UPDATE', [provider, providerOrderId])
      const row = found.rows[0]
      if (!row) {
        await client.query('ROLLBACK')
        return null
      }
      if (row.status !== 'pending') {
        await client.query('COMMIT')
        return fromRow(row)
      }
      if (!row.user_id) {
        await client.query('ROLLBACK')
        return fromRow(row)
      }
      const profile = await client.query<{ subscription_plan: string; subscription_expires_at: Date | string | null }>('SELECT subscription_plan,subscription_expires_at FROM profiles WHERE id=$1 FOR UPDATE', [row.user_id])
      const currentExpiry = profile.rows[0]?.subscription_expires_at ? new Date(profile.rows[0].subscription_expires_at) : null
      const startsAt = currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry : new Date()
      const expiresAt = new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1000)
      const granted = await client.query<{ credit_balance: number }>('UPDATE profiles SET subscription_plan=$2,credit_balance=least(1000000,credit_balance+$3),subscription_expires_at=$4 WHERE id=$1 RETURNING credit_balance', [row.user_id, row.plan_id, imageCredits, expiresAt])
      const balanceAfter = granted.rows[0]?.credit_balance
      if (balanceAfter === undefined) throw new Error('Không tìm thấy hồ sơ nhận quyền lợi thanh toán.')
      await client.query("INSERT INTO credit_ledger(user_id,delta,balance_after,event_type,payment_order_id) VALUES($1,$2,$3,'subscription_granted',$4)", [row.user_id, imageCredits, balanceAfter, row.id])
      const updated = await client.query<Row>(
        "UPDATE payment_orders SET status='paid',provider_transaction_id=$3,paid_at=now(),access_expires_at=$4,updated_at=now() WHERE provider=$1 AND provider_order_id=$2 RETURNING " + columns,
        [provider, providerOrderId, transactionId, expiresAt],
      )
      await client.query('COMMIT')
      return fromRow(updated.rows[0]!)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }

  async setStatus(provider: PaymentProvider, providerOrderId: string, status: Exclude<PaymentStatus, 'paid'>): Promise<void> {
    await this.pool.query("UPDATE payment_orders SET status=$3,updated_at=now() WHERE provider=$1 AND provider_order_id=$2 AND status='pending'", [provider, providerOrderId, status])
  }

  async close(): Promise<void> {}
}
