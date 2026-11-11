// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSignedUrl } = vi.hoisted(() => ({ getSignedUrl:vi.fn() }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl }))

import { R2ImageStorage } from './r2-image-storage.js'

describe('R2ImageStorage signed reads', () => {
  beforeEach(() => getSignedUrl.mockReset().mockResolvedValue('https://r2.example/signed-image'))

  it('returns a short-lived direct R2 URL without downloading the object', async () => {
    const storage = new R2ImageStorage({
      accountId:'account',accessKeyId:'access',secretAccessKey:'secret',bucket:'bucket',prefix:'production',
    })
    await expect(storage.createReadUrl('production_image.webp', 300)).resolves.toBe('https://r2.example/signed-image')
    expect(getSignedUrl).toHaveBeenCalledOnce()
    expect(getSignedUrl.mock.calls[0]?.[2]).toEqual({ expiresIn:300 })
  })

  it('rejects foreign keys and clamps excessive expiry', async () => {
    const storage = new R2ImageStorage({
      accountId:'account',accessKeyId:'access',secretAccessKey:'secret',bucket:'bucket',prefix:'production',
    })
    await expect(storage.createReadUrl('../secret', 300)).rejects.toThrow('Khoá ảnh không hợp lệ')
    await storage.createReadUrl('production_image.webp', 99_999)
    expect(getSignedUrl.mock.calls[0]?.[2]).toEqual({ expiresIn:3_600 })
  })

  it('keeps signed image redirects enabled independently of bucket CORS', async () => {
    const storage = new R2ImageStorage({
      accountId:'account',accessKeyId:'access',secretAccessKey:'secret',bucket:'bucket',prefix:'production',
    })
    const send = vi.fn()
      .mockResolvedValueOnce({ CORSRules:[] })
      .mockResolvedValueOnce({})
    ;(storage as unknown as { client:{ send:typeof send } }).client.send = send

    expect(storage.isDirectReadReady()).toBe(true)
    await storage.configureBrowserCors(['https://vn-vton.onrender.com'])
    expect(storage.isDirectReadReady()).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does not disable signed redirects when optional CORS setup fails', async () => {
    const storage = new R2ImageStorage({
      accountId:'account',accessKeyId:'access',secretAccessKey:'secret',bucket:'bucket',prefix:'production',
    })
    const send = vi.fn().mockRejectedValue(new Error('forbidden'))
    ;(storage as unknown as { client:{ send:typeof send } }).client.send = send

    await expect(storage.configureBrowserCors(['https://vn-vton.onrender.com'])).rejects.toThrow('forbidden')
    expect(storage.isDirectReadReady()).toBe(true)
  })
})
