// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SupabaseAuthService } from './supabase-auth-service.js'

const authUser = (name: string, displayName = name) => ({
  id: `id-${name}`,
  aud: 'authenticated',
  email: `${name}@example.com`,
  user_metadata: { display_name: displayName },
  app_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
})

const session = (name: string) => ({
  access_token: `access-${name}`,
  refresh_token: `next-refresh-${name}`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: authUser(name),
})

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
// Unsigned-looking HS256 token: supabase-js then confirms it with GET /auth/v1/user.
const accessToken = (name: string) => [
  base64url({ alg: 'HS256', typ: 'JWT' }),
  base64url({ sub: `id-${name}`, email: `${name}@example.com`, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), user_metadata: { display_name: name }, app_metadata: {} }),
  Buffer.from('signature').toString('base64url'),
].join('.')

type Call = { method: string; path: string; authorization: string | null; body: unknown }

const createService = (options: { serviceRole?: boolean } = {}) => {
  const calls: Call[] = []
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    const call = { method: init?.method ?? 'GET', path: url.pathname + url.search, authorization: headers.get('authorization'), body }
    calls.push(call)
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') !== 'id_token') {
      // Slow enough that two refreshes overlap.
      await new Promise(resolve => setTimeout(resolve, 40))
      return json(200, session(String(body?.refresh_token).replace('refresh-', '')))
    }
    if (url.pathname === '/auth/v1/user' && call.method === 'PUT') {
      const data = body?.data as { display_name?: string } | undefined
      return json(200, authUser('alice', data?.display_name ?? 'alice'))
    }
    if (url.pathname === '/auth/v1/user') return json(200, authUser('alice'))
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 })
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'id_token') {
      if (body?.id_token !== 'google-id-token') return json(400, { error_code: 'bad_id_token' })
      return json(200, { ...session('google'), user: { ...authUser('google'), user_metadata: { full_name: 'Lan Nguyễn', name: 'Lan Nguyễn' }, app_metadata: { provider: 'google', providers: ['google'] } } })
    }
    return json(404, { message: 'not found' })
  }) as typeof fetch
  const service = new SupabaseAuthService(
    'https://project.supabase.co',
    'sb_publishable_test',
    'https://app.example.com',
    options.serviceRole ? 'sb_secret_service_role' : undefined,
    fakeFetch,
  )
  return { service, calls }
}

describe('SupabaseAuthService', () => {
  it('never hands one user the session of another when refreshes overlap', async () => {
    const { service } = createService()
    const [alice, bob, carol] = await Promise.all([
      service.refresh('refresh-alice'),
      service.refresh('refresh-bob'),
      service.refresh('refresh-carol'),
    ])
    expect(alice?.user.id).toBe('id-alice')
    expect(bob?.user.id).toBe('id-bob')
    expect(carol?.user.id).toBe('id-carol')
    expect(bob?.token).toBe('access-bob')
    expect(bob?.refreshToken).toBe('next-refresh-bob')
  })

  it('updates the profile with the caller\'s own token', async () => {
    const { service, calls } = createService()
    const updated = await service.updateProfile('id-alice', { displayName: 'Alice Mới' }, 'token-alice')
    expect(updated.displayName).toBe('Alice Mới')
    const call = calls.find(item => item.method === 'PUT')
    expect(call).toMatchObject({ path: '/auth/v1/user', authorization: 'Bearer token-alice', body: { data: { display_name: 'Alice Mới' } } })
  })

  it('rejects a profile update that came back for a different user', async () => {
    const { service } = createService()
    await expect(service.updateProfile('id-bob', { displayName: 'Bob Mới' }, 'token-bob')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('verifies an access token once and reuses the result', async () => {
    const { service, calls } = createService()
    const token = accessToken('alice')
    const first = await service.authenticate(token)
    const second = await service.authenticate(token)
    expect(first?.id).toBe('id-alice')
    expect(second).toEqual(first)
    expect(calls.filter(call => call.path === '/auth/v1/user' && call.method === 'GET')).toHaveLength(1)
  })

  it('revokes the session at sign-out and forgets the cached token', async () => {
    const { service, calls } = createService()
    const token = accessToken('alice')
    await service.authenticate(token)
    await service.logout(token)
    expect(calls.some(call => call.path === '/auth/v1/logout?scope=local' && call.authorization === `Bearer ${token}`)).toBe(true)
    await service.authenticate(token)
    expect(calls.filter(call => call.path === '/auth/v1/user' && call.method === 'GET')).toHaveLength(2)
  })

  it('turns a Google identity into a session and takes the name Google sends', async () => {
    const { service, calls } = createService()
    const result = await service.signInWithIdToken('google', 'google-id-token')
    expect(calls.some(call => call.path === '/auth/v1/token?grant_type=id_token' && (call.body as { id_token?: string }).id_token === 'google-id-token')).toBe(true)
    expect(result.token).toBe('access-google')
    expect(result.refreshToken).toBe('next-refresh-google')
    expect(result.user).toMatchObject({ id: 'id-google', displayName: 'Lan Nguyễn', hasPassword: false })
    await expect(service.signInWithIdToken('google', '')).rejects.toMatchObject({ statusCode: 400 })
  })
})
