// @vitest-environment node
import express from 'express'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { generationIdempotency, generationReceipt } from './generation-idempotency.js'
import { MemoryGenerationRequestStore } from '../services/generation-requests.js'

describe('AI HTTP idempotency', () => {
  it('handles simultaneous requests, replay, conflicts and user isolation', async () => {
    const app = express()
    app.use(express.json())
    app.use((request, _response, next) => {
      request.authUser = { id: request.get('X-Test-User') ?? 'user-a' } as Express.Request['authUser']
      next()
    })
    let resolve!: () => void
    const gate = new Promise<void>(done => { resolve = done })
    let started!: () => void
    const ready = new Promise<void>(done => { started = done })
    let calls = 0
    const store = new MemoryGenerationRequestStore()
    app.get('/generate', generationReceipt(store))
    app.post('/generate', generationIdempotency(store), async (_request, response) => {
      calls += 1
      started()
      await gate
      response.json({ imageUrl: '/uploads/test.webp', calls })
    })
    const server = app.listen(0)
    const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/generate'
    const send = (body: unknown = { garmentIds: ['a'] }, user = 'user-a', key = 'request-0001') => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Test-User': user },
      body: JSON.stringify(body),
    })
    const readReceipt = (user = 'user-a') => fetch(url, {
      headers: { 'Idempotency-Key': 'request-0001', 'X-Test-User': user },
    })
    try {
      const pending = send()
      await ready
      const duplicate = await send()
      expect(duplicate.status).toBe(409)
      expect(await duplicate.json()).toMatchObject({ code: 'generation_in_progress' })
      expect(calls).toBe(1)
      expect((await readReceipt()).status).toBe(202)
      expect((await readReceipt('user-b')).status).toBe(404)
      resolve()
      const original = await pending
      const originalBody = await original.json()
      const receipt = await readReceipt()
      expect(receipt.headers.get('Cache-Control')).toBe('no-store')
      expect(await receipt.json()).toEqual({ status: 200, body: originalBody })
      const replay = await send()
      expect(replay.headers.get('Idempotency-Replayed')).toBe('true')
      expect(await replay.json()).toEqual(originalBody)
      expect(calls).toBe(1)
      expect((await send({ garmentIds: ['b'] })).status).toBe(409)
      expect((await send(undefined, 'user-b')).status).toBe(200)
      expect(calls).toBe(2)
      expect((await send(undefined, 'user-a', 'bad')).status).toBe(400)
    } finally {
      resolve()
      await new Promise<void>(done => server.close(() => done()))
    }
  })
})
