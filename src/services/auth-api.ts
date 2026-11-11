import type { AuthUser } from '../types/auth'
import { apiFetch } from './api-client'

const parseError = async (response: Response) => {
  try {
    const data = await response.json() as { message?: string }
    return data.message ?? 'Yêu cầu không thành công.'
  } catch {
    return 'Yêu cầu không thành công.'
  }
}

export const authApi = {
  /** Sign-in methods the server has enabled (Google needs GOOGLE_CLIENT_ID/SECRET). */
  async providers(): Promise<{ google: boolean }> {
    try {
      const response = await fetch('/api/auth/providers')
      if (!response.ok) return { google: false }
      return await response.json() as { google: boolean }
    } catch {
      return { google: false }
    }
  },

  /** Full-page redirect to Google; the server sets the session cookies on the way back. */
  startGoogleSignIn(nextPath = '/') {
    window.location.assign('/api/auth/oauth/google?next=' + encodeURIComponent(nextPath))
  },

  async me(): Promise<AuthUser | null> {
    const response = await fetch('/api/auth/me')
    if (response.status === 401) return null
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { user: AuthUser }).user
  },

  async register(input: { displayName: string; email: string; password: string }): Promise<AuthUser> {
    const response = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { user: AuthUser }).user
  },

  async login(input: { email: string; password: string }): Promise<AuthUser> {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { user: AuthUser }).user
  },

  async resendSignupConfirmation(email: string): Promise<string> {
    const response = await apiFetch('/api/auth/resend-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { message: string }).message
  },

  async requestPasswordReset(email: string): Promise<string> {
    const response = await apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { message: string }).message
  },

  async resetPassword(input: {
    accessToken: string
    refreshToken: string
    password: string
  }): Promise<AuthUser> {
    const response = await apiFetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { user: AuthUser }).user
  },

  async updateProfile(input: { displayName: string }): Promise<AuthUser> {
    const response = await apiFetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { user: AuthUser }).user
  },

  async changePassword(input: { currentPassword: string; newPassword: string }): Promise<string> {
    const response = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { message: string }).message
  },

  async changeEmail(input: { newEmail: string; password: string }): Promise<AuthUser> {
    const response = await apiFetch('/api/auth/change-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { user: AuthUser }).user
  },

  async logout(): Promise<void> {
    const response = await apiFetch('/api/auth/logout', { method: 'POST' })
    if (!response.ok) throw new Error(await parseError(response))
  },

  async deleteAccount(): Promise<void> {
    const response = await apiFetch('/api/auth/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    })
    if (!response.ok) throw new Error(await parseError(response))
  },
}
