// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PublicUser } from '../auth/auth-store.js'
import { CreditService } from './credit-service.js'
import { MemoryCreditRepository } from './memory-credit-repository.js'

const user = (role: PublicUser['role']): PublicUser => ({
  id: role,
  email: `${role}@example.com`,
  displayName: role,
  createdAt: new Date().toISOString(),
  role,
  status: 'active',
})

describe('CreditService', () => {
  it('allows exactly ten generated images for a normal user', async () => {
    const service = new CreditService(new MemoryCreditRepository())
    const member = user('user')
    for (let index = 0; index < 10; index += 1) await service.reserve(member, 1)
    await expect(service.status(member)).resolves.toMatchObject({ remaining: 0, unlimited: false })
    await expect(service.reserve(member, 1)).rejects.toMatchObject({ statusCode: 402 })
  })

  it('refunds a reservation when image generation fails', async () => {
    const service = new CreditService(new MemoryCreditRepository())
    const member = user('user')
    const reservation = await service.reserve(member, 1)
    await service.refund(member, reservation)
    await expect(service.status(member)).resolves.toMatchObject({ remaining: 10 })
  })

  it('does not charge administrators', async () => {
    const service = new CreditService(new MemoryCreditRepository())
    const admin = user('admin')
    for (let index = 0; index < 20; index += 1) await service.reserve(admin, 1)
    await expect(service.status(admin)).resolves.toEqual({ remaining: null, limit: 10, unlimited: true })
  })
})
