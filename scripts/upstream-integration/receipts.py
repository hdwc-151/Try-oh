# This script uses the same editor helpers as resolve.py.
store = 'server/services/generation-requests.ts'
edit(store, '  complete(userId: string, key: string, status: number, body: unknown): Promise<void>', '''  find(userId: string, key: string): Promise<GenerationRequest | null>
  complete(userId: string, key: string, status: number, body: unknown): Promise<void>''')
edit(store, '  async deleteUser(userId: string) {\n    for (const key', '''  async find(userId: string, key: string) {
    const entry = this.entries.get(JSON.stringify([userId, key]))
    return entry && entry.expires > Date.now() ? entry : null
  }
  async deleteUser(userId: string) {
    for (const key''')
edit(store, "  async deleteUser(userId: string) { this.db.prepare", '''  async find(userId: string, key: string): Promise<GenerationRequest | null> {
    const row = this.db.prepare('SELECT fingerprint, status, response_json FROM generation_requests WHERE user_id = ? AND request_key = ? AND expires_at > ?')
      .get(userId, key, Date.now()) as { fingerprint: string; status: number | null; response_json: string | null } | undefined
    return row ? { fingerprint: row.fingerprint, status: row.status, body: row.response_json === null ? null : JSON.parse(row.response_json) } : null
  }
  async deleteUser(userId: string) { this.db.prepare''')
edit(store, "  async deleteUser(userId: string) { await this.pool.query", '''  async find(userId: string, key: string): Promise<GenerationRequest | null> {
    const { rows } = await this.pool.query<GenerationRequest>(
      'SELECT fingerprint, status, response_json AS body FROM public.generation_requests WHERE user_id = $1 AND request_key = $2 AND expires_at > now()',
      [userId, key],
    )
    return rows[0] ?? null
  }
  async deleteUser(userId: string) { await this.pool.query''')

router = 'server/http/generation-idempotency.ts'
write(router, read(router) + r'''
/** Look up the receipt for this account without reserving another generation. */
export const generationReceipt = (store: GenerationRequestStore): RequestHandler => async (request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  const key = request.get('Idempotency-Key')
  if (!key || !/^[a-zA-Z0-9_-]{8,128}$/.test(key)) {
    response.status(400).json({ code: 'idempotency_key_required', message: 'Mã yêu cầu tạo ảnh không hợp lệ.' })
    return
  }
  try {
    const receipt = await store.find(request.authUser.id, key)
    if (!receipt) {
      response.status(404).json({ code: 'generation_receipt_not_found', message: 'Chưa tìm thấy yêu cầu tạo ảnh.' })
    } else if (receipt.status === null) {
      response.setHeader('Retry-After', '3')
      response.status(202).json({ status: null })
    } else {
      response.json({ status: receipt.status, body: receipt.body })
    }
  } catch (error) {
    next(error)
  }
}
''')
edit('server/app.ts', 'import { generationIdempotency }', 'import { generationIdempotency, generationReceipt }')
edit('server/app.ts', "  app.post('/api/generations/angles/:angle', requireAuth, generationIdempotency(generationRequests))", """  app.get('/api/generations/receipt', requireAuth, generationReceipt(generationRequests))
  app.post('/api/generations/angles/:angle', requireAuth, generationIdempotency(generationRequests))""")
test = 'server/http/generation-idempotency.test.ts'
edit(test, 'import { generationIdempotency }', 'import { generationIdempotency, generationReceipt }')
edit(test, "    app.post('/generate', generationIdempotency(new MemoryGenerationRequestStore()),", """    const store = new MemoryGenerationRequestStore()
    app.get('/generate', generationReceipt(store))
    app.post('/generate', generationIdempotency(store),""")
edit(test, "    try {\n      const pending = send()", """    const readReceipt = (user = 'user-a') => fetch(url, {
      headers: { 'Idempotency-Key': 'request-0001', 'X-Test-User': user },
    })
    try {
      const pending = send()""")
edit(test, '      expect(calls).toBe(1)\n      resolve()', """      expect(calls).toBe(1)
      expect((await readReceipt()).status).toBe(202)
      expect((await readReceipt('user-b')).status).toBe(404)
      resolve()""")
edit(test, '      const originalBody = await original.json()', """      const originalBody = await original.json()
      const receipt = await readReceipt()
      expect(receipt.headers.get('Cache-Control')).toBe('no-store')
      expect(await receipt.json()).toEqual({ status: 200, body: originalBody })""")

