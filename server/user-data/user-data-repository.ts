import type { PersonImageRecord } from './person-image.js'
import type { SavedOutfitRecord } from './saved-outfit.js'
import type { TryOnResultRecord } from './try-on-result.js'
import type { MaybePromise } from '../storage/maybe-promise.js'
import type { ListOptions } from '../http/pagination.js'

export type DeletedUserData = {
  personImageKey: string | null
  resultImageKeys: string[]
}

export interface UserDataRepository {
  getPersonImage(userId: string): MaybePromise<PersonImageRecord | null>
  upsertPersonImage(userId: string, record: PersonImageRecord): MaybePromise<string | null>
  deletePersonImage(userId: string): MaybePromise<string | null>
  listTryOnResults(userId: string): MaybePromise<TryOnResultRecord[]>
  upsertTryOnResult(userId: string, record: TryOnResultRecord): MaybePromise<void>
  deleteTryOnResult(userId: string, angle: TryOnResultRecord['angle']): MaybePromise<string | null>
  listSavedOutfits(userId: string, options?: ListOptions): MaybePromise<SavedOutfitRecord[]>
  countSavedOutfits(userId: string): MaybePromise<number>
  findPendingOutfit(userId: string, frontImageUrl: string): MaybePromise<SavedOutfitRecord | null>
  saveOutfit(userId: string, record: SavedOutfitRecord): MaybePromise<void>
  saveOutfitIfBelowLimit(userId: string, record: SavedOutfitRecord, maxItems: number): MaybePromise<boolean>
  deleteSavedOutfit(userId: string, id: string): MaybePromise<SavedOutfitRecord | null>
  isImageKeySaved(userId: string, key: string): MaybePromise<boolean>
  clearAllUserData(userId: string): MaybePromise<DeletedUserData>
  close(): MaybePromise<void>
}
