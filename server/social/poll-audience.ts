import { AuthError } from '../auth/auth-service.js'
import type { SocialProfile } from './types.js'

const fail = (message: string, code = 400): never => { throw new AuthError(code, message) }

/** Thời hạn bình chọn chọn được (giờ). Tối đa 1 ngày; bỏ trống thì mặc định 1 ngày. */
export const POLL_HOURS = [1, 2, 3, 6, 12, 24] as const
export const DEFAULT_POLL_HOURS = 24

export const parsePollHours = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return DEFAULT_POLL_HOURS
  const hours = Number(value)
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) return fail('Thời hạn bình chọn từ 1 đến 24 giờ.')
  return hours
}

/**
 * Ai nhận bình chọn outfit:
 * - `public`: mọi bạn bè, cộng người theo dõi (nếu là KOL/KOC); hiện trên hồ sơ với họ.
 * - `friends`: mọi bạn bè.
 * - `friends_except`: mọi bạn bè trừ những người trong `excludedIds`.
 * - `specific`: chỉ những bạn trong `recipientIds`.
 * Client cũ chỉ gửi `recipientIds` (không có `audience`) được coi là `specific`.
 */
export const POLL_AUDIENCES = ['public', 'friends', 'friends_except', 'specific'] as const
export type PollAudience = (typeof POLL_AUDIENCES)[number]

export const resolvePollAudience = (body: Record<string, unknown>, input: {
  friends: string[]
  followers: string[]
  ids: (value: unknown) => string[]
}): { recipients: string[]; visibility: 'friends' | 'public' } => {
  const raw = body.audience ?? (body.recipientIds !== undefined ? 'specific' : 'friends')
  if (typeof raw !== 'string' || !(POLL_AUDIENCES as readonly string[]).includes(raw)) return fail('Quyền xem bình chọn không hợp lệ.')
  const audience = raw as PollAudience
  const friendSet = new Set(input.friends)
  let recipients: string[]
  if (audience === 'public') {
    recipients = [...new Set([...input.friends, ...input.followers])]
  } else if (audience === 'friends') {
    recipients = [...input.friends]
  } else if (audience === 'friends_except') {
    const excluded = new Set(input.ids(body.excludedIds ?? []))
    recipients = input.friends.filter(id => !excluded.has(id))
  } else {
    recipients = input.ids(body.recipientIds ?? [])
    if (recipients.some(id => !friendSet.has(id))) fail('Người nhận phải là bạn bè hiện tại.')
  }
  if (!recipients.length) fail(audience === 'public' ? 'Bạn chưa có bạn bè hoặc người theo dõi để nhận bình chọn.' : 'Bình chọn cần ít nhất một người nhận.')
  return { recipients, visibility: audience === 'public' ? 'public' : 'friends' }
}

export const PROFILE_VISIBILITIES = ['everyone', 'friends', 'private'] as const
export const DEFAULT_PROFILE_VISIBILITY: SocialProfile['profileVisibility'] = 'friends'

export const parseProfileVisibility = (value: unknown): SocialProfile['profileVisibility'] => {
  if (typeof value !== 'string' || !(PROFILE_VISIBILITIES as readonly string[]).includes(value)) return fail('Quyền xem trang cá nhân không hợp lệ.')
  return value as SocialProfile['profileVisibility']
}

/** Hồ sơ KOL/KOC luôn công khai; hồ sơ thường theo cài đặt của chủ tài khoản. */
export const canViewProfile = (input: {
  viewer: string
  target: string
  blocked: boolean
  creator: boolean
  friend: boolean
  visibility: SocialProfile['profileVisibility'] | undefined
}): boolean => {
  if (input.viewer === input.target) return true
  if (input.blocked) return false
  if (input.creator) return true
  const visibility = input.visibility ?? DEFAULT_PROFILE_VISIBILITY
  if (visibility === 'everyone') return true
  if (visibility === 'friends') return input.friend
  return false
}
