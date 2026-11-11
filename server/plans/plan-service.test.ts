// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PublicUser } from '../auth/auth-store.js'
import { PlanService } from './plan-service.js'

const member: PublicUser = { id: 'member', email: 'member@example.com', displayName: 'Member', createdAt: new Date().toISOString(), role: 'user', status: 'active' }
const admin: PublicUser = { ...member, id: 'admin', role: 'admin' }

describe('PlanService', () => {
  it('returns the stored plan entitlements for a regular user', async () => {
    const service = new PlanService({ getPlan: () => 'pro', close: () => undefined })
    await expect(service.status(member)).resolves.toMatchObject({
      planId: 'pro',
      unlimited: false,
      entitlements: { imageCredits: 200, wardrobeItems: 300, savedOutfits: 150, selectedGarments: 8 },
    })
  })

  it('keeps administrators unlimited regardless of the stored plan', async () => {
    const service = new PlanService({ getPlan: () => 'free', close: () => undefined })
    await expect(service.status(admin)).resolves.toMatchObject({ planName: 'Admin', unlimited: true })
  })
})
