import { applyOutfitCustomizations, removeOutfitCustomization } from './outfit-customizations'
import type { CreditStatus, GeneratedTryOnResult, SavedOutfit, TryOnAngle, TryOnResult } from '../types/fitting-room'
import { apiFetch } from './api-client'

const OUTFIT_CACHE_TTL_MS = 10_000
let cachedOutfits: SavedOutfit[] | null = null
let outfitsExpireAt = 0
let outfitsRequest: Promise<SavedOutfit[]> | null = null
let outfitsEpoch = 0
const generationKeys = new Map<string, string>()
const generationRequests = new Map<string, Promise<GeneratedTryOnResult>>()
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
}

const invalidateOutfits = () => {
  outfitsEpoch += 1
  cachedOutfits = null
  outfitsExpireAt = 0
  outfitsRequest = null
}

const parseError = async (response: Response) => {
  try {
    const data = await response.json() as { message?: string }
    return data.message ?? 'Không thể tạo ảnh.'
  } catch {
    return 'Không thể tạo ảnh.'
  }
}

export const tryOnApi = {
  clearCache: () => {
    generationKeys.clear()
    generationRequests.clear()
    invalidateOutfits()
    outfitsRequest = null
  },
  async listResults(): Promise<TryOnResult[]> {
    const response = await fetch('/api/generations/results')
    if (!response.ok) throw new Error(await parseError(response))
    return ((await response.json()) as { items: TryOnResult[] }).items
  },

  async getCredits(): Promise<CreditStatus> {
    const response = await apiFetch('/api/generations/credits', { cache: 'no-store' })
    if (!response.ok) throw new Error(await parseError(response))
    return response.json() as Promise<CreditStatus>
  },

  async generateAngle(angle: TryOnAngle, garmentIds: string[], preservePose = true, privacyConfirmed = false, keepBackground = false): Promise<GeneratedTryOnResult> {
    const fingerprint = JSON.stringify([angle, garmentIds, preservePose, privacyConfirmed, keepBackground])
    const pending = generationRequests.get(fingerprint)
    if (pending) return pending
    const key = generationKeys.get(fingerprint) ?? (crypto.randomUUID?.()
      ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''))
    generationKeys.set(fingerprint, key)
    const epoch = outfitsEpoch
    const run = async () => {
      try {
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
    }
    const request = run()
    generationRequests.set(fingerprint, request)
    try { return await request }
    finally { if (generationRequests.get(fingerprint) === request) generationRequests.delete(fingerprint) }
  },

  async listOutfits(options?: { force?: boolean }): Promise<SavedOutfit[]> {
    if (!options?.force && cachedOutfits && Date.now() < outfitsExpireAt) {
      return applyOutfitCustomizations(cachedOutfits)
    }
    if (!outfitsRequest) {
      const epoch = outfitsEpoch
      const pending = fetch('/api/generations/outfits')
        .then(async (response) => {
          if (!response.ok) throw new Error(await parseError(response))
          const items = ((await response.json()) as { items: SavedOutfit[] }).items
          if (epoch === outfitsEpoch) {
            cachedOutfits = items
            outfitsExpireAt = Date.now() + OUTFIT_CACHE_TTL_MS
          }
          return items
        })
      outfitsRequest = pending
      const clearPending = () => { if (outfitsRequest === pending) outfitsRequest = null }
      void pending.then(clearPending, clearPending)
    }
    return applyOutfitCustomizations(await outfitsRequest)
  },

  async deleteOutfit(id: string): Promise<void> {
    const epoch = outfitsEpoch
    const response = await apiFetch(`/api/generations/outfits/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error(await parseError(response))
    if (epoch === outfitsEpoch) {
      const current = cachedOutfits
      invalidateOutfits()
      if (current) {
        cachedOutfits = current.filter((item) => item.id !== id)
        outfitsExpireAt = Date.now() + OUTFIT_CACHE_TTL_MS
      }
    }
    removeOutfitCustomization(id)
  },
}
