import Database from 'better-sqlite3'
import type { BillingRepository } from './billing-repository.js'
import type { CreatePaymentOrder, PaymentOrder, PaymentProvider, PaymentStatus } from './types.js'

type Row = {
  id: string; user_id: string; plan_id: PaymentOrder['planId']; provider: PaymentProvider
  customer_email: string; customer_name: string
  provider_order_id: string; provider_transaction_id: string | null; amount_vnd: number
  status: PaymentStatus; checkout_url: string | null; created_at: string; updated_at: string
  paid_at: string | null; access_expires_at: string | null
}

const fromRow = (row: Row): PaymentOrder => ({
  id: row.id, userId: row.user_id, planId: row.plan_id, provider: row.provider,
  customerEmail: row.customer_email, customerName: row.customer_name,
  providerOrderId: row.provider_order_id, providerTransactionId: row.provider_transaction_id,
  amountVnd: row.amount_vnd, status: row.status, checkoutUrl: row.checkout_url,
  createdAt: row.created_at, updatedAt: row.updated_at, paidAt: row.paid_at,
  accessExpiresAt: row.access_expires_at,
})

export class SqliteBillingRepository implements BillingRepository {
  private readonly database: Database.Database

  constructor(databasePath: string) {
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    const columns = this.database.pragma('table_info(users)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'subscription_expires_at')) {
      this.database.exec('ALTER TABLE users ADD COLUMN subscription_expires_at TEXT')
    }
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS payment_orders (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,customer_email TEXT NOT NULL DEFAULT '',customer_name TEXT NOT NULL DEFAULT '',plan_id TEXT NOT NULL,provider TEXT NOT NULL,provider_order_id TEXT NOT NULL,provider_transaction_id TEXT,amount_vnd INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',checkout_url TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,paid_at TEXT,access_expires_at TEXT,UNIQUE(provider,provider_order_id));" +
      'CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created ON payment_orders(user_id,created_at DESC);' +
      "CREATE TABLE IF NOT EXISTS credit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,delta INTEGER NOT NULL,balance_after INTEGER NOT NULL,event_type TEXT NOT NULL,payment_order_id TEXT UNIQUE,created_at TEXT NOT NULL);",
    )
    const paymentColumns = this.database.pragma('table_info(payment_orders)') as Array<{ name: string }>
    if (!paymentColumns.some((column) => column.name === 'customer_email')) {
      this.database.exec("ALTER TABLE payment_orders ADD COLUMN customer_email TEXT NOT NULL DEFAULT ''")
    }
    if (!paymentColumns.some((column) => column.name === 'customer_name')) {
      this.database.exec("ALTER TABLE payment_orders ADD COLUMN customer_name TEXT NOT NULL DEFAULT ''")
    }
  }

  create(order: CreatePaymentOrder): PaymentOrder {
    const now = new Date().toISOString()
    this.database.prepare('INSERT INTO payment_orders(id,user_id,customer_email,customer_name,plan_id,provider,provider_order_id,amount_vnd,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(order.id, order.userId, order.customerEmail, order.customerName, order.planId, order.provider, order.providerOrderId, order.amountVnd, now, now)
    return this.get(order.id)!
  }

  setCheckoutUrl(id: string, checkoutUrl: string): PaymentOrder | null {
    this.database.prepare('UPDATE payment_orders SET checkout_url=?,updated_at=? WHERE id=?').run(checkoutUrl, new Date().toISOString(), id)
    return this.get(id)
  }

  getOwned(id: string, userId: string): PaymentOrder | null {
    const row = this.database.prepare('SELECT * FROM payment_orders WHERE id=? AND user_id=?').get(id, userId) as Row | undefined
    return row ? fromRow(row) : null
  }

  getByProviderOrder(provider: PaymentProvider, providerOrderId: string): PaymentOrder | null {
    const row = this.database.prepare('SELECT * FROM payment_orders WHERE provider=? AND provider_order_id=?').get(provider, providerOrderId) as Row | undefined
    return row ? fromRow(row) : null
  }

  listAll(): PaymentOrder[] {
    const rows = this.database.prepare('SELECT * FROM payment_orders ORDER BY created_at DESC').all() as Row[]
    return rows.map(fromRow)
  }

  complete(provider: PaymentProvider, providerOrderId: string, transactionId: string, imageCredits: number): PaymentOrder | null {
    return this.database.transaction(() => {
      const order = this.getByProviderOrder(provider, providerOrderId)
      if (!order || order.status !== 'pending') return order
      const profile = this.database.prepare('SELECT subscription_plan,subscription_expires_at FROM users WHERE id=?').get(order.userId) as { subscription_plan: string; subscription_expires_at: string | null } | undefined
      const current = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null
      const startsAt = current && current.getTime() > Date.now() ? current : new Date()
      const expiresAt = new Date(startsAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
      this.database.prepare('UPDATE users SET subscription_plan=?,credit_balance=MIN(1000000,credit_balance+?),subscription_expires_at=? WHERE id=?').run(order.planId, imageCredits, expiresAt, order.userId)
      const balance = (this.database.prepare('SELECT credit_balance FROM users WHERE id=?').get(order.userId) as { credit_balance: number } | undefined)?.credit_balance
      if (balance === undefined) throw new Error('Không tìm thấy hồ sơ nhận quyền lợi thanh toán.')
      this.database.prepare("INSERT INTO credit_ledger(user_id,delta,balance_after,event_type,payment_order_id,created_at) VALUES(?,?,?,'subscription_granted',?,?)")
        .run(order.userId, imageCredits, balance, order.id, new Date().toISOString())
      const now = new Date().toISOString()
      this.database.prepare("UPDATE payment_orders SET status='paid',provider_transaction_id=?,paid_at=?,access_expires_at=?,updated_at=? WHERE id=?").run(transactionId, now, expiresAt, now, order.id)
      return this.get(order.id)
    })()
  }

  setStatus(provider: PaymentProvider, providerOrderId: string, status: Exclude<PaymentStatus, 'paid'>): void {
    this.database.prepare("UPDATE payment_orders SET status=?,updated_at=? WHERE provider=? AND provider_order_id=? AND status='pending'").run(status, new Date().toISOString(), provider, providerOrderId)
  }

  close(): void { this.database.close() }
  private get(id: string): PaymentOrder | null {
    const row = this.database.prepare('SELECT * FROM payment_orders WHERE id=?').get(id) as Row | undefined
    return row ? fromRow(row) : null
  }
}
