import { apiFetch } from './api-client'
import type { LivePreviewStartRequest, LivePreviewStartResponse, LivePreviewStatus, LivePreviewToken } from '../types/live-preview'

export class LivePreviewApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

const readJson = async <T>(response: Response, fallback: string): Promise<T> => {
  const body = await response.json().catch(() => null) as (T & { message?: string; code?: string }) | null
  if (!response.ok) throw new LivePreviewApiError(body?.message ?? fallback, response.status, body?.code)
  return body as T
}

export const livePreviewApi = {
  async status(): Promise<LivePreviewStatus> {
    return readJson(await fetch('/api/live-preview/status', { cache: 'no-store' }), 'Không thể tải trạng thái thử trực tiếp.')
  },
  async start(input: LivePreviewStartRequest): Promise<LivePreviewStartResponse> {
    return readJson(await apiFetch('/api/live-preview/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }), 'Không thể bắt đầu phiên thử trực tiếp.')
  },
  async token(sessionId: string): Promise<LivePreviewToken> {
    return readJson(await apiFetch(`/api/live-preview/sessions/${encodeURIComponent(sessionId)}/token`, { method: 'POST' }), 'Không thể kết nối phiên thử trực tiếp.')
  },
}
