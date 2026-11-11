import ExcelJS from 'exceljs'
import { SUBSCRIPTION_PLANS } from '../plans/catalog.js'
import type { BillingRepository } from './billing-repository.js'
import type { PaymentOrder, PaymentStatus } from './types.js'

const statusLabels: Record<PaymentStatus, string> = {
  pending: 'Chờ thanh toán',
  paid: 'Đã thanh toán',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
}

const safeText = (value: string) => /^[=+\-@]/.test(value) ? `'${value}` : value
const asDate = (value: string | null) => value ? new Date(value) : null

export class ExcelPaymentLedger {
  constructor(private readonly repository: BillingRepository) {}

  async toBuffer(): Promise<Buffer> {
    const workbook = await this.buildWorkbook()
    const value = await workbook.xlsx.writeBuffer()
    return Buffer.from(value)
  }

  private async buildWorkbook(): Promise<ExcelJS.Workbook> {
    const orders = await this.repository.listAll()
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Fitsy'
    workbook.company = 'Fitsy'
    workbook.title = 'Sổ giao dịch thanh toán'
    workbook.subject = 'VietQR/payOS và MoMo'
    workbook.created = new Date()
    workbook.modified = new Date()
    workbook.calcProperties.fullCalcOnLoad = true

    this.addSummarySheet(workbook)
    this.addTransactionsSheet(workbook, orders)
    return workbook
  }

  private addSummarySheet(workbook: ExcelJS.Workbook) {
    const sheet = workbook.addWorksheet('Tổng quan', { views: [{ showGridLines: false }] })
    sheet.columns = [{ width: 30 }, { width: 24 }]
    sheet.mergeCells('A1:B1')
    sheet.getCell('A1').value = 'TỔNG QUAN THANH TOÁN FITSY'
    sheet.getCell('A1').font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 16 }
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17211D' } }
    sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' }
    sheet.getRow(1).height = 32

    const metrics: Array<[string, ExcelJS.CellFormulaValue]> = [
      ['Tổng số đơn', { formula: "MAX(COUNTA('Giao dịch'!A:A)-1,0)" }],
      ['Đơn đã thanh toán', { formula: "COUNTIF('Giao dịch'!J:J,\"Đã thanh toán\")" }],
      ['Doanh thu xác nhận (VND)', { formula: "SUMIF('Giao dịch'!J:J,\"Đã thanh toán\",'Giao dịch'!I:I)" }],
      ['Đơn VietQR/payOS', { formula: "COUNTIF('Giao dịch'!G:G,\"VietQR / payOS\")" }],
      ['Đơn MoMo', { formula: "COUNTIF('Giao dịch'!G:G,\"MoMo\")" }],
    ]
    metrics.forEach(([label, formula], index) => {
      const row = index + 3
      sheet.getCell(row, 1).value = label
      sheet.getCell(row, 2).value = formula
      sheet.getCell(row, 1).font = { bold: true, color: { argb: 'FF374151' } }
      sheet.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F6F2' } }
      sheet.getCell(row, 2).numFmt = index === 2 ? '#,##0 "₫"' : '#,##0'
      sheet.getRow(row).height = 24
    })
    sheet.getCell('A10').value = 'Dữ liệu được dựng lại từ database. Không lưu khóa API, chữ ký webhook hoặc thông tin ví nhạy cảm.'
    sheet.mergeCells('A10:B10')
    sheet.getCell('A10').font = { italic: true, color: { argb: 'FF6B7280' } }
    sheet.getCell('A10').alignment = { wrapText: true }
  }

  private addTransactionsSheet(workbook: ExcelJS.Workbook, orders: PaymentOrder[]) {
    const sheet = workbook.addWorksheet('Giao dịch', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    })
    sheet.columns = [
      { header: 'Mã đơn nội bộ', key: 'id', width: 38 },
      { header: 'User ID', key: 'userId', width: 38 },
      { header: 'Tên khách hàng', key: 'customerName', width: 24 },
      { header: 'Email', key: 'customerEmail', width: 32 },
      { header: 'Gói', key: 'plan', width: 14 },
      { header: 'Thời hạn', key: 'duration', width: 14 },
      { header: 'Cổng thanh toán', key: 'provider', width: 18 },
      { header: 'Mã đơn cổng', key: 'providerOrderId', width: 26 },
      { header: 'Số tiền (VND)', key: 'amountVnd', width: 18 },
      { header: 'Trạng thái', key: 'status', width: 20 },
      { header: 'Mã giao dịch cổng', key: 'providerTransactionId', width: 28 },
      { header: 'Tạo lúc', key: 'createdAt', width: 22 },
      { header: 'Cập nhật lúc', key: 'updatedAt', width: 22 },
      { header: 'Thanh toán lúc', key: 'paidAt', width: 22 },
      { header: 'Quyền lợi hết hạn', key: 'accessExpiresAt', width: 22 },
    ]

    for (const order of orders) {
      sheet.addRow({
        id: safeText(order.id),
        userId: safeText(order.userId ?? ''),
        customerName: safeText(order.customerName),
        customerEmail: safeText(order.customerEmail),
        plan: SUBSCRIPTION_PLANS[order.planId].name,
        duration: '30 ngày',
        provider: order.provider === 'payos' ? 'VietQR / payOS' : 'MoMo',
        providerOrderId: safeText(order.providerOrderId),
        amountVnd: order.amountVnd,
        status: statusLabels[order.status],
        providerTransactionId: order.providerTransactionId ? safeText(order.providerTransactionId) : '',
        createdAt: asDate(order.createdAt),
        updatedAt: asDate(order.updatedAt),
        paidAt: asDate(order.paidAt),
        accessExpiresAt: asDate(order.accessExpiresAt),
      })
    }

    const header = sheet.getRow(1)
    header.height = 28
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17211D' } }
    header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    sheet.autoFilter = { from: 'A1', to: 'O1' }
    for (const column of [1, 2, 4, 8, 11]) sheet.getColumn(column).numFmt = '@'

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber)
      row.height = 22
      if (rowNumber % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9F7' } }
      }
      row.getCell(9).numFmt = '#,##0 "₫"'
      for (const column of [12, 13, 14, 15]) row.getCell(column).numFmt = 'dd/mm/yyyy hh:mm:ss'
      row.alignment = { vertical: 'middle' }
    }

    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        }
      })
    })
  }
}
