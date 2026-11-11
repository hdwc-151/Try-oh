import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { setSecurityHeaders } from './security.js'

describe('security headers', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('allows only the configured R2 image origin in production CSP', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('R2_ACCOUNT_ID', 'abc123')
    const headers = new Map<string, string>()
    const response = { setHeader: (name: string, value: string) => { headers.set(name, value) } } as unknown as Response
    let called = false

    setSecurityHeaders({} as Request, response, (() => { called = true }) as NextFunction)

    expect(called).toBe(true)
    expect(headers.get('Content-Security-Policy')).toContain("img-src 'self' data: blob: https://abc123.r2.cloudflarestorage.com")
  })

  it('allows the virtual-hosted bucket origin used by signed R2 URLs', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('R2_ACCOUNT_ID', 'abc123')
    vi.stubEnv('R2_BUCKET', 'fitting-room')
    const headers = new Map<string, string>()
    const response = { setHeader: (name: string, value: string) => { headers.set(name, value) } } as unknown as Response

    setSecurityHeaders({} as Request, response, (() => undefined) as NextFunction)

    expect(headers.get('Content-Security-Policy')).toContain('https://fitting-room.abc123.r2.cloudflarestorage.com')
  })

  it('ignores a malformed bucket name', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('R2_ACCOUNT_ID', 'abc123')
    vi.stubEnv('R2_BUCKET', 'bad bucket; img-src *')
    const headers = new Map<string, string>()
    const response = { setHeader: (name: string, value: string) => { headers.set(name, value) } } as unknown as Response

    setSecurityHeaders({} as Request, response, (() => undefined) as NextFunction)

    expect(headers.get('Content-Security-Policy')).not.toContain('bad bucket')
    expect(headers.get('Content-Security-Policy')).toContain('https://abc123.r2.cloudflarestorage.com')
  })

  it('ignores malformed optional image origins', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('R2_ACCOUNT_ID', 'bad id; img-src *')
    vi.stubEnv('R2_PUBLIC_URL', 'javascript:alert(1)')
    const headers = new Map<string, string>()
    const response = { setHeader: (name: string, value: string) => { headers.set(name, value) } } as unknown as Response

    setSecurityHeaders({} as Request, response, (() => undefined) as NextFunction)

    expect(headers.get('Content-Security-Policy')).toContain("img-src 'self' data: blob:;")
    expect(headers.get('Content-Security-Policy')).not.toContain('bad id')
  })
})

