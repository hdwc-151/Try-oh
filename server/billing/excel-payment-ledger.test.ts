import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { BillingRepository } from './billing-repository.js'
import { ExcelPaymentLedger } from './excel-payment-ledger.js'
import type { PaymentOrder } from './types.js'

const paidOrder: PaymentOrder = {
  id: '9b2f5ca1-1d5b-45cf-86a4-929d62d3f285',
  userId: 'f3f4eaf2-8db7-4657-93e0-aaa5e669d3b1',
  customerEmail: 'customer@example.com',
  customerName: 'Nguyễn Nam',
  planId: 'pro',
  provider: 'payos',
  providerOrderId: '1793643168022',
  providerTransactionId: 'FT26030512345678',
  amountVnd: 199_000,
  status: 'paid',
  checkoutUrl: null,
  createdAt: '2026-11-05T01:00:00.000Z',
  updatedAt: '2026-11-05T01:01:00.000Z',
  paidAt: '2026-11-05T01:01:00.000Z',
  accessExpiresAt: '2026-12-05T01:01:00.000Z',
}

describe('ExcelPaymentLedger', () => {
  it('exports payment details, summary formulas and identifiers as text', async () => {
    const repository = { listAll: () => [paidOrder] } as unknown as BillingRepository
    const ledger = new ExcelPaymentLedger(repository)
    const buffer = await ledger.toBuffer()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)

    const transactions = workbook.getWorksheet('Giao dịch')!
    expect(transactions.getCell('A2').value).toBe(paidOrder.id)
    expect(transactions.getCell('H2').value).toBe(paidOrder.providerOrderId)
    expect(transactions.getCell('H2').numFmt).toBe('@')
    expect(transactions.getCell('I2').value).toBe(199_000)
    expect(transactions.getCell('J2').value).toBe('Đã thanh toán')
    expect(transactions.getCell('K2').value).toBe(paidOrder.providerTransactionId)
    expect(workbook.getWorksheet('Tổng quan')!.getCell('B5').value).toEqual({
      formula: "SUMIF('Giao dịch'!J:J,\"Đã thanh toán\",'Giao dịch'!I:I)",
    })
  })
})
