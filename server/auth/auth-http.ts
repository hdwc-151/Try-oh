import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import type { AuthBackend, AuthResult } from './auth-backend.js'
import type { GoogleOAuth } from './google-oauth.js'
import { newBrowserSecret, OAuthStore, type OAuthStateStore } from './oauth-store.js'
import { AuthError } from './auth-service.js'
import type { PublicUser } from './auth-store.js'
import type { MaybePromise } from '../storage/maybe-promise.js'
import { runtimeConfig } from '../config/runtime-config.js'
import {
  buildRateLimitKey,
  createFixedWindowRateLimit,
  MemoryRateLimitStore,
  rateLimitIdentity,
  type RateLimitStore,
} from '../http/rate-limit.js'

export const SESSION_COOKIE = 'fitting_room_session'
const REFRESH_COOKIE = 'fitting_room_refresh'
/** Social providers this build knows how to sign people in with. */
const OAUTH_PROVIDER_NAMES = ['google'] as const
type OAuthProviderName = typeof OAUTH_PROVIDER_NAMES[number]

/** What a provider reports when the person said no, rather than something breaking. */
const CANCELLED_BY_USER = new Set(['access_denied'])

/** Ties the browser that started a social sign-in to the callback that finishes it. */
export const OAUTH_COOKIE = 'fitting_room_oauth'
const OAUTH_COOKIE_PATH = '/api/auth/oauth'
const OAUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1000

/** Only same-site paths are allowed after sign-in, never `//host` or absolute URLs (open redirect). */
const safeNextPath = (value: unknown): string => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.startsWith('/api/')) return '/'
  return value.slice(0, 200)
}

/** The app's own deep link, and only one this operator listed: never an arbitrary URL. */
/**
 * A listed entry may end in `*` so that Expo Go, whose address changes with the
 * development machine's IP, can be allowed during development. Wildcards are dropped
 * in production: whoever picks the address also receives the session hand-off code.
 */
const allowedMobileRedirect = (value: unknown): string | null => {
  const allowed = runtimeConfig.mobileAuthRedirects
  const requested = typeof value === 'string' && value ? value : (allowed[0] ?? '')
  if (!requested) return null
  const permitted = allowed.some(entry => entry.endsWith('*')
    ? requested.startsWith(entry.slice(0, -1))
    : entry === requested)
  return permitted ? requested : null
}

const withParam = (url: string, name: string, value: string) =>
  url + (url.includes('?') ? '&' : '?') + name + '=' + encodeURIComponent(value)

const readCookie = (request: Request, cookieName: string): string | null => {
  const cookieHeader = request.headers.cookie
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=')
    if (name !== cookieName) continue
    // A hand-crafted cookie with a bad escape must read as "no cookie", not crash.
    try { return decodeURIComponent(valueParts.join('=')) } catch { return null }
  }
  return null
}

const readAccessToken = (request: Request): string | null => {
  const authorization = request.get('authorization')
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim()
    if (token) return token
  }
  return readCookie(request, SESSION_COOKIE)
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const PASSWORD_RESET_WINDOW_MS = 15 * 60 * 1000
const CONFIRMATION_RESEND_WINDOW_MS = 60 * 1000

type CookieOptions = { secure: boolean; sessionDays: number }

const setSessionCookies = (response: Response, result: AuthResult, options: CookieOptions) => {
  response.cookie(SESSION_COOKIE, result.token, {
    httpOnly: true, sameSite: 'lax', secure: options.secure, path: '/', expires: result.expiresAt,
  })
  if (result.refreshToken) {
    response.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: options.secure,
      path: '/',
      expires: new Date(Date.now() + options.sessionDays * 24 * 60 * 60 * 1000),
    })
  }
}

type UserDecorator = (user: PublicUser) => MaybePromise<PublicUser>

const resolveUser = async (auth: AuthBackend, request: Request, response: Response, options: CookieOptions, decorate?: UserDecorator) => {
  const token = readAccessToken(request)
  const user = await auth.authenticate(token)
  if (user) return decorate ? await decorate(user) : user
  const refreshed = await auth.refresh?.(readCookie(request, REFRESH_COOKIE))
  if (!refreshed) return null
  setSessionCookies(response, refreshed, options)
  return decorate ? await decorate(refreshed.user) : refreshed.user
}

