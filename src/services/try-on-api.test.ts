import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiFetch } from './api-client'
import { tryOnApi } from './try-on-api'

vi.mock('./api-client', () => ({ apiFetch: vi.fn() }))
const mock = vi.mocked(apiFetch)
const requestedKey = (index: number) => new Headers(mock.mock.calls[index]?.[1]?.headers).get('Idempotency-Key')

beforeEach(() => {
  vi.useFakeTimers()
  mock.mockReset()
  tryOnApi.clearCache()
})
afterEach(() => vi.useRealTimers())

it('reuses the request key after a timeout and recovers the exact receipt after a dropped response', async () => {
  mock.mockRejectedValueOnce(new TypeError('connection lost'))
  mock.mockResolvedValue(new Response(null, { status: 202 }))

  const unconfirmed = expect(tryOnApi.generateAngle('front', ['garment'], true, true))
    .rejects.toThrow('Chưa xác nhận được kết quả')
  await vi.runAllTimersAsync()
  await unconfirmed
  const originalKey = requestedKey(0)
  expect(originalKey).toBeTruthy()
  expect(mock.mock.calls.slice(1).map(([path]) => path))
    .toEqual(Array(4).fill('/api/generations/receipt'))
  expect(requestedKey(4)).toBe(originalKey)

  const recovered = { angle: 'front', imageUrl: '/uploads/one.webp', createdAt: 'now', credits: { remaining: 9 } }
  mock.mockClear()
  mock.mockRejectedValueOnce(new TypeError('connection lost'))
  mock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 200, body: recovered })))

  const first = tryOnApi.generateAngle('front', ['garment'], true, true)
  const second = tryOnApi.generateAngle('front', ['garment'], true, true)
  expect(mock).toHaveBeenCalledTimes(1)
  expect(requestedKey(0)).toBe(originalKey)

  await vi.advanceTimersByTimeAsync(2_000)
  expect(await Promise.all([first, second])).toEqual([recovered, recovered])
  expect(mock).toHaveBeenCalledTimes(2)
  expect(mock.mock.calls[1]?.[0]).toBe('/api/generations/receipt')
  expect(requestedKey(1)).toBe(originalKey)

  mock.mockResolvedValueOnce(new Response(JSON.stringify({ angle: 'front', imageUrl: '/uploads/two.webp' })))
  await tryOnApi.generateAngle('front', ['garment'], true, true)
  expect(requestedKey(2)).not.toBe(originalKey)
})
