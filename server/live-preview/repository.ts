import type { MaybePromise } from '../storage/maybe-promise.js'
import type { LivePreviewSessionRecord, NewLivePreviewSession } from './types.js'

/** One counted session: when it started and how many quota sessions it used. */
export type LivePreviewUsage = { createdAt: string; cost: number }

export interface LivePreviewRepository {
  /** Sessions created after `since`, oldest first. */
  listUsageSince(userId: string, since: Date): MaybePromise<LivePreviewUsage[]>
  /**
   * Atomically records a session if the cost already used after `since` plus this
   * session's cost stays within `limit`; `limit === null` means unlimited.
   * Returns null when the quota is used up.
   */
  tryCreate(session: NewLivePreviewSession, limit: number | null, since: Date): MaybePromise<LivePreviewSessionRecord | null>
  /**
   * Counts one more Decart token against the session if it was created after
   * `createdAfter` and has issued fewer than `maxTokens`. Returns the updated session.
   */
  tryIssueToken(userId: string, sessionId: string, maxTokens: number, createdAfter: Date): MaybePromise<LivePreviewSessionRecord | null>
  /** Undoes `tryIssueToken` after Decart refused to mint the token. */
  releaseToken(userId: string, sessionId: string): MaybePromise<void>
  /** Removes a session that never received a token (refund). */
  deleteUnused(userId: string, sessionId: string): MaybePromise<void>
  close(): MaybePromise<void>
}

export class MemoryLivePreviewRepository implements LivePreviewRepository {
  private readonly sessions = new Map<string, LivePreviewSessionRecord>()

  listUsageSince(userId: string, since: Date): LivePreviewUsage[] {
    return [...this.sessions.values()]
      .filter(item => item.userId === userId && new Date(item.createdAt) > since)
      .map(item => ({ createdAt: item.createdAt, cost: item.cost }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  tryCreate(session: NewLivePreviewSession, limit: number | null, since: Date): LivePreviewSessionRecord | null {
    const used = this.listUsageSince(session.userId, since).reduce((sum, item) => sum + item.cost, 0)
    if (limit !== null && used + session.cost > limit) return null
    const record: LivePreviewSessionRecord = { ...session, tokensIssued: 0, createdAt: new Date().toISOString() }
    this.sessions.set(record.id, record)
    return { ...record }
  }

  tryIssueToken(userId: string, sessionId: string, maxTokens: number, createdAfter: Date): LivePreviewSessionRecord | null {
    const record = this.sessions.get(sessionId)
    if (!record || record.userId !== userId || record.tokensIssued >= maxTokens || new Date(record.createdAt) <= createdAfter) return null
    record.tokensIssued += 1
    return { ...record }
  }

  releaseToken(userId: string, sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (record && record.userId === userId && record.tokensIssued > 0) record.tokensIssued -= 1
  }

  deleteUnused(userId: string, sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (record && record.userId === userId && record.tokensIssued === 0) this.sessions.delete(sessionId)
  }

  close(): void { this.sessions.clear() }
}
