import Database from 'better-sqlite3'
import { isSubscriptionPlanId } from './catalog.js'
import type { PlanRepository } from './plan-repository.js'
import type { SubscriptionPlanId } from './types.js'

export class SqlitePlanRepository implements PlanRepository {
  private readonly database: Database.Database
  constructor(databasePath: string) {
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    const columns = this.database.pragma('table_info(users)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'subscription_plan')) {
      this.database.exec("ALTER TABLE users ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'free'")
    }
    if (!columns.some((column) => column.name === 'subscription_expires_at')) {
      this.database.exec('ALTER TABLE users ADD COLUMN subscription_expires_at TEXT')
    }
  }
  getPlan(userId: string): SubscriptionPlanId | null {
    this.database.transaction(() => {
      const now = new Date().toISOString()
      const expired = this.database.prepare('SELECT credit_balance FROM users WHERE id=? AND subscription_expires_at IS NOT NULL AND subscription_expires_at<=?').get(userId, now) as { credit_balance: number } | undefined
      if (!expired) return
      this.database.prepare("UPDATE users SET subscription_plan='free',credit_balance=0,subscription_expires_at=NULL WHERE id=?").run(userId)
      if (expired.credit_balance > 0) {
        this.database.exec('CREATE TABLE IF NOT EXISTS credit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,delta INTEGER NOT NULL,balance_after INTEGER NOT NULL,event_type TEXT NOT NULL,payment_order_id TEXT,created_at TEXT NOT NULL)')
        this.database.prepare("INSERT INTO credit_ledger(user_id,delta,balance_after,event_type,created_at) VALUES(?,?,0,'subscription_expired',?)").run(userId, -expired.credit_balance, now)
      }
    })()
    const row = this.database.prepare('SELECT subscription_plan FROM users WHERE id = ?').get(userId) as { subscription_plan: string } | undefined
    return isSubscriptionPlanId(row?.subscription_plan) ? row.subscription_plan : null
  }
  close(): void { this.database.close() }
}
