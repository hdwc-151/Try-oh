import { createClient, type User } from '@supabase/supabase-js'
import type { AuthBackend, AuthResult, OAuthProvider } from './auth-backend.js'
import { AuthError } from './auth-service.js'
import type { PublicUser } from './auth-store.js'
import type { UserRole } from '../admin/types.js'

/**
 * Display name from Auth metadata: our own `display_name` first, then the name a social
 * provider sends (Google: `full_name` / `name`), then the email's local part. Matches
 * `handle_new_auth_user()` (migration 010) so the API and `profiles` agree.
 */
const displayNameFromMetadata = (metadata: Record<string, unknown> | undefined, email: string): string => {
  for (const key of ['display_name', 'full_name', 'name']) {
    const value = metadata?.[key]
    if (typeof value === 'string' && value.trim().length >= 2) return value.trim().slice(0, 50)
  }
  const local = (email.split('@')[0] ?? '').trim().slice(0, 50)
  return local.length >= 2 ? local : 'Người dùng'
}

/** Accounts created through Google have no password until they set one. */
const hasPasswordFrom = (appMetadata: Record<string, unknown> | undefined): boolean | undefined => {
  const providers = Array.isArray(appMetadata?.providers) ? appMetadata.providers : appMetadata?.provider ? [appMetadata.provider] : null
  return providers ? providers.includes('email') : undefined
}

const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email ?? '',
  displayName: displayNameFromMetadata(user.user_metadata, user.email ?? ''),
  createdAt: user.created_at,
  role: (['user', 'koc', 'moderator', 'admin'].includes(String(user.app_metadata.role))
    ? user.app_metadata.role
    : 'user') as UserRole,
  status: 'active',
  hasPassword: hasPasswordFrom(user.app_metadata),
})

const toPublicUserFromClaims = (claims: Record<string, unknown>): PublicUser | null => {
  const id = typeof claims.sub === 'string' ? claims.sub : ''
  const email = typeof claims.email === 'string' ? claims.email : ''
  if (!id || !email) return null
  const userMetadata = claims.user_metadata && typeof claims.user_metadata === 'object'
    ? claims.user_metadata as Record<string, unknown>
    : {}
  const appMetadata = claims.app_metadata && typeof claims.app_metadata === 'object'
    ? claims.app_metadata as Record<string, unknown>
    : {}
  const displayName = displayNameFromMetadata(userMetadata, email)
  const roleValue = String(appMetadata.role ?? 'user')
  return {
    id,
    email,
    displayName,
    createdAt: new Date((typeof claims.iat === 'number' ? claims.iat : Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    role: (['user', 'koc', 'moderator', 'admin'].includes(roleValue) ? roleValue : 'user') as UserRole,
    status: 'active',
    hasPassword: hasPasswordFrom(appMetadata),
  }
}

const validate = (email: string, displayName: string, password: string): void => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new AuthError(400, 'Email không hợp lệ.')
  }
  if (displayName.length < 2 || displayName.length > 50) {
    throw new AuthError(400, 'Tên hiển thị phải từ 2 đến 50 ký tự.')
  }
  if (password.length < 8 || password.length > 128) {
    throw new AuthError(400, 'Mật khẩu phải từ 8 đến 128 ký tự.')
  }
}


const AUTH_REQUEST_TIMEOUT_MS = 10_000
const TOKEN_CACHE_TTL_MS = 60_000
const TOKEN_CACHE_MAX_ENTRIES = 5_000

export class SupabaseAuthService implements AuthBackend {
  // Stateless calls only (token verification, sending emails). Anything that
  // creates or refreshes a session must use `createAuthClient()`: supabase-js
  // keeps the current session and a single in-flight refresh on the client
  // object, so a shared instance hands one user's refreshed session to another
  // user whose refresh overlaps it.
  private readonly client
  private readonly adminClient
  private readonly fetch: typeof fetch
  // Verified access tokens, so a page that loads dozens of images does not verify
  // (or, on projects with a legacy HS256 secret, call Supabase for) the same token
  // on every request. Entries never outlive the token's own expiry.
  private readonly verifiedTokens = new Map<string, { user: PublicUser; expiresAt: number }>()

