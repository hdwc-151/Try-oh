import type { GarmentRecord, UpdateGarmentInput } from '../domain/garment.js'
import type { MaybePromise } from './maybe-promise.js'
import type { ListOptions } from '../http/pagination.js'

export interface GarmentRepository {
  list(userId: string, options?: ListOptions): MaybePromise<GarmentRecord[]>
  count(userId: string): MaybePromise<number>
  findById(userId: string, id: string): MaybePromise<GarmentRecord | null>
  create(garment: GarmentRecord): MaybePromise<GarmentRecord>
  createIfBelowLimit(garment: GarmentRecord, maxItems: number): MaybePromise<GarmentRecord | null>
  update(userId: string, id: string, input: UpdateGarmentInput): MaybePromise<GarmentRecord | null>
  delete(userId: string, id: string): MaybePromise<boolean>
  close(): MaybePromise<void>
}
