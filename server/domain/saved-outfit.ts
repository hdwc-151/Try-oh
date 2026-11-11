export type SavedOutfitRecord = {
  id: string
  frontImageUrl: string
  frontImageKey: string | null
  backImageUrl: string | null
  backImageKey: string | null
  garmentIds: string[]
  createdAt: string
}