web = 'src/services/try-on-api.ts'
edit(web, 'const generationRequests = new Map<string, Promise<GeneratedTryOnResult>>()', '''const generationRequests = new Map<string, Promise<GeneratedTryOnResult>>()
type GenerationReceipt = { status: number | null; body?: GeneratedTryOnResult & { message?: string } }

async function readGenerationReceipt(key: string): Promise<GenerationReceipt | null> {
  for (const delay of [2_000, 6_000, 12_000, 20_000]) {
    await new Promise(resolve => setTimeout(resolve, delay))
    const receipt = await apiFetch('/api/generations/receipt', {
      headers: { 'Idempotency-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(5_000),
    })
      .then(async response => response.status === 200 ? await response.json() as GenerationReceipt : null)
      .catch(() => null)
    if (receipt && Number.isInteger(receipt.status) && receipt.body) return receipt
  }
  return null
}''')
replace_range(web, '  /** Bỏ cache danh sách outfit', '  clearCache:')
edit(web, 'generationKeys.get(fingerprint) ?? crypto.randomUUID()', '''generationKeys.get(fingerprint) ?? (crypto.randomUUID?.()
      ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''))''')
replace_range(web, '      // Network failures retain the key', '    }\n    const request = run()', '''      try {
        const response = await apiFetch('/api/generations/angles/' + angle, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify({ garmentIds, privacyConfirmed, preservePose, keepBackground }),
        })
        if (response.ok) {
          const result = await response.json() as GeneratedTryOnResult
          generationKeys.delete(fingerprint)
          if (epoch === outfitsEpoch) invalidateOutfits()
          return result
        }
        const problem = await response.json().catch(() => ({})) as { message?: string; code?: string }
        if (response.status < 500 && problem.code !== 'generation_in_progress') {
          generationKeys.delete(fingerprint)
          throw new Error(problem.message ?? 'Không thể tạo ảnh.')
        }
      } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error
      }
      const receipt = await readGenerationReceipt(key)
      if (receipt?.status == null || !receipt.body) {
        throw new Error('Chưa xác nhận được kết quả. Hãy kiểm tra mục Outfit hoặc thử lại cùng lựa chọn.')
      }
      generationKeys.delete(fingerprint)
      if (receipt.status >= 300) throw new Error(receipt.body.message ?? 'Không thể tạo ảnh.')
      if (epoch === outfitsEpoch) invalidateOutfits()
      return receipt.body
''')
hook = 'src/features/fitting-room/useTryOnGeneration.ts'
replace_range(hook, '/** Lúc mất kết nối', 'const createInitialState')
edit(hook, '    const startedAt = Date.now()\n', '')
replace_range(hook, '      if (isNetworkFailure(error)) {', '      setStates((current) => ({\n        ...current,\n        [angle]', "      const message = error instanceof Error ? error.message : 'Không thể tạo ảnh.'\n")

mobile = 'mobile/src/services/generation-api.ts'
edit(mobile, 'const receipts = new Map<string, { key: string; request?: Promise<GenerationResult> }>();', '''const receipts = new Map<string, { key: string; request?: Promise<GenerationResult> }>();
type GenerationReceipt = { status: number | null; body?: GenerationResult & { message?: string; code?: string } };

async function readGenerationReceipt(key: string) {
  for (const delay of [2_000, 6_000, 12_000, 20_000]) {
    await new Promise(resolve => setTimeout(resolve, delay));
    const receipt = await apiRequest<GenerationReceipt>('/api/generations/receipt', {
      headers: { 'Idempotency-Key': key }, timeoutMs: 5_000,
    }).catch(() => null);
    if (receipt && Number.isInteger(receipt.status) && receipt.body) return receipt;
  }
  return null;
}''')
edit(mobile, """      if (error instanceof ApiError && error.status > 0 && error.code !== 'generation_in_progress') receipts.delete(fingerprint);
      throw error;""", """      if (error instanceof ApiError && error.status > 0 && error.status < 500 && error.code !== 'generation_in_progress') {
        receipts.delete(fingerprint);
        throw error;
      }
      const recovered = await readGenerationReceipt(entry.key);
      if (recovered?.status == null || !recovered.body) {
        throw new ApiError('Chưa xác nhận được kết quả. Hãy kiểm tra mục Outfit hoặc thử lại cùng lựa chọn.', 0, 'generation_unconfirmed');
      }
      receipts.delete(fingerprint);
      if (recovered.status >= 300) throw new ApiError(recovered.body.message ?? 'Không thể tạo ảnh.', recovered.status, recovered.body.code);
      return recovered.body;""")
