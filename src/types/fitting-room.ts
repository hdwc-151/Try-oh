export type GarmentCategory = 'tops' | 'outerwear' | 'bottoms' | 'shoes' | 'accessories'

export type Garment = {
  id: string
  name: string
  category: GarmentCategory
  frontOriginalUrl: string
  frontProcessedUrl: string
  backOriginalUrl: string | null
  backProcessedUrl: string | null
  createdAt: string
}

export type OutfitSelection = {
  tops: string | null
  outerwear: string | null
  bottoms: string | null
  shoes: string | null
  accessories: string[]
}

export const MAX_SELECTED_GARMENTS = 8
export const MAX_WARDROBE_GARMENTS = 20
export const MAX_SAVED_OUTFITS = 10

export type PersonImage = {
  id: 'current'
  imageUrl: string
  width: number
  height: number
  warnings: string[]
  createdAt: string
}

export type TryOnAngle = 'front' | 'back'

export type TryOnResult = {
  angle: TryOnAngle
  imageUrl: string
  createdAt: string
}

export type CreditStatus = {
  remaining: number | null
  limit: number
  unlimited: boolean
}

export type GeneratedTryOnResult = TryOnResult & {
  credits: CreditStatus
}

export type SavedOutfit = {
  id: string
  frontImageUrl: string
  backImageUrl: string | null
  garmentIds: string[]
  createdAt: string
}

export type AngleGenerationState = {
  status: 'idle' | 'loading' | 'success' | 'error'
  result: TryOnResult | null
  error: string | null
}

export const garmentCategoryLabels: Record<GarmentCategory, string> = {
  tops: 'Áo trong',
  outerwear: 'Áo khoác',
  bottoms: 'Quần',
  shoes: 'Giày',
  accessories: 'Phụ kiện',
}
