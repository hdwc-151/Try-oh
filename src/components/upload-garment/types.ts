import type { GarmentCategory } from '../../types/fitting-room'

export type ExtractedGarmentCard = {
  id: string
  category: GarmentCategory
  name: string
  description: string
  blob: Blob
  previewUrl: string
  selected: boolean
}

export type GarmentZoomImage = {
  url: string
  title: string
}
