import type { PlanSnapshot } from '../types/plans'

export const planApi = {
  async get(): Promise<PlanSnapshot> {
    const response = await fetch('/api/plans', { cache: 'no-store' })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null
      throw new Error(body?.message ?? 'Không thể tải thông tin gói đăng ký.')
    }
    return response.json() as Promise<PlanSnapshot>
  },
}
