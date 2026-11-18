export type Category =
  | 'top'
  | 'outerwear'
  | 'dress'
  | 'bottom'
  | 'shoes'
  | 'hat'
  | 'bag'
  | 'accessory'

export type ScaleMode = 'fit' | 'relative'
export type Status = 'OK' | 'WARN' | 'REJECT'

export type RGBAImage = {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type BoundingBox = [x: number, y: number, width: number, height: number]

export interface Config {
  canvas: number
  margin: number
  alphaThr: number
  maxTiltDeg: number
  minItemPx: number
  maxInputPx: number
  bgColor: [number, number, number]
  upscaleCap: number
  blurThr: number
  symmetryThr: number
  lowFillThr: number
}

export const DEFAULT_CONFIG: Readonly<Config> = Object.freeze({
  canvas: 1024,
  margin: 0.07,
  alphaThr: 20,
  maxTiltDeg: 15,
  minItemPx: 300,
  maxInputPx: 2048,
  bgColor: [242, 242, 242] as [number, number, number],
  upscaleCap: 2.0,
  blurThr: 60,
  symmetryThr: 0.80,
  lowFillThr: 0.15,
})

export const REL_FACTORS: Readonly<Record<Category, number>> = Object.freeze({
  top: 0.86,
  outerwear: 0.90,
  dress: 0.92,
  bottom: 0.92,
  shoes: 0.50,
  hat: 0.40,
  bag: 0.50,
  accessory: 0.30,
})

export const SYMMETRIC_CATEGORIES = new Set<Category>([
  'top',
  'outerwear',
  'dress',
  'bottom',
  'hat',
])

export interface NormalizeMeta {
  category: Category
  status: Status
  flags: string[]
  needsReview: boolean
  rotationApplied: number
  symmetryScore: number
  scaleFactor: number
  xSymInCanvas: number
  bboxInCanvas: BoundingBox
  anchor: { x: number; y: number }
  timingsMs: Record<string, number>
  originalSize: [width: number, height: number]
  itemSizePx: [width: number, height: number]
  scaleMode: ScaleMode
  sizeCm?: number
  rejectReason?: string
}

export interface NormalizedGarment {
  item: Blob
  itemFlat: Blob
  mask: Blob
  thumb: Blob
  meta: NormalizeMeta
}

export interface CoreNormalizeResult {
  image: RGBAImage
  mask: Uint8Array
  meta: NormalizeMeta
}

export type NormalizeResult = CoreNormalizeResult

export interface NormalizeOptions {
  category: Category
  scaleMode?: ScaleMode
  sizeCm?: number
  manualRotationDeg?: number
  config?: Partial<Config>
}
