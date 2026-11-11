import type { Garment, GarmentCategory } from '../types/fitting-room'
import { apiFetch } from './api-client'

const GARMENT_CACHE_TTL_MS = 15_000
let cachedGarments: Garment[] | null = null
let garmentsExpireAt = 0
let garmentsRequest: Promise<Garment[]> | null = null
let garmentsEpoch = 0

const rememberGarments = (items: Garment[]) => {
  cachedGarments = items
  garmentsExpireAt = Date.now() + GARMENT_CACHE_TTL_MS
  return items
}

type GarmentListResponse = { items: Garment[] }

export type CreateGarmentInput = {
  name: string
  category: GarmentCategory
  frontOriginal: File
  frontProcessed: Blob
  backOriginal: File | null
  backProcessed: Blob | null
}

const parseError = async (response: Response) => {
  try {
    const data = await response.json() as { message?: string }
    return data.message ?? 'Yêu cầu không thành công.'
  } catch {
    return 'Yêu cầu không thành công.'
  }
}

export type AiExtractedGarment = {
  id: string
  category: GarmentCategory
  name: string
  description: string
  studioImageUrl: string
  isAiGenerated: boolean
}

export type AiExtractResponse = {
  items: AiExtractedGarment[]
}

export const garmentApi = {
  clearCache: () => {
    garmentsEpoch += 1
    cachedGarments = null
    garmentsExpireAt = 0
    garmentsRequest = null
  },
  async list(options?: { force?: boolean }): Promise<Garment[]> {
    if (!options?.force && cachedGarments && Date.now() < garmentsExpireAt) return cachedGarments
    if (!garmentsRequest) {
      const epoch = garmentsEpoch
      const pending = fetch('/api/garments')
        .then(async (response) => {
          if (!response.ok) throw new Error(await parseError(response))
          const items = ((await response.json()) as GarmentListResponse).items
          return epoch === garmentsEpoch ? rememberGarments(items) : items
        })
      garmentsRequest = pending
      const clearPending = () => { if (garmentsRequest === pending) garmentsRequest = null }
      void pending.then(clearPending, clearPending)
    }
    return garmentsRequest
  },

  async aiExtract(
    file: File,
    defaultCategory: GarmentCategory,
    options?: { extractOutfit?: boolean; extractAccessories?: boolean },
  ): Promise<AiExtractResponse> {
    const form = new FormData()
    form.set('file', file)
    form.set('category', defaultCategory)
    if (options?.extractOutfit) {
      form.set('extractOutfit', 'true')
    }
    if (options?.extractAccessories) {
      form.set('extractAccessories', 'true')
    }
    const response = await apiFetch('/api/garments/ai-extract', { method: 'POST', body: form })
    if (!response.ok) throw new Error(await parseError(response))
    return (await response.json()) as AiExtractResponse
  },

  async create(input: CreateGarmentInput): Promise<Garment> {
    const epoch = garmentsEpoch
    const form = new FormData()
    form.set('name', input.name)
    form.set('category', input.category)
    form.set('frontOriginal', input.frontOriginal)
    form.set('frontProcessed', input.frontProcessed, 'front-removed.webp')
    if (input.backOriginal && input.backProcessed) {
      form.set('backOriginal', input.backOriginal)
      form.set('backProcessed', input.backProcessed, 'back-removed.webp')
    }

    const response = await apiFetch('/api/garments', { method: 'POST', body: form })
    if (!response.ok) throw new Error(await parseError(response))
    const garment = await response.json() as Garment
    if (epoch !== garmentsEpoch) return garment
    const current = cachedGarments
    garmentsEpoch += 1
    garmentsRequest = null
    if (current) rememberGarments([garment, ...current])
    return garment
  },

  async update(id: string, input: { name?: string; category?: GarmentCategory }): Promise<Garment> {
    const epoch = garmentsEpoch
    const response = await apiFetch(`/api/garments/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(await parseError(response))
    const garment = await response.json() as Garment
    if (epoch !== garmentsEpoch) return garment
    const current = cachedGarments
    garmentsEpoch += 1
    garmentsRequest = null
    if (current) rememberGarments(current.map((item) => item.id === id ? garment : item))
    return garment
  },

  async delete(id: string): Promise<void> {
    const epoch = garmentsEpoch
    const response = await apiFetch(`/api/garments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error(await parseError(response))
    if (epoch !== garmentsEpoch) return
    const current = cachedGarments
    garmentsEpoch += 1
    garmentsRequest = null
    if (current) rememberGarments(current.filter((item) => item.id !== id))
  },
}
