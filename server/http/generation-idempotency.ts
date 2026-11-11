import { createHash } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { GenerationRequestStore } from '../services/generation-requests.js'

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}

export const generationIdempotency = (store: GenerationRequestStore): RequestHandler => async (request, response, next) => {
  const key = request.get('Idempotency-Key')
  if (!key || !/^[a-zA-Z0-9_-]{8,128}$/.test(key)) {
    response.status(400).json({ code: 'idempotency_key_required', message: 'Thiếu mã yêu cầu tạo ảnh. Hãy cập nhật ứng dụng và thử lại.' })
    return
  }
  const userId = request.authUser.id
  const fingerprint = createHash('sha256').update(request.method + ':' + request.path + ':' + canonical(request.body)).digest('hex')
  try {
    const claim = await store.claim(userId, key, fingerprint)
    if (!claim.claimed) {
      if (claim.previous.fingerprint !== fingerprint) {
        response.status(409).json({ code: 'idempotency_conflict', message: 'Mã yêu cầu đã được dùng cho dữ liệu khác.' })
      } else if (claim.previous.status === null) {
        response.setHeader('Retry-After', '3')
        response.status(409).json({ code: 'generation_in_progress', message: 'Yêu cầu này đã được nhận. Kiểm tra kết quả trước khi tạo lại.' })
      } else {
        response.setHeader('Idempotency-Replayed', 'true')
        response.status(claim.previous.status).json(claim.previous.body)
      }
      return
    }
    const sendJson = response.json.bind(response)
    let sending = false
    response.json = ((body: unknown) => {
      if (sending) return response
      sending = true
      const status = response.statusCode
      // Save BEFORE acknowledging the result. A restart must not turn a retry
      // into a second charge. If persistence fails, leave the pending tombstone.
      void store.complete(userId, key, status, body).then(() => {
        response.json = sendJson
        if (!response.destroyed) sendJson(body)
      }).catch((error: unknown) => {
        response.json = sendJson
        next(error)
      })
      return response
    }) as typeof response.json
    next()
  } catch (error) {
    next(error)
  }
}
