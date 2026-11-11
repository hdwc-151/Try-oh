// @vitest-environment node
// End-to-end checks of the HTTP layer on the local (SQLite + disk) backends.
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Server } from 'node:http'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { AuthService } from './auth/auth-service.js'
import { AuthStore } from './auth/auth-store.js'
import { MockImageProvider } from './providers/mock-image-provider.js'
import type { ImageStorage } from './storage/image-storage.js'
import { LocalImageStorage } from './storage/local-image-storage.js'
import { SqliteGarmentRepository } from './storage/sqlite-garment-repository.js'
import { SqliteUserDataRepository } from './storage/sqlite-user-data-repository.js'

const MUTATION = { 'X-Fitting-Room-Request': '1' }

describe('HTTP API', () => {
  let directory: string
  let server: Server
  let baseUrl: string
  let cookie: string
  let failDeletes: boolean
  let closers: Array<() => void>

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'fitsy-app-'))
    const databasePath = path.join(directory, 'test.sqlite')
    const authStore = new AuthStore(databasePath)
    const garments = new SqliteGarmentRepository(databasePath)
    const userData = new SqliteUserDataRepository(databasePath)
    const disk = new LocalImageStorage(path.join(directory, 'uploads'))
    await disk.ensureReady()
    failDeletes = false
    // Storage whose deletes can be made to fail, as R2 does during an outage.
    const images: ImageStorage = {
      save: (buffer, mimeType) => disk.save(buffer, mimeType),
      read: (key) => disk.read(key),
      publicUrl: (key) => disk.publicUrl(key),
      delete: async (key) => {
        if (failDeletes) throw new Error('storage unavailable')
        await disk.delete(key)
      },
    }
    const app = createApp(garments, userData, images, path.join(directory, 'uploads'), new MockImageProvider(0), new AuthService(authStore))
    server = app.listen(0)
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    closers = [() => authStore.close(), () => garments.close(), () => userData.close()]

    const registered = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { ...MUTATION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', displayName: 'User', password: 'password-123' }),
    })
    expect(registered.status).toBe(201)
    cookie = registered.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    for (const close of closers) close()
    rmSync(directory, { recursive: true, force: true })
  })

  const photo = async (color: string) => {
    const buffer = await sharp({ create: { width: 64, height: 96, channels: 3, background: color } }).png().toBuffer()
    const form = new FormData()
    form.set('personImage', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), 'photo.png')
    return form
  }

  it('treats a missing or malformed body as a client error, not a server error', async () => {
    const empty = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: MUTATION })
    expect(empty.status).toBeGreaterThanOrEqual(400)
    expect(empty.status).toBeLessThan(500)

    const malformed = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { ...MUTATION, 'Content-Type': 'application/json' }, body: '{"email":',
    })
    expect(malformed.status).toBe(400)

    const oversized = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { ...MUTATION, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(40_000) }),
    })
    expect(oversized.status).toBe(413)
  })

  it('marks API responses as private and sends the security headers', async () => {
    const response = await fetch(`${baseUrl}/api/garments`, { headers: { Cookie: cookie } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('ignores a cookie with a broken escape sequence instead of failing the request', async () => {
    const response = await fetch(`${baseUrl}/api/garments`, { headers: { Cookie: 'fitting_room_session=%E0%A4%A' } })
    expect(response.status).toBe(401)
  })

  it('keeps the new person photo when removing the old one fails', async () => {
    const upload = async (color: string) => fetch(`${baseUrl}/api/person-image`, {
      method: 'POST', headers: { ...MUTATION, Cookie: cookie }, body: await photo(color),
    })
    const first = await upload('#336699')
    expect(first.status).toBe(201)

    failDeletes = true
    const second = await upload('#996633')
    expect(second.status).toBe(201)
    const { imageUrl } = await second.json() as { imageUrl: string }

    // The stored photo must still be readable: it is the one the database points at.
    const current = await fetch(`${baseUrl}/api/person-image`, { headers: { Cookie: cookie } })
    expect((await current.json() as { item: { imageUrl: string } }).item.imageUrl).toBe(imageUrl)
    const image = await fetch(`${baseUrl}${imageUrl}`, { headers: { Cookie: cookie } })
    expect(image.status).toBe(200)
  })

  it('deletes the person photo record even when storage cannot delete the file', async () => {
    await fetch(`${baseUrl}/api/person-image`, { method: 'POST', headers: { ...MUTATION, Cookie: cookie }, body: await photo('#224466') })
    failDeletes = true
    const removed = await fetch(`${baseUrl}/api/person-image`, { method: 'DELETE', headers: { ...MUTATION, Cookie: cookie } })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ deleted: true })
  })
})
