export const TRY_ON_ANGLES = ['front', 'back'] as const
export type TryOnAngle = (typeof TRY_ON_ANGLES)[number]

export type GarmentPromptInfo = {
  name: string
  category: string
}

export type GenerateImageInput = {
  personImageUrl: string
  garmentImageUrls: string[]
  garments?: GarmentPromptInfo[]
  angle: TryOnAngle
  referenceImageUrl?: string
  preservePose?: boolean
}

export type GeneratedImage = {
  imageUrl: string
  storageKey?: string
}

export interface ImageProvider {
  generate(input: GenerateImageInput): Promise<GeneratedImage>
}
