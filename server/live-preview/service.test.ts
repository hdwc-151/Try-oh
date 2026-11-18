// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { PublicUser } from '../auth/auth-store.js'
import type { GarmentRecord } from '../garments/garment.js'
import { PlanService } from '../plans/plan-service.js'
import type { SubscriptionPlanId } from '../plans/types.js'
import type { GarmentRepository } from '../garments/garment-repository.js'
import type { ImageStorage } from '../storage/image-storage.js'
import type { DecartTokenIssuer, DecartTokenRequest } from './decart-client.js'
import { MemoryLivePreviewRepository } from './repository.js'
import { LivePreviewService } from './service.js'
import { LivePreviewError } from './types.js'

const GARMENT_ID = '11111111-1111-4111-8111-111111111111'
const user: PublicUser = { id: 'user-1', email: 'u@example.com', displayName: 'User', createdAt: new Date().toISOString(), role: 'user', status: 'active' }
const admin: PublicUser = { ...user, id: 'admin-1', role: 'admin' }

const garment: GarmentRecord = {
  id: GARMENT_ID, userId: user.id, name: 'Áo thun', category: 'tops',
  frontOriginalKey: 'orig.png', frontProcessedKey: 'processed.png', backOriginalKey: null, backProcessedKey: null,
  createdAt: new Date().toISOString(),
}

const setup = (planId: SubscriptionPlanId, issuerOverride?: DecartTokenIssuer | null, now?: () => Date, fastCost = 1) => {
  const repository = new MemoryLivePreviewRepository()
  const plans = new PlanService({ getPlan: () => planId, close: () => undefined })
  const garments = { findById: (userId: string, id: string) => (userId === user.id && id === GARMENT_ID ? garment : null) } as unknown as GarmentRepository
  const images = { read: vi.fn(async () => ({ buffer: Buffer.from('png-bytes'), mimeType: 'image/png' })) } as unknown as ImageStorage
  const requests: DecartTokenRequest[] = []
  const issuer: DecartTokenIssuer = { createToken: async (request) => { requests.push(request); return { apiKey: 'ek_test', expiresAt: '2030-01-01T00:00:00.000Z' } } }
  const service = new LivePreviewService(repository, plans, garments, images, issuerOverride === undefined ? issuer : issuerOverride, { fastCost }, now)
  return { service, repository, requests, images }
}

const errorCode = async (promise: Promise<unknown>) => {
  try { await promise } catch (error) { return error instanceof LivePreviewError ? error.code : String(error) }
  return 'resolved'
}

