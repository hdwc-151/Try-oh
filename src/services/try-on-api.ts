import { applyOutfitCustomizations, removeOutfitCustomization } from './outfit-customizations'
import type { CreditStatus, GeneratedTryOnResult, SavedOutfit, TryOnAngle, TryOnResult } from '../types/fitting-room'
import { apiFetch } from './api-client'

const OUTFIT_CACHE_TTL_MS = 10_000
let cachedOutfits: SavedOutfit[] | null = null
let outfitsExpireAt = 0
let outfitsRequest: Promise<SavedOutfit[]> | null = null
let outfitsEpoch = 0

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

  async generateAngle(angle: TryOnAngle, garmentIds: string[], preservePose = true, privacyConfirmed = false): Promise<GeneratedTryOnResult> {
    const epoch = outfitsEpoch
    const response = await apiFetch(`/api/generations/angles/${angle}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        garmentIds,
        privacyConfirmed,
        preservePose,
      }),
    })
    if (!response.ok) throw new Error(await parseError(response))
    if (epoch === outfitsEpoch) invalidateOutfits()
    return response.json() as Promise<GeneratedTryOnResult>
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
