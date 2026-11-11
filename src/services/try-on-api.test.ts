import { beforeEach, expect, it, vi } from 'vitest'
import { apiFetch } from './api-client'
import { tryOnApi } from './try-on-api'

vi.mock('./api-client', () => ({ apiFetch: vi.fn() }))
beforeEach(() => { vi.mocked(apiFetch).mockReset(); tryOnApi.clearCache() })

it('reuses a receipt after a dropped response and coalesces duplicate clicks', async () => {
  const mock = vi.mocked(apiFetch)
  mock.mockRejectedValueOnce(new TypeError('connection lost'))
  await expect(tryOnApi.generateAngle('front', ['garment'], true, true)).rejects.toThrow('connection lost')
  const originalKey = (mock.mock.calls[0]![1]!.headers as Record<string, string>)['Idempotency-Key']
  let finish!: (response: Response) => void
  mock.mockImplementationOnce(() => new Promise<Response>(done => { finish = done }))
  const first = tryOnApi.generateAngle('front', ['garment'], true, true)
  const second = tryOnApi.generateAngle('front', ['garment'], true, true)
  expect(mock).toHaveBeenCalledTimes(2)
  expect((mock.mock.calls[1]![1]!.headers as Record<string, string>)['Idempotency-Key']).toBe(originalKey)
  finish(new Response(JSON.stringify({ angle: 'front', imageUrl: '/uploads/one.webp', createdAt: 'now', credits: { remaining: 9 } }), { status: 200 }))
  expect(await first).toEqual(await second)
  mock.mockResolvedValueOnce(new Response(JSON.stringify({ angle: 'front', imageUrl: '/uploads/two.webp' })))
  await tryOnApi.generateAngle('front', ['garment'], true, true)
  expect((mock.mock.calls[2]![1]!.headers as Record<string, string>)['Idempotency-Key']).not.toBe(originalKey)
})
