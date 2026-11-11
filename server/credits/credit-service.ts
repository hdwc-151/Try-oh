import type { PublicUser } from '../auth/auth-store.js'
import { AuthError } from '../auth/auth-service.js'
import type { CreditRepository } from './credit-repository.js'
import { DEFAULT_IMAGE_CREDITS, type CreditReservation, type CreditStatus } from './types.js'
import type { PlanService } from '../plans/plan-service.js'

export class CreditService {
  constructor(private readonly repository: CreditRepository, private readonly plans?: PlanService) {}

  async status(user: PublicUser): Promise<CreditStatus> {
    if (user.role === 'admin') {
      return { remaining: null, limit: DEFAULT_IMAGE_CREDITS, unlimited: true }
    }
    const remaining = await this.repository.getBalance(user.id)
    if (remaining === null) throw new Error('Không tìm thấy hồ sơ credit của người dùng.')
    const limit = this.plans ? (await this.plans.status(user)).entitlements.imageCredits : DEFAULT_IMAGE_CREDITS
    return { remaining, limit, unlimited: false }
  }

  async reserve(user: PublicUser, amount: number): Promise<CreditReservation> {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Số credit cần trừ không hợp lệ.')
    if (user.role === 'admin') return { amount, charged: false }
    if (this.plans) await this.plans.status(user)
    const remaining = await this.repository.tryConsume(user.id, amount)
    if (remaining === null) {
      throw new AuthError(402, 'Bạn đã dùng hết lượt tạo ảnh. Hãy đăng ký gói phù hợp để tiếp tục.')
    }
    return { amount, charged: true }
  }

  async refund(user: PublicUser, reservation: CreditReservation): Promise<void> {
    if (!reservation.charged) return
    await this.repository.refund(user.id, reservation.amount)
  }

  close() {
    return this.repository.close()
  }
}