  constructor(
    private readonly url: string,
    private readonly publishableKey: string,
    private readonly appBaseUrl: string,
    serviceRoleKey?: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    if (!url || !publishableKey) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_PUBLISHABLE_KEY.')
    if (!appBaseUrl) throw new Error('Thiếu APP_BASE_URL cho luồng khôi phục mật khẩu.')
    // Supabase calls sit on the login and request-authentication paths: bound them
    // so an Auth outage fails fast instead of piling up open requests.
    this.fetch = (input, init) => fetchImpl(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
    })
    this.client = this.createAuthClient()
    this.adminClient = serviceRoleKey
      ? createClient(this.url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: this.fetch } })
      : null
  }

  /** A client with its own (empty) session state, for one sign-in, sign-up or refresh. */
  private createAuthClient() {
    return createClient(this.url, this.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { fetch: this.fetch },
    })
  }

  /**
   * Updates the signed-in user through the Auth REST API. `auth.updateUser()` cannot
   * be used here: it needs a session stored in the client, which a server never has.
   */
  private async updateAuthUser(token: string, attributes: Record<string, unknown>): Promise<{ user: User | null; code: string; message: string }> {
    let response: Response
    try {
      response = await this.fetch(`${this.url.replace(/\/+$/, '')}/auth/v1/user`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', apikey: this.publishableKey, Authorization: `Bearer ${token}` },
        body: JSON.stringify(attributes),
      })
    } catch {
      throw new AuthError(502, 'Dịch vụ tài khoản đang gặp sự cố. Vui lòng thử lại sau.')
    }
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    if (!response.ok || !body || typeof body.id !== 'string') {
      return {
        user: null,
        code: String(body?.error_code ?? body?.code ?? response.status),
        message: String(body?.msg ?? body?.message ?? body?.error_description ?? ''),
      }
    }
    return { user: body as unknown as User, code: '', message: '' }
  }

  async register(input: { email: string; displayName: string; password: string; legacyClaimToken?: string }): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase()
    const displayName = input.displayName.trim()
    validate(email, displayName, input.password)
    const { data, error } = await this.createAuthClient().auth.signUp({
      email,
      password: input.password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: new URL('/', this.appBaseUrl).toString(),
      },
    })
    if (error) {
      const mailFailure = /confirmation email|sending email|smtp/i.test(error.message)
      console.error('[auth.signup] Supabase rejected signup', {
        code: error.code,
        status: error.status,
        message: error.message,
      })
      throw new AuthError(
        mailFailure ? 502 : 400,
        mailFailure
          ? 'Tài khoản chưa thể gửi email xác minh. Vui lòng thử lại sau.'
          : 'Chưa thể tạo tài khoản. Hãy kiểm tra thông tin hoặc đăng nhập nếu bạn đã có tài khoản.',
      )
    }
    if (!data.user || !data.session) {
      throw new AuthError(403, 'Tài khoản đã được tạo. Hãy xác minh email rồi đăng nhập.')
    }
    return this.fromSession(data.user, data.session.access_token, data.session.refresh_token, data.session.expires_at)
  }

  async login(emailInput: string, password: string): Promise<AuthResult> {
    const { data, error } = await this.createAuthClient().auth.signInWithPassword({
      email: emailInput.trim().toLowerCase(),
      password,
    })
    if (error) {
      const unconfirmed = error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message)
      throw new AuthError(
        unconfirmed ? 403 : 401,
        unconfirmed ? 'Email chưa được xác minh. Hãy kiểm tra hộp thư hoặc gửi lại email xác minh.' : 'Email hoặc mật khẩu không đúng.',
      )
    }
    if (!data.user || !data.session) throw new AuthError(401, 'Email hoặc mật khẩu không đúng.')
    return this.fromSession(data.user, data.session.access_token, data.session.refresh_token, data.session.expires_at)
  }

  async resendSignupConfirmation(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new AuthError(400, 'Email không hợp lệ.')
    }
    const { error } = await this.client.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: new URL('/', this.appBaseUrl).toString() },
    })
    if (!error) return

    console.error('[auth.resend-confirmation] Supabase could not send confirmation email', {
      code: error.code,
      status: error.status,
      message: error.message,
    })
    const rateLimited = error.status === 429 || /rate limit|too many/i.test(error.message)
    throw new AuthError(
      rateLimited ? 429 : 502,
      rateLimited
        ? 'Bạn vừa yêu cầu gửi email. Vui lòng đợi khoảng một phút rồi thử lại.'
        : 'Chưa thể gửi lại email xác minh. Vui lòng thử lại sau.',
    )
  }

  async requestPasswordReset(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new AuthError(400, 'Email không hợp lệ.')
    }
    const redirectTo = new URL('/reset-password', this.appBaseUrl).toString()
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw new AuthError(400, 'Chưa thể gửi email đặt lại mật khẩu. Vui lòng thử lại sau.')
  }

  async resetPassword(input: { accessToken: string; refreshToken: string; password: string }): Promise<AuthResult> {
    if (input.password.length < 8 || input.password.length > 128) {
      throw new AuthError(400, 'Mật khẩu phải từ 8 đến 128 ký tự.')
    }
    if (!input.accessToken || !input.refreshToken) {
      throw new AuthError(400, 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
    }

    // Dùng client riêng cho mỗi request để recovery session không bị chia sẻ giữa người dùng.
    const recoveryClient = this.createAuthClient()
    const { data: sessionData, error: sessionError } = await recoveryClient.auth.setSession({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
    })
    if (sessionError || !sessionData.user || !sessionData.session) {
      throw new AuthError(400, 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
    }

    const { data, error } = await recoveryClient.auth.updateUser({ password: input.password })
    if (error || !data.user) {
      throw new AuthError(400, 'Không thể cập nhật mật khẩu. Hãy yêu cầu một liên kết mới.')
    }
    return this.fromSession(
      data.user,
      sessionData.session.access_token,
      sessionData.session.refresh_token,
      sessionData.session.expires_at,
    )
  }

  async authenticate(token: string | null): Promise<PublicUser | null> {
    if (!token) return null
    const now = Date.now()
    const cached = this.verifiedTokens.get(token)
    if (cached) {
      if (cached.expiresAt > now) return cached.user
      this.verifiedTokens.delete(token)
    }
    // getClaims verifies signature/issuer/expiry and caches Supabase JWKS locally for
    // asymmetric projects, avoiding a remote Auth request for every API/image request.
    const { data, error } = await this.client.auth.getClaims(token)
    if (error || !data?.claims) return null
    const user = toPublicUserFromClaims(data.claims)
    if (!user) return null
    const tokenExpiresAt = typeof data.claims.exp === 'number' ? data.claims.exp * 1000 : now
    const expiresAt = Math.min(now + TOKEN_CACHE_TTL_MS, tokenExpiresAt)
    if (expiresAt > now) {
      if (this.verifiedTokens.size >= TOKEN_CACHE_MAX_ENTRIES) {
        this.verifiedTokens.delete(this.verifiedTokens.keys().next().value as string)
      }
      this.verifiedTokens.set(token, { user, expiresAt })
    }
    return user
  }

  async refresh(refreshToken: string | null): Promise<AuthResult | null> {
    if (!refreshToken) return null
    // Never the shared client: see the note on `client`.
    const { data, error } = await this.createAuthClient().auth.refreshSession({ refresh_token: refreshToken })
    if (error || !data.user || !data.session) return null
    return this.fromSession(data.user, data.session.access_token, data.session.refresh_token, data.session.expires_at)
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return
    this.verifiedTokens.delete(token)
    // Revoke this session's refresh token at Supabase so a copied cookie cannot be
    // used after sign-out. Best effort: the caller clears the cookies either way.
    try {
      await this.fetch(`${this.url.replace(/\/+$/, '')}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: this.publishableKey, Authorization: `Bearer ${token}` },
      })
    } catch {
      // Supabase unreachable: the access token still expires on its own schedule.
    }
  }

  async updateProfile(userId: string, input: { displayName: string }, token?: string | null): Promise<PublicUser> {
    const displayName = input.displayName.trim()
    if (displayName.length < 2 || displayName.length > 50) {
      throw new AuthError(400, 'Tên hiển thị phải từ 2 đến 50 ký tự.')
    }
    if (!token) throw new AuthError(401, 'Vui lòng đăng nhập để tiếp tục.')
    const result = await this.updateAuthUser(token, { data: { display_name: displayName } })
    if (!result.user || result.user.id !== userId) {
      throw new AuthError(400, 'Không thể cập nhật tên hiển thị. Vui lòng đăng nhập lại rồi thử lại.')
    }
    // The access token still carries the old name until it is refreshed.
    this.verifiedTokens.delete(token)
    return toPublicUser(result.user)
  }

  async changeEmail(userId: string, input: { newEmail: string; password: string }, token?: string | null): Promise<PublicUser> {
    const newEmail = input.newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254) {
      throw new AuthError(400, 'Email không hợp lệ.')
    }
    await this.verifyCurrentPassword(userId, input.password, token, 'Mật khẩu xác nhận không đúng.')
    const result = await this.updateAuthUser(token!, { email: newEmail })
    if (!result.user || result.user.id !== userId) {
      const duplicate = result.code === 'email_exists' || /already|registered|exists/i.test(result.message)
      throw new AuthError(duplicate ? 409 : 400, duplicate ? 'Email này đã được sử dụng.' : 'Không thể đổi email. Vui lòng thử lại sau.')
    }
    this.verifiedTokens.delete(token!)
    return toPublicUser(result.user)
  }

  async changePassword(userId: string, input: { currentPassword: string; newPassword: string }, token?: string | null): Promise<void> {
    if (input.newPassword.length < 8 || input.newPassword.length > 128) {
      throw new AuthError(400, 'Mật khẩu mới phải từ 8 đến 128 ký tự.')
    }
    await this.verifyCurrentPassword(userId, input.currentPassword, token, 'Mật khẩu hiện tại không đúng.')
    const result = await this.updateAuthUser(token!, { password: input.newPassword })
    if (!result.user || result.user.id !== userId) {
      const samePassword = result.code === 'same_password' || /different from the old/i.test(result.message)
      const weakPassword = result.code === 'weak_password' || /weak|pwned|leaked/i.test(result.message)
      throw new AuthError(400, samePassword
        ? 'Mật khẩu mới phải khác mật khẩu hiện tại.'
        : weakPassword
          ? 'Mật khẩu mới quá yếu hoặc đã bị lộ. Hãy chọn mật khẩu khác.'
          : 'Không thể đổi mật khẩu. Vui lòng thử lại sau.')
    }
  }

  async deleteAccount(userId: string, token?: string | null): Promise<void> {
    if (!token) throw new AuthError(401, 'Vui lòng đăng nhập để tiếp tục.')
    const verified = await this.authenticate(token)
    if (!verified || verified.id !== userId) throw new AuthError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.')
    if (!this.adminClient) throw new AuthError(503, 'Chức năng xóa tài khoản chưa được cấu hình trên máy chủ.')
    const { error } = await this.adminClient.auth.admin.deleteUser(userId)
    if (error) throw new AuthError(502, 'Chưa thể xóa tài khoản. Vui lòng thử lại sau.')
    for (const [cachedToken, entry] of this.verifiedTokens) if (entry.user.id === userId) this.verifiedTokens.delete(cachedToken)
  }

  /**
   * Exchanges a Google ID token for a Supabase session. The sign-in itself happened
   * against Google on our own domain (see `GoogleOAuth`), so the user never sees the
   * Supabase project host. Supabase validates the token's signature and audience
   * against the Google client configured on the project.
   */
  async signInWithIdToken(provider: OAuthProvider, idToken: string): Promise<AuthResult> {
    if (!idToken) throw new AuthError(400, 'Không thể đăng nhập bằng Google. Vui lòng thử lại.')
    let response: Response
    try {
      response = await this.fetch(`${this.url.replace(/\/+$/, '')}/auth/v1/token?grant_type=id_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.publishableKey },
        body: JSON.stringify({ provider, id_token: idToken }),
      })
    } catch {
      throw new AuthError(502, 'Dịch vụ tài khoản đang gặp sự cố. Vui lòng thử lại sau.')
    }
    const body = await response.json().catch(() => null) as {
      access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number; user?: User
      error_code?: string; msg?: string; error_description?: string
    } | null
    if (!response.ok || !body?.access_token || !body.refresh_token || !body.user?.id) {
      console.error('[auth.id-token] Supabase rejected the Google identity', {
        status: response.status,
        code: body?.error_code,
        message: body?.msg ?? body?.error_description,
      })
      throw new AuthError(400, 'Không thể đăng nhập bằng Google. Vui lòng thử lại.')
    }
    const expiresAt = body.expires_at ?? (body.expires_in ? Math.floor(Date.now() / 1000) + body.expires_in : undefined)
    return this.fromSession(body.user, body.access_token, body.refresh_token, expiresAt)
  }

  private fromSession(
    user: User,
    accessToken: string,
    refreshToken: string,
    expiresAt?: number,
  ): AuthResult {
    return {
      user: toPublicUser(user),
      token: accessToken,
      refreshToken,
      expiresAt: new Date((expiresAt ?? Math.floor(Date.now() / 1000) + 3600) * 1000),
    }
  }

  private async verifyCurrentPassword(
    userId: string,
    password: string,
    token: string | null | undefined,
    errorMessage: string,
  ): Promise<void> {
    if (!token) throw new AuthError(401, 'Vui lòng đăng nhập để tiếp tục.')
    const { data, error } = await this.client.auth.getUser(token)
    const email = data.user?.email
    if (error || !email || data.user?.id !== userId) {
      throw new AuthError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.')
    }
    const verificationClient = this.createAuthClient()
    const verified = await verificationClient.auth.signInWithPassword({ email, password })
    if (verified.error || !verified.data.user || verified.data.user.id !== userId) {
      throw new AuthError(400, errorMessage)
    }
  }
}
