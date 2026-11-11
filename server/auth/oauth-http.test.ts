// @vitest-environment node
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import express from 'express'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AuthBackend, AuthResult } from './auth-backend.js'
import { createAuthRouter, OAUTH_COOKIE, SESSION_COOKIE } from './auth-http.js'
import { GoogleOAuth } from './google-oauth.js'

const result: AuthResult = {
  user: { id: 'user-1', email: 'lan@gmail.com', displayName: 'Lan Nguyễn', createdAt: '2026-11-11T00:00:00.000Z', role: 'user', status: 'active', hasPassword: false },
  token: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: new Date(Date.now() + 3_600_000),
}

const redeemed: Array<{ code: string; verifier: string; redirectUri: string }> = []
const identities: string[] = []

const googleFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const form = new URLSearchParams(String(init?.body))
  redeemed.push({ code: form.get('code') ?? '', verifier: form.get('code_verifier') ?? '', redirectUri: form.get('redirect_uri') ?? '' })
  expect(String(input)).toBe('https://oauth2.googleapis.com/token')
  expect(form.get('client_secret')).toBe('google-secret')
  if (form.get('code') !== 'good-code') {
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ id_token: 'id-token-for-' + form.get('code') }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch

const backend = (google = true): AuthBackend => ({
  register: async () => result,
  login: async () => result,
  authenticate: async () => null,
  logout: async () => undefined,
  ...(google ? {
    signInWithIdToken: async (_provider: 'google', idToken: string) => {
      identities.push(idToken)
      return result
    },
  } : {}),
})

const listen = (auth: AuthBackend, google: GoogleOAuth | null) => {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter(auth, false, 30, undefined, undefined, undefined, google))
  const server = app.listen(0)
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

