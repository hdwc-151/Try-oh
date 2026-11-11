import type { TryOnAngle } from '../providers/image-provider.js'

export type TryOnResultRecord = {
  angle: TryOnAngle
  imageUrl: string
  imageKey: string | null
  createdAt: string
}
