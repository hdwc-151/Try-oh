export type UserRole = 'user' | 'koc' | 'moderator' | 'admin'
export type UserStatus = 'active' | 'suspended'
export type SubscriptionPlanId = 'free' | 'plus' | 'pro' | 'max'

export type AdminUser = {
  id: string
  email: string
  displayName: string
  role: UserRole
  status: UserStatus
  creditBalance: number
  subscriptionPlan: SubscriptionPlanId
  createdAt: string
  lastSeenAt: string | null
}

export type AdminAuditEntry = {
  id: string
  actorId: string
  actorEmail: string
  action: 'user.role_changed' | 'user.status_changed' | 'user.credits_changed' | 'user.plan_changed' | 'user.posts_hidden' | 'report.resolved' | 'report.dismissed'
  targetId: string
  details: Record<string, string>
  createdAt: string
}

export type AdminSummary = {
  users: number
  activeUsers: number
  suspendedUsers: number
  kocUsers: number
  moderators: number
  admins: number
}
