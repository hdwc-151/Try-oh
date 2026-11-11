import Database from 'better-sqlite3'
import type { CreditRepository } from './credit-repository.js'

export class SqliteCreditRepository implements CreditRepository {
  private readonly database: Database.Database

  constructor(databasePath: string) {
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    const columns = this.database.pragma('table_info(users)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'credit_balance')) {
      this.database.exec('ALTER TABLE users ADD COLUMN credit_balance INTEGER NOT NULL DEFAULT 10')
    }
    this.database.exec("CREATE TABLE IF NOT EXISTS credit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,delta INTEGER NOT NULL,balance_after INTEGER NOT NULL,event_type TEXT NOT NULL,payment_order_id TEXT,created_at TEXT NOT NULL)")
  }

  getBalance(userId: string): number | null {
    const row = this.database.prepare('SELECT credit_balance FROM users WHERE id = ?').get(userId) as
      | { credit_balance: number }
      | undefined
    return row?.credit_balance ?? null
  }

  tryConsume(userId: string, amount: number): number | null {
    return this.database.transaction(() => {
      const result = this.database.prepare(
        'UPDATE users SET credit_balance = credit_balance - ? WHERE id = ? AND credit_balance >= ?',
      ).run(amount, userId, amount)
      if (result.changes !== 1) return null
      const balance = this.getBalance(userId)!
      this.database.prepare("INSERT INTO credit_ledger(user_id,delta,balance_after,event_type,created_at) VALUES(?,?,?,'generation_reserved',?)")
        .run(userId, -amount, balance, new Date().toISOString())
      return balance
    })()
  }

  refund(userId: string, amount: number): number | null {
    return this.database.transaction(() => {
      const result = this.database.prepare(
        'UPDATE users SET credit_balance = MIN(1000000, credit_balance + ?) WHERE id = ?',
      ).run(amount, userId)
      if (result.changes !== 1) return null
      const balance = this.getBalance(userId)!
      this.database.prepare("INSERT INTO credit_ledger(user_id,delta,balance_after,event_type,created_at) VALUES(?,?,?,'generation_refunded',?)")
        .run(userId, amount, balance, new Date().toISOString())
      return balance
    })()
  }

  close(): void {
    this.database.close()
  }
}
