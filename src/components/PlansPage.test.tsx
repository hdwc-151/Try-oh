import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PlanSnapshot } from '../types/plans'
import { PlansPage } from './PlansPage'

const snapshot: PlanSnapshot = {
  current: { planId: 'free', planName: 'Free', unlimited: false, entitlements: { imageCredits: 10, wardrobeItems: 20, savedOutfits: 10, selectedGarments: 8 } },
  plans: [
    { id: 'free', name: 'Free', description: 'Dùng thử.', monthlyPriceVnd: 0, recommended: false, entitlements: { imageCredits: 10, wardrobeItems: 20, savedOutfits: 10, selectedGarments: 8 }, highlights: ['10 ảnh tạo thử trọn đời'] },
    { id: 'pro', name: 'Pro', description: 'Sáng tạo.', monthlyPriceVnd: 199000, recommended: true, entitlements: { imageCredits: 200, wardrobeItems: 300, savedOutfits: 150, selectedGarments: 8 }, highlights: ['200 ảnh mỗi chu kỳ'] },
  ],
}

describe('PlansPage', () => {
  it('shows the current plan and offers VietQR and MoMo for paid plans', () => {
    render(<PlansPage snapshot={snapshot} loading={false} error={null} onNavigate={vi.fn()} onReload={vi.fn()} />)
    expect(screen.getByText('Gói hiện tại:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gói hiện tại' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'VietQR' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'MoMo' })).toBeEnabled()
    expect(screen.getByText('200 ảnh mỗi chu kỳ')).toBeInTheDocument()
  })
})
