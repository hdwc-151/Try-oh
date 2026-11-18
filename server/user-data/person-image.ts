export type PersonImageRecord = {
  id: 'current'
  imageKey: string
  width: number
  height: number
  warnings: string[]
  createdAt: string
}

export type PersonImageResponse = {
  id: 'current'
  imageUrl: string
  width: number
  height: number
  warnings: string[]
  createdAt: string
}
