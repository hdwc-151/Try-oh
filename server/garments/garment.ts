export const GARMENT_CATEGORIES = ['tops', 'outerwear', 'bottoms', 'shoes', 'accessories'] as const

export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number]

export type GarmentRecord = {
  id: string
  userId: string
  name: string
  category: GarmentCategory
  frontOriginalKey: string
  frontProcessedKey: string
  backOriginalKey: string | null
  backProcessedKey: string | null
  createdAt: string
}

export type GarmentResponse = {
  id: string
  name: string
  category: GarmentCategory
  frontOriginalUrl: string
  frontProcessedUrl: string
  backOriginalUrl: string | null
  backProcessedUrl: string | null
  createdAt: string
}

export type UpdateGarmentInput = {
  name?: string
  category?: GarmentCategory
}
