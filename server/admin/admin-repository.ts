import type { PublicUser } from '../auth/auth-store.js'
import type { MaybePromise } from '../storage/maybe-promise.js'
import type { AdminAuditEntry, AdminSummary, AdminUser, SubscriptionPlanId, UserRole, UserStatus } from './types.js'

export interface AdminRepository {
  syncUser(user: PublicUser, bootstrapAdmin: boolean): MaybePromise<AdminUser>
  listUsers(query: { search?: string; role?: UserRole; status?: UserStatus }): MaybePromise<AdminUser[]>
  getUser(id: string): MaybePromise<AdminUser | null>
  updateUser(id: string, changes: { role?: UserRole; status?: UserStatus; creditBalance?: number; subscriptionPlan?: SubscriptionPlanId }, actorId?: string): MaybePromise<AdminUser | null>
  countAdmins(): MaybePromise<number>
  summary(): MaybePromise<AdminSummary>
  addAudit(entry: AdminAuditEntry): MaybePromise<void>
  listAudit(limit: number): MaybePromise<AdminAuditEntry[]>
  close(): MaybePromise<void>
}
