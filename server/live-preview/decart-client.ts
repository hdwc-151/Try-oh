/**
 * Minimal server-side client for Decart's client-token endpoint. The permanent
 * key (`dct_...`) never leaves this process: browsers and the mobile app only
 * receive short-lived tokens bound to one model and a hard session length.
 */
export type DecartTokenRequest = {
  model: string
  maxSessionSeconds: number
  expiresInSeconds: number
  allowedOrigins?: string[]
  metadata: Record<string, string>
}

export type DecartToken = { apiKey: string; expiresAt: string }

export interface DecartTokenIssuer {
  createToken(request: DecartTokenRequest): Promise<DecartToken>
}

class DecartTokenError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

// Decart resolves `*-latest` aliases on its side; allow the canonical name too so a
// token keeps working whichever name the gateway checks.
const allowedModelNames = (model: string) =>
  model === 'lucy-vton-latest' ? ['lucy-vton-latest', 'lucy-vton-3.6'] : [model]

export class DecartHttpTokenIssuer implements DecartTokenIssuer {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.decart.ai',
    private readonly timeoutMs = 10_000,
  ) {}

  async createToken(request: DecartTokenRequest): Promise<DecartToken> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/v1/client/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({
          expiresIn: request.expiresInSeconds,
          allowedModels: allowedModelNames(request.model),
          ...(request.allowedOrigins?.length ? { allowedOrigins: request.allowedOrigins } : {}),
          constraints: { realtime: { maxSessionDuration: request.maxSessionSeconds } },
          metadata: request.metadata,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new DecartTokenError(error instanceof Error ? error.message : 'Decart request failed')
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      throw new DecartTokenError(`Decart token request failed: ${response.status} ${detail}`, response.status)
    }
    const body = await response.json().catch(() => null) as { apiKey?: unknown; expiresAt?: unknown } | null
    if (!body || typeof body.apiKey !== 'string' || !body.apiKey) throw new DecartTokenError('Decart token response has no apiKey')
    return {
      apiKey: body.apiKey,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : new Date(Date.now() + request.expiresInSeconds * 1000).toISOString(),
    }
  }
}
