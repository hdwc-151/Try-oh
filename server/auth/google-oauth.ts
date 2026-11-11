import { createHash, randomBytes } from 'node:crypto'
import { AuthError } from './auth-service.js'

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REQUEST_TIMEOUT_MS = 10_000

export type GoogleOAuthConfig = {
  clientId: string
  clientSecret: string
  /** Must match an Authorized redirect URI of the Google OAuth client, exactly. */
  redirectUri: string
  fetchImpl?: typeof fetch
}

/**
 * Google's own authorization-code flow, run by this server rather than by Supabase.
 * Google then shows "continue to <our domain>" instead of the Supabase project host,
 * and the resulting ID token is traded for a Supabase session (`signInWithIdToken`).
 *
 * No `nonce` is requested: the code is redeemed over a back channel with the client
 * secret and a PKCE verifier, which is what binds the token to this login attempt.
 */
export class GoogleOAuth {
  private readonly fetch: typeof fetch

  constructor(private readonly config: GoogleOAuthConfig) {
    const fetchImpl = config.fetchImpl ?? fetch
    this.fetch = (input, init) => fetchImpl(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }

  get redirectUri(): string {
    return this.config.redirectUri
  }

  /** The PKCE secret for one sign-in; it stays on this server until the code comes back. */
  createVerifier(): string {
    return randomBytes(48).toString('base64url')
  }

  authorizationUrl(state: string, codeVerifier: string): string {
    const url = new URL(AUTHORIZE_ENDPOINT)
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', createHash('sha256').update(codeVerifier).digest('base64url'))
    url.searchParams.set('code_challenge_method', 'S256')
    // Let people pick an account instead of silently reusing the one Google remembers.
    url.searchParams.set('prompt', 'select_account')
    return url.toString()
  }

  /** Redeems the authorization code and returns Google's ID token (a signed JWT). */
  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    let response: Response
    try {
      response = await this.fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }).toString(),
      })
    } catch {
      throw new AuthError(502, 'Không kết nối được tới Google. Vui lòng thử lại sau.')
    }
    const body = await response.json().catch(() => null) as { id_token?: string; error?: string; error_description?: string } | null
    if (!response.ok || !body?.id_token) {
      console.warn('[auth.google] token exchange failed', { status: response.status, error: body?.error, description: body?.error_description })
      throw new AuthError(400, 'Không thể đăng nhập bằng Google. Vui lòng thử lại.')
    }
    return body.id_token
  }
}

export const createGoogleOAuth = (redirectUri: string, fetchImpl?: typeof fetch): GoogleOAuth | null => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return new GoogleOAuth({ clientId, clientSecret, redirectUri, fetchImpl })
}
