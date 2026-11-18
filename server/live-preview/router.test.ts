// @vitest-environment node
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PublicUser } from '../auth/auth-store.js'
import { PlanService } from '../plans/plan-service.js'
import type { GarmentRepository } from '../garments/garment-repository.js'
import type { ImageStorage } from '../storage/image-storage.js'
import type { DecartTokenRequest } from './decart-client.js'
import { MemoryLivePreviewRepository } from './repository.js'
import { createLivePreviewRouter } from './router.js'
import { LivePreviewService } from './service.js'

const user: PublicUser = { id: 'user-1', email: 'u@example.com', displayName: 'User', createdAt: new Date().toISOString(), role: 'user', status: 'active' }
const APP_ORIGIN = 'https://fitsy.example'

describe('live preview HTTP routes', () => {
  let server: Server
  let baseUrl: string
  let requests: DecartTokenRequest[]
  let planId: 'free' | 'pro'

  beforeEach(async () => {
    requests = []
    planId = 'pro'
    const service = new LivePreviewService(
      new MemoryLivePreviewRepository(),
      new PlanService({ getPlan: () => planId, close: () => undefined }),
      { findById: () => null } as unknown as GarmentRepository,
      {} as ImageStorage,
      { createToken: async (request) => { requests.push(request); return { apiKey: 'ek_1', expiresAt: '2030-01-01T00:00:00Z' } } },
    )
    const app = express()
    app.use(express.json())
    app.use((request, _response, next) => { request.authUser = user; next() })
    app.use('/api/live-preview', createLivePreviewRouter(service, { appOrigin: APP_ORIGIN }))
    server = app.listen(0)
    await new Promise<void>(resolve => server.once('listening', () => resolve()))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/live-preview`
  })
  afterEach(async () => { await new Promise(resolve => server.close(resolve)) })

  const post = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(baseUrl + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  })

  it('validates the request body', async () => {
    expect((await post('/sessions', { source: 'camera' })).status).toBe(400)
    expect((await post('/sessions', { source: 'wardrobe', garmentId: 'not-a-uuid' })).status).toBe(400)
    expect((await post('/sessions', { source: 'upload', category: 'hats' })).status).toBe(400)
    expect((await post('/sessions', { source: 'upload', speed: 'turbo' })).status).toBe(400)
    expect((await post('/sessions/not-a-uuid/token')).status).toBe(400)
  })

  it('answers 402 plan_required for free accounts', async () => {
    planId = 'free'
    const response = await post('/sessions', { source: 'upload' })
    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toMatchObject({ code: 'plan_required' })
  })

  it('starts a session and binds browser tokens to the app origin only', async () => {
    const started = await post('/sessions', { source: 'upload', category: 'tops' })
    expect(started.status).toBe(201)
    const { session } = await started.json() as { session: { id: string } }
    expect((await post(`/sessions/${session.id}/token`, undefined, { origin: 'https://evil.example' })).status).toBe(200)
    expect(requests[0]?.allowedOrigins).toBeUndefined()
    const token = await post(`/sessions/${session.id}/token`, undefined, { origin: APP_ORIGIN })
    await expect(token.json()).resolves.toMatchObject({ apiKey: 'ek_1', seconds: 10 })
    expect(requests[1]?.allowedOrigins).toEqual([APP_ORIGIN])
    expect((await post(`/sessions/${session.id}/token`)).status).toBe(409)
    const status = await (await fetch(baseUrl + '/status')).json()
    expect(status).toMatchObject({ enabled: true, used: 1, remaining: 9, sessionSeconds: 10 })
  })
})