export const createRequireAuth = (auth: AuthBackend, secureCookies = false, sessionDays = 30, decorate?: UserDecorator) => async (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  try {
    // Already authenticated by an earlier middleware on the same request.
    if (request.authUser) { next(); return }
    const user = await resolveUser(auth, request, response, { secure: secureCookies, sessionDays }, decorate)
    if (!user) {
      response.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục.', code: 'authentication_required' })
      return
    }
    request.authUser = user
    next()
  } catch (error) {
    next(error)
  }
}

export function createAuthRouter(
  auth: AuthBackend,
  secureCookies: boolean,
  sessionDays = 30,
  decorate?: UserDecorator,
  rateLimits: RateLimitStore = new MemoryRateLimitStore(),
  deleteAccountData?: (user: PublicUser, token: string | null) => Promise<void>,
  google?: GoogleOAuth | null,
  /** Shared store when running several instances; defaults to this process's memory. */
  oauthStateStore?: OAuthStateStore,
) {
  const router = Router()
  const cookieOptions = { secure: secureCookies, sessionDays }
  const ipKey = (request: Request) => 'ip:' + rateLimitIdentity.ip(request)
  const accountKey = (request: Request) => rateLimitIdentity.account(request.body?.email)
  const limited = 'Bạn đã thử quá nhiều lần. Vui lòng đợi rồi thử lại.'
  const registerLimit = createFixedWindowRateLimit({
    namespace: 'auth.register.ip', store: rateLimits, max: runtimeConfig.authRegisterIpPerHour,
    windowMs: 60 * 60 * 1000, key: ipKey, message: limited,
  })
  const loginIpLimit = createFixedWindowRateLimit({
    namespace: 'auth.login.ip', store: rateLimits, max: runtimeConfig.authLoginIpPerWindow,
    windowMs: LOGIN_WINDOW_MS, key: ipKey, message: limited,
  })
  const loginAccountLimit = createFixedWindowRateLimit({
    namespace: 'auth.login.account', store: rateLimits, max: runtimeConfig.authLoginAccountPerWindow,
    windowMs: LOGIN_WINDOW_MS, key: accountKey, message: limited,
  })
  const resetIpLimit = createFixedWindowRateLimit({
    namespace: 'auth.reset.ip', store: rateLimits, max: runtimeConfig.passwordResetIpPerWindow,
    windowMs: PASSWORD_RESET_WINDOW_MS, key: ipKey, message: limited,
  })
  const resetAccountLimit = createFixedWindowRateLimit({
    namespace: 'auth.reset.account', store: rateLimits, max: runtimeConfig.passwordResetAccountPerWindow,
    windowMs: PASSWORD_RESET_WINDOW_MS, key: accountKey, message: limited,
  })
  const resendConfirmationIpLimit = createFixedWindowRateLimit({
    namespace: 'auth.confirmation.ip', store: rateLimits, max: 10,
    windowMs: PASSWORD_RESET_WINDOW_MS, key: ipKey, message: limited,
  })
  const resendConfirmationAccountLimit = createFixedWindowRateLimit({
    namespace: 'auth.confirmation.account', store: rateLimits, max: 1,
    windowMs: CONFIRMATION_RESEND_WINDOW_MS, key: accountKey,
    message: 'Bạn vừa yêu cầu gửi email. Vui lòng đợi khoảng một phút rồi thử lại.',
  })

  /**
   * One social provider, reduced to what the two routes below need. Each keeps its own
   * callback path so the redirect URI registered with the provider stays exact.
   */
  type OAuthFlow = {
    provider: OAuthProviderName
    callbackPath: string
    createVerifier(): string
    authorizationUrl(state: string, codeVerifier: string): string
    signIn(code: string, codeVerifier: string): Promise<AuthResult>
  }

  const flows: OAuthFlow[] = []
  if (google && auth.signInWithIdToken) {
    const signInWithIdToken = auth.signInWithIdToken.bind(auth)
    flows.push({
      provider: 'google',
      callbackPath: '/oauth/callback',
      createVerifier: () => google.createVerifier(),
      authorizationUrl: (state, codeVerifier) => google.authorizationUrl(state, codeVerifier),
      signIn: async (code, codeVerifier) => signInWithIdToken('google', await google.exchangeCode(code, codeVerifier)),
    })
  }
  const enabled = (provider: OAuthProviderName) => flows.some(flow => flow.provider === provider)

  const oauthStore: OAuthStateStore = oauthStateStore ?? new OAuthStore()
  const oauthCookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: secureCookies, path: OAUTH_COOKIE_PATH }

  router.get('/providers', (_request, response) => {
    response.json({ google: enabled('google') })
  })

  /**
   * Social sign-in runs against the provider directly from this server, so its consent
   * screen names this site instead of the Supabase project host. The authorization code
   * is redeemed server-side (PKCE + the app secret) and traded for an application session.
   */
  const beginSignIn = async (flow: OAuthFlow, request: Request, response: Response) => {
    const mobile = request.query.client === 'mobile'
    const redirectTo = mobile ? allowedMobileRedirect(request.query.redirect) : safeNextPath(request.query.next)
    if (!redirectTo) {
      response.status(400).json({ message: 'Địa chỉ quay lại không hợp lệ.', code: 'invalid_redirect' })
      return
    }
    const browserSecret = mobile ? undefined : newBrowserSecret()
    const codeVerifier = flow.createVerifier()
    const state = await oauthStore.start({ codeVerifier, browserSecret, redirectTo, client: mobile ? 'mobile' : 'web' })
    if (browserSecret) {
      response.cookie(OAUTH_COOKIE, browserSecret, { ...oauthCookieOptions, maxAge: OAUTH_COOKIE_MAX_AGE_MS })
    }
    response.redirect(302, flow.authorizationUrl(state, codeVerifier))
  }

  const completeSignIn = async (flow: OAuthFlow, request: Request, response: Response, next: NextFunction) => {
    let pending: Awaited<ReturnType<OAuthStateStore['finish']>> = null
    const fail = (reason: 'cancelled' | 'expired' | 'failed') => {
      const code = flow.provider + '_' + reason
      response.clearCookie(OAUTH_COOKIE, oauthCookieOptions)
      if (pending?.client === 'mobile') response.redirect(303, withParam(pending.redirectTo, 'auth_error', code))
      else response.redirect(303, '/?auth_error=' + encodeURIComponent(code))
    }
    try {
      pending = await oauthStore.finish(typeof request.query.state === 'string' ? request.query.state : null)
      const providerError = typeof request.query.error === 'string' ? request.query.error : ''
      if (providerError) {
        fail(CANCELLED_BY_USER.has(providerError) ? 'cancelled' : 'failed')
        return
      }
      const code = typeof request.query.code === 'string' ? request.query.code : ''
      // A callback that did not start in this browser (or started too long ago) is dropped:
      // the state is single-use and the web flow also has to present the matching cookie.
      const sameBrowser = pending?.client === 'mobile' || (pending?.browserSecret && pending.browserSecret === readCookie(request, OAUTH_COOKIE))
      if (!code || !pending || !sameBrowser) {
        fail('expired')
        return
      }
      let result: AuthResult
      try {
        result = await flow.signIn(code, pending.codeVerifier)
      } catch (error) {
        console.warn('[auth.oauth] sign-in failed', flow.provider, error instanceof Error ? error.message : error)
        fail('failed')
        return
      }
      response.clearCookie(OAUTH_COOKIE, oauthCookieOptions)
      if (pending.client === 'mobile') {
        // The app collects the session once, over HTTPS, instead of reading it off the URL.
        const handoff = await oauthStore.holdSession({
          accessToken: result.token,
          refreshToken: result.refreshToken ?? '',
          expiresAt: result.expiresAt.getTime(),
        })
        response.redirect(303, withParam(pending.redirectTo, 'fitsy_code', handoff))
        return
      }
      setSessionCookies(response, result, cookieOptions)
      response.redirect(303, pending.redirectTo)
    } catch (error) {
      next(error)
    }
  }

  for (const flow of flows) {
    router.get('/oauth/' + flow.provider, loginIpLimit, (request, response, next) => { beginSignIn(flow, request, response).catch(next) })
    router.get(flow.callbackPath, (request, response, next) => completeSignIn(flow, request, response, next))
  }
  // A provider that is not configured answers instead of 404ing: the button is hidden,
  // but bookmarks and already-loaded pages still point here.
  for (const provider of OAUTH_PROVIDER_NAMES) {
    if (enabled(provider)) continue
    router.get('/oauth/' + provider, (_request, response) => {
      response.redirect(303, '/?auth_error=' + provider + '_unavailable')
    })
  }

  /** Mobile only: trades the one-time hand-off code for the session it belongs to. */
  router.post('/oauth/session', async (request, response, next) => {
    try {
      const session = await oauthStore.claimSession(typeof request.body?.code === 'string' ? request.body.code : null)
      if (!session) {
        response.status(400).json({ message: 'Phiên đăng nhập đã hết hạn. Vui lòng thử lại.', code: 'oauth_code_expired' })
        return
      }
      response.json(session)
    } catch (error) {
      next(error)
    }
  })

  router.post('/register', registerLimit, async (request, response, next) => {
    try {
      const result = await auth.register({
        email: typeof request.body.email === 'string' ? request.body.email : '',
        displayName: typeof request.body.displayName === 'string' ? request.body.displayName : '',
        password: typeof request.body.password === 'string' ? request.body.password : '',
        legacyClaimToken: request.get('x-legacy-data-claim-token'),
      })
      setSessionCookies(response, result, cookieOptions)
      response.status(201).json({ user: decorate ? await decorate(result.user) : result.user })
    } catch (error) {
      next(error)
    }
  })

  router.post('/login', loginIpLimit, loginAccountLimit, async (request, response, next) => {
    try {
      const email = typeof request.body.email === 'string' ? request.body.email : ''
      const result = await auth.login(
        email,
        typeof request.body.password === 'string' ? request.body.password : '',
      )
      const account = rateLimitIdentity.account(email)[0]
      if (account) await rateLimits.reset(buildRateLimitKey('auth.login.account', account))
      setSessionCookies(response, result, cookieOptions)
      response.json({ user: decorate ? await decorate(result.user) : result.user })
    } catch (error) {
      next(error)
    }
  })

  router.post('/resend-confirmation', resendConfirmationIpLimit, resendConfirmationAccountLimit, async (request, response, next) => {
    try {
      if (!auth.resendSignupConfirmation) {
        throw new AuthError(501, 'Xác minh email chưa được bật ở môi trường này.')
      }
      const email = typeof request.body.email === 'string' ? request.body.email : ''
      await auth.resendSignupConfirmation(email)
      response.status(202).json({
        message: 'Đã yêu cầu gửi lại. Hãy kiểm tra cả Hộp thư đến và Thư rác trong ít phút.',
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/forgot-password', resetIpLimit, resetAccountLimit, async (request, response, next) => {
    try {
      if (!auth.requestPasswordReset) throw new AuthError(501, 'Khôi phục mật khẩu chưa được bật ở môi trường này.')
      const email = typeof request.body.email === 'string' ? request.body.email : ''
      await auth.requestPasswordReset(email)
      // Luôn dùng thông báo chung để không tiết lộ email có tồn tại trong hệ thống hay không.
      response.status(202).json({
        message: 'Nếu email tồn tại, bạn sẽ nhận được liên kết đặt lại mật khẩu trong ít phút.',
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/reset-password', resetIpLimit, async (request, response, next) => {
    try {
      if (!auth.resetPassword) throw new AuthError(501, 'Khôi phục mật khẩu chưa được bật ở môi trường này.')
      const result = await auth.resetPassword({
        accessToken: typeof request.body.accessToken === 'string' ? request.body.accessToken : '',
        refreshToken: typeof request.body.refreshToken === 'string' ? request.body.refreshToken : '',
        password: typeof request.body.password === 'string' ? request.body.password : '',
      })
      setSessionCookies(response, result, cookieOptions)
      response.json({ user: decorate ? await decorate(result.user) : result.user })
    } catch (error) {
      next(error)
    }
  })

  router.get('/me', async (request, response, next) => {
    try {
      const user = await resolveUser(auth, request, response, cookieOptions, decorate)
      if (!user) {
        response.status(401).json({ message: 'Chưa đăng nhập.' })
        return
      }
      response.json({ user })
    } catch (error) {
      next(error)
    }
  })

  router.put('/profile', async (request, response, next) => {
    try {
      const user = await resolveUser(auth, request, response, cookieOptions, decorate)
      if (!user) {
        response.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục.', code: 'authentication_required' })
        return
      }
      if (!auth.updateProfile) {
        throw new AuthError(501, 'Chức năng cập nhật hồ sơ chưa được hỗ trợ.')
      }
      const displayName = typeof request.body.displayName === 'string' ? request.body.displayName : ''
      const token = readAccessToken(request)
      const updated = await auth.updateProfile(user.id, { displayName }, token)
      response.json({ user: decorate ? await decorate(updated) : updated })
    } catch (error) {
      next(error)
    }
  })

  router.post('/change-password', async (request, response, next) => {
    try {
      const user = await resolveUser(auth, request, response, cookieOptions, decorate)
      if (!user) {
        response.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục.', code: 'authentication_required' })
        return
      }
      if (!auth.changePassword) {
        throw new AuthError(501, 'Chức năng đổi mật khẩu chưa được hỗ trợ.')
      }
      const currentPassword = typeof request.body.currentPassword === 'string' ? request.body.currentPassword : ''
      const newPassword = typeof request.body.newPassword === 'string' ? request.body.newPassword : ''
      const token = readAccessToken(request)
      await auth.changePassword(user.id, { currentPassword, newPassword }, token)
      response.json({ message: 'Đổi mật khẩu thành công.' })
    } catch (error) {
      next(error)
    }
  })

  router.post('/change-email', async (request, response, next) => {
    try {
      const user = await resolveUser(auth, request, response, cookieOptions, decorate)
      if (!user) {
        response.status(401).json({ message: 'Vui lòng đăng nhập để tiếp tục.', code: 'authentication_required' })
        return
      }
      if (!auth.changeEmail) {
        throw new AuthError(501, 'Chức năng đổi email chưa được hỗ trợ.')
      }
      const newEmail = typeof request.body.newEmail === 'string' ? request.body.newEmail : ''
      const password = typeof request.body.password === 'string' ? request.body.password : ''
      const token = readAccessToken(request)
      const updated = await auth.changeEmail(user.id, { newEmail, password }, token)
      response.json({ user: decorate ? await decorate(updated) : updated, message: 'Đổi email thành công.' })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/account', async (request, response, next) => {
    try {
      const user = await resolveUser(auth, request, response, cookieOptions, decorate)
      if (!user) throw new AuthError(401, 'Vui lòng đăng nhập để tiếp tục.')
      if (request.body?.confirmation !== 'DELETE') {
        throw new AuthError(400, 'Vui lòng xác nhận xóa tài khoản.')
      }
      if (!auth.deleteAccount) throw new AuthError(501, 'Xóa tài khoản chưa được hỗ trợ.')
      const token = readAccessToken(request)
      if (deleteAccountData) await deleteAccountData(user, token)
      else await auth.deleteAccount(user.id, token)
      response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' })
      response.clearCookie(REFRESH_COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' })
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  router.post('/logout', async (request, response, next) => {
    try {
      await auth.logout(readAccessToken(request))
    } catch (error) {
      next(error)
      return
    }
    response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' })
    response.clearCookie(REFRESH_COOKIE, { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' })
    response.status(204).end()
  })

  return router
}