describe('LivePreviewService', () => {
  it('refuses free accounts with plan_required and charges nothing', async () => {
    const { service } = setup('free')
    expect(await errorCode(service.start(user, { source: 'wardrobe', garmentId: GARMENT_ID }))).toBe('plan_required')
    await expect(service.status(user)).resolves.toMatchObject({ enabled: true, included: false, used: 0, remaining: 0 })
  })

  it('reports disabled when no Decart key is configured', async () => {
    const { service } = setup('pro', null)
    await expect(service.status(user)).resolves.toMatchObject({ enabled: false, included: true })
    expect(await errorCode(service.start(user, { source: 'upload' }))).toBe('live_preview_unavailable')
  })

  it('returns the wardrobe garment as the reference with a category prompt', async () => {
    const { service } = setup('plus')
    const result = await service.start(user, { source: 'wardrobe', garmentId: GARMENT_ID })
    expect(result.session.seconds).toBe(10)
    expect(result.reference).toEqual({
      prompt: expect.stringContaining('top'),
      imageBase64: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png',
    })
    expect(result.status).toMatchObject({ limit: 3, used: 1, remaining: 2 })
  })

  it('does not charge when the garment is not in the wardrobe', async () => {
    const { service } = setup('plus')
    expect(await errorCode(service.start(user, { source: 'wardrobe', garmentId: '22222222-2222-4222-8222-222222222222' }))).toBe('garment_not_found')
    await expect(service.status(user)).resolves.toMatchObject({ used: 0 })
  })

  it('accepts an uploaded reference without reading storage', async () => {
    const { service, images } = setup('plus')
    const result = await service.start(user, { source: 'upload', category: 'bottoms' })
    expect(result.reference.imageBase64).toBeNull()
    expect(result.reference.prompt).toContain('pants')
    expect(images.read).not.toHaveBeenCalled()
  })

  it('stops at the plan quota within the rolling window and frees it afterwards', async () => {
    let now = new Date('2026-11-01T00:00:00Z')
    const { service } = setup('plus', undefined, () => now)
    for (let index = 0; index < 3; index += 1) await service.start(user, { source: 'upload' })
    expect(await errorCode(service.start(user, { source: 'upload' }))).toBe('quota_exhausted')
    const status = await service.status(user)
    expect(status).toMatchObject({ used: 3, remaining: 0 })
    expect(status.nextResetAt).not.toBeNull()
    now = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
    await expect(service.status(user)).resolves.toMatchObject({ used: 0, remaining: 3 })
  })

  it('keeps administrators unlimited', async () => {
    const { service } = setup('free')
    for (let index = 0; index < 5; index += 1) await service.start(admin, { source: 'upload' })
    await expect(service.status(admin)).resolves.toMatchObject({ unlimited: true, remaining: null, used: 5 })
  })

  it('mints tokens bound to the model and the session length, at most twice per session', async () => {
    const { service, requests } = setup('pro')
    const { session } = await service.start(user, { source: 'upload' })
    const token = await service.issueToken(user, session.id, 'https://fitsy.example')
    expect(token).toMatchObject({ apiKey: 'ek_test', seconds: 10, model: 'lucy-vton-latest' })
    expect(requests[0]).toMatchObject({
      model: 'lucy-vton-latest', maxSessionSeconds: 10, allowedOrigins: ['https://fitsy.example'],
      metadata: { userId: user.id, sessionId: session.id },
    })
    await service.issueToken(user, session.id)
    expect(await errorCode(service.issueToken(user, session.id))).toBe('session_closed')
  })

  it('does not mint tokens for another account or an old session', async () => {
    let now = new Date()
    const { service } = setup('pro', undefined, () => now)
    const { session } = await service.start(user, { source: 'upload' })
    expect(await errorCode(service.issueToken({ ...user, id: 'someone-else' }, session.id))).toBe('session_closed')
    now = new Date(now.getTime() + 5 * 60 * 1000)
    expect(await errorCode(service.issueToken(user, session.id))).toBe('session_closed')
  })

  it('refunds the session when Decart refuses the first token', async () => {
    const failing: DecartTokenIssuer = { createToken: async () => { throw new Error('boom') } }
    const { service } = setup('plus', failing)
    const { session } = await service.start(user, { source: 'upload' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await errorCode(service.issueToken(user, session.id))).toBe('provider_error')
    await expect(service.status(user)).resolves.toMatchObject({ used: 0, remaining: 3 })
  })

  it('refuses the fast tier on Plus but allows it on Pro', async () => {
    const plus = setup('plus')
    expect(await errorCode(plus.service.start(user, { source: 'upload', speed: 'fast' }))).toBe('fast_mode_not_included')
    await expect(plus.service.status(user)).resolves.toMatchObject({ fastModeIncluded: false, used: 0 })
    const standard = await plus.service.start(user, { source: 'upload', speed: 'standard' })
    expect(standard.session.speed).toBe('standard')

    const pro = setup('pro')
    await expect(pro.service.status(user)).resolves.toMatchObject({ fastModeIncluded: true })
    const fast = await pro.service.start(user, { source: 'upload', speed: 'fast' })
    expect(fast.session.speed).toBe('fast')
    await pro.service.issueToken(user, fast.session.id)
    expect(pro.requests[0]?.metadata).toMatchObject({ speed: 'fast' })
  })

  it('charges a fast session at the configured cost', async () => {
    const { service } = setup('pro', undefined, undefined, 2)
    for (let index = 0; index < 4; index += 1) await service.start(user, { source: 'upload', speed: 'fast' })
    await expect(service.status(user)).resolves.toMatchObject({ used: 8, remaining: 2, fastCost: 2 })
    await service.start(user, { source: 'upload', speed: 'fast' })
    expect(await errorCode(service.start(user, { source: 'upload', speed: 'fast' }))).toBe('quota_exhausted')
    expect(await errorCode(service.start(user, { source: 'upload' }))).toBe('quota_exhausted')
  })
})
