import type { MaybePromise } from '../storage/maybe-promise.js'
import type { SocialPerson, SocialSnapshot } from './types.js'

export type ModerationReport = {
  id: string
  from: string
  target: string
  reason: string
  createdAt: number
  fromName?: string
  targetName?: string
}

export type ModerationResolution = {
  status?: 'resolved' | 'dismissed'
  note?: string
  actorId?: string
}

export interface SocialService {
  snapshot(userId: string): MaybePromise<SocialSnapshot>
  search(userId: string, query: string): MaybePromise<SocialPerson[]>
  resolveInvite(userId: string, code: string): MaybePromise<SocialPerson>
  profile(userId: string, targetId: string): MaybePromise<unknown>
  trackTemporaryImage(userId: string, key: string): MaybePromise<void>
  canReadImage(userId: string, key: string): MaybePromise<boolean>
  /** Image keys referenced by the user's social content (avatar, posts, polls, temporary images). */
  listUserImageKeys(userId: string): MaybePromise<string[]>
  deleteUserData(userId: string): MaybePromise<string[]>
  moderationReports(): MaybePromise<ModerationReport[]>
  resolveModerationReport(reportId: string, resolution?: ModerationResolution): MaybePromise<boolean>
  /** Hides every post of the user from all feeds; returns the number of posts hidden. */
  hideUserPosts?(userId: string): MaybePromise<number>
  /** Starts periodic background maintenance, when the implementation needs it. */
  startMaintenance?(intervalMs?: number): void
  act(userId: string, action: string, body: Record<string, unknown>): MaybePromise<SocialSnapshot>
  close(): MaybePromise<void>
}
