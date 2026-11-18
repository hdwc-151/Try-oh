// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalImageStorage } from './local-image-storage.js'
import { thumbnailKey, thumbnailKeysOf, ThumbnailService, withThumbnailWarmup } from './thumbnails.js'

describe('ThumbnailService', () => {
  let directory: string
  let storage: LocalImageStorage
  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'fitsy-thumbs-'))
    storage = new LocalImageStorage(directory)
    await storage.ensureReady()
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  const original = async () => storage.save(await sharp({ create: { width: 800, height: 1000, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer(), 'image/png')

  it('creates each thumbnail once, even for concurrent requests', async () => {
    const key = await original()
    const read = vi.spyOn(storage, 'read')
    const service = new ThumbnailService(storage)
    const [a, b] = await Promise.all([service.ensure(key, 320), service.ensure(key, 320)])
    expect(a).toBe(thumbnailKey(key, 320))
    expect(b).toBe(a)
    expect(read).toHaveBeenCalledTimes(1)
    await service.ensure(key, 320)
    expect(read).toHaveBeenCalledTimes(1)
    expect((await sharp((await storage.read(a)).buffer).metadata()).width).toBe(320)
  })

  it('falls back to the original while the thumbnail is still being made, then serves it', async () => {
    const key = await original()
    const service = new ThumbnailService(storage)
    const read = storage.read.bind(storage)
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(storage, 'read').mockImplementation(async (k) => { await gate; return read(k) })
    expect(await service.ensureWithin(key, 320, 20)).toBeNull()
    release()
    await service.ensure(key, 320)
    expect(await service.ensureWithin(key, 320, 20)).toBe(thumbnailKey(key, 320))
  })

  it('does not queue more work when the resize queue is full', async () => {
    const key = await original()
    const service = new ThumbnailService(storage, 1, 50_000, 0)
    expect(await service.ensureWithin(key, 320, 1_000)).toBe(thumbnailKey(key, 320))
    const other = await original()
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const read = storage.read.bind(storage)
    const spy = vi.spyOn(storage, 'read').mockImplementation(async (k) => { await gate; return read(k) })
    const busy = service.ensure(other, 160)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    expect(await service.ensureWithin(other, 640, 1_000)).toBeNull()
    release()
    await busy
  })

  it('creates the 320px thumbnail in the background right after an upload', async () => {
    const warmed = withThumbnailWarmup(storage)
    const key = await warmed.save(await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#335577' } }).png().toBuffer(), 'image/png')
    await vi.waitFor(() => expect(existsSync(path.join(directory, thumbnailKey(key, 320)))).toBe(true))
    expect((await warmed.read(key)).buffer.length).toBeGreaterThan(0)
  })

  it('reuses a thumbnail stored by an earlier process', async () => {
    const key = await original()
    await new ThumbnailService(storage).ensure(key, 160)
    const read = vi.spyOn(storage, 'read')
    await new ThumbnailService(storage).ensure(key, 160)
    expect(read).not.toHaveBeenCalled()
  })

  it('deletes thumbnails together with the original', async () => {
    const key = await original()
    const thumb = await new ThumbnailService(storage).ensure(key, 640)
    expect(existsSync(path.join(directory, thumb))).toBe(true)
    await storage.delete(key)
    expect(existsSync(path.join(directory, thumb))).toBe(false)
    expect(thumbnailKeysOf(thumb)).toEqual([])
  })
})