describe('Google sign-in through our own domain', () => {
  let server: Server
  let baseUrl: string

  beforeAll(() => {
    const google = new GoogleOAuth({
      clientId: 'google-client-id',
      clientSecret: 'google-secret',
      redirectUri: 'https://fitsy.example/api/auth/oauth/callback',
      fetchImpl: googleFetch,
    })
    const started = listen(backend(), google)
    server = started.server
    baseUrl = started.baseUrl
  })
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))
  beforeEach(() => { redeemed.length = 0; identities.length = 0 })

  const cookieValue = (response: Response, name: string) => response.headers.getSetCookie()
    .map(value => value.split(';')[0])
    .find(value => value.startsWith(name + '='))

  const start = async (query = '') => {
    const response = await fetch(`${baseUrl}/api/auth/oauth/google${query}`, { redirect: 'manual' })
    const location = response.headers.get('location') ?? ''
    return { response, location, state: new URL(location).searchParams.get('state') ?? '', cookie: cookieValue(response, OAUTH_COOKIE) }
  }

  it('sends people to Google itself, never to the Supabase project host', async () => {
    const { response, location, cookie } = await start('?next=/koc')
    expect(response.status).toBe(302)
    const url = new URL(location)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('google-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://fitsy.example/api/auth/oauth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    expect(location).not.toContain('supabase')
    expect(cookie).toBeTruthy()
    expect(response.headers.getSetCookie().find(value => value.startsWith(OAUTH_COOKIE))).toMatch(/HttpOnly/i)
  })

  it('signs in and returns to the requested page', async () => {
    const { state, cookie } = await start('?next=/koc')
    const callback = await fetch(`${baseUrl}/api/auth/oauth/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie! } })
    expect(callback.status).toBe(303)
    expect(callback.headers.get('location')).toBe('/koc')
    expect(cookieValue(callback, SESSION_COOKIE)).toBe(`${SESSION_COOKIE}=access-token`)
    expect(redeemed[0]?.code).toBe('good-code')
    expect(redeemed[0]?.verifier.length).toBeGreaterThanOrEqual(43)
    expect(identities).toEqual(['id-token-for-good-code'])
  })

  it('refuses a callback from another browser, and a state replayed later', async () => {
    const { state, cookie } = await start()
    const forged = await fetch(`${baseUrl}/api/auth/oauth/callback?code=good-code&state=${state}`, { redirect: 'manual' })
    expect(forged.headers.get('location')).toBe('/?auth_error=google_expired')
    expect(cookieValue(forged, SESSION_COOKIE)).toBeUndefined()
    expect(redeemed).toEqual([])

    // The forged attempt consumed the state, so even the real browser has to start over.
    const replay = await fetch(`${baseUrl}/api/auth/oauth/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie! } })
    expect(replay.headers.get('location')).toBe('/?auth_error=google_expired')
  })

  it('reports a cancelled or rejected sign-in without a session', async () => {
    const cancelled = await start().then(({ state, cookie }) =>
      fetch(`${baseUrl}/api/auth/oauth/callback?error=access_denied&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie! } }))
    expect(cancelled.headers.get('location')).toBe('/?auth_error=google_cancelled')

    const { state, cookie } = await start()
    const failed = await fetch(`${baseUrl}/api/auth/oauth/callback?code=stolen-code&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie! } })
    expect(failed.headers.get('location')).toBe('/?auth_error=google_failed')
    expect(cookieValue(failed, SESSION_COOKIE)).toBeUndefined()
    expect(identities).toEqual([])
  })

  it('never redirects off-site after sign-in', async () => {
    for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example', '/api/auth/logout']) {
      const { state, cookie } = await start('?next=' + encodeURIComponent(next))
      const callback = await fetch(`${baseUrl}/api/auth/oauth/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { Cookie: cookie! } })
      expect(callback.headers.get('location')).toBe('/')
    }
  })

  it('hands the mobile app a one-time code it can only spend once', async () => {
    const { location, state } = await start('?client=mobile&redirect=' + encodeURIComponent('fitsy://auth-callback'))
    expect(location).toContain('accounts.google.com')
    // No browser cookie is involved: the app receives the code on its own deep link.
    const callback = await fetch(`${baseUrl}/api/auth/oauth/callback?code=good-code&state=${state}`, { redirect: 'manual' })
    const handoff = new URL(callback.headers.get('location') ?? '').searchParams.get('fitsy_code')
    expect(callback.headers.get('location')).toContain('fitsy://auth-callback?fitsy_code=')
    expect(cookieValue(callback, SESSION_COOKIE)).toBeUndefined()

    const claim = await fetch(`${baseUrl}/api/auth/oauth/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: handoff }),
    })
    expect(await claim.json()).toMatchObject({ accessToken: 'access-token', refreshToken: 'refresh-token' })

    const replay = await fetch(`${baseUrl}/api/auth/oauth/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: handoff }),
    })
    expect(replay.status).toBe(400)
  })

  it('refuses a mobile redirect the operator did not list', async () => {
    const response = await fetch(`${baseUrl}/api/auth/oauth/google?client=mobile&redirect=${encodeURIComponent('evil://steal')}`, { redirect: 'manual' })
    expect(response.status).toBe(400)
  })

  it('sends the mobile app back with the reason when Google is cancelled', async () => {
    const { state } = await start('?client=mobile')
    const callback = await fetch(`${baseUrl}/api/auth/oauth/callback?error=access_denied&state=${state}`, { redirect: 'manual' })
    expect(callback.headers.get('location')).toBe('fitsy://auth-callback?auth_error=google_cancelled')
  })
})

describe('without Google credentials', () => {
  let server: Server
  let baseUrl: string
  beforeAll(() => {
    const started = listen(backend(false), null)
    server = started.server
    baseUrl = started.baseUrl
  })
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

  it('hides the button and refuses to start', async () => {
    expect(await (await fetch(`${baseUrl}/api/auth/providers`)).json()).toEqual({ google: false })
    const start = await fetch(`${baseUrl}/api/auth/oauth/google`, { redirect: 'manual' })
    expect(start.status).toBe(303)
    expect(start.headers.get('location')).toBe('/?auth_error=google_unavailable')
  })
})
