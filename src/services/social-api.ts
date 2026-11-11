import type { SocialPerson, SocialSnapshot, SharedOutfit } from '../../server/social/types'
import { apiFetch } from './api-client'

const SNAPSHOT_TTL_MS = 5_000
let cachedSnapshot: SocialSnapshot | null = null
let snapshotExpiresAt = 0
let snapshotRequest: Promise<SocialSnapshot> | null = null
let snapshotEpoch = 0

const rememberSnapshot = (snapshot: SocialSnapshot) => {
  cachedSnapshot = snapshot
  snapshotExpiresAt = Date.now() + SNAPSHOT_TTL_MS
  return snapshot
}

async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await apiFetch('/api/social' + path, body ? { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) } : { cache:'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message ?? 'Không thể kết nối.')
  return data as T
}
export const socialApi = {
  clearCache: () => {
    snapshotEpoch += 1
    cachedSnapshot = null
    snapshotExpiresAt = 0
    snapshotRequest = null
  },
  snapshot: (options?: { force?: boolean }) => {
    if (!options?.force && cachedSnapshot && Date.now() < snapshotExpiresAt) {
      return Promise.resolve(cachedSnapshot)
    }
    if (snapshotRequest) return snapshotRequest
    const epoch = snapshotEpoch
    const pending = request<SocialSnapshot>('')
      .then((snapshot) => epoch === snapshotEpoch ? rememberSnapshot(snapshot) : snapshot)
    snapshotRequest = pending
    const clearPending = () => { if (snapshotRequest === pending) snapshotRequest = null }
    void pending.then(clearPending, clearPending)
    return pending
  },
  act: (action: string, body: Record<string, unknown>) => {
    const epoch = ++snapshotEpoch
    snapshotRequest = null
    return request<SocialSnapshot>('/'+action,body)
      .then((snapshot) => epoch === snapshotEpoch ? rememberSnapshot(snapshot) : snapshot)
  },
  uploadAvatar: async (file: File) => {
    const epoch = snapshotEpoch
    const form = new FormData()
    form.set('avatar', file)
    const response = await apiFetch('/api/social/avatar', { method: 'POST', body: form })
    const data = await response.json() as SocialSnapshot | { message?: string }
    if (!response.ok) throw new Error('message' in data && data.message ? data.message : 'Không thể cập nhật ảnh đại diện.')
    if (epoch !== snapshotEpoch) return data as SocialSnapshot
    snapshotEpoch += 1
    snapshotRequest = null
    return rememberSnapshot(data as SocialSnapshot)
  },
  publish: async (form: FormData) => {
    const epoch = ++snapshotEpoch
    snapshotRequest = null
    const response = await apiFetch('/api/social/publish', { method:'POST', body:form })
    const data = await response.json() as SocialSnapshot | { message?: string }
    if (!response.ok) throw new Error('message' in data && data.message ? data.message : 'Không thể đăng outfit.')
    return epoch === snapshotEpoch ? rememberSnapshot(data as SocialSnapshot) : data as SocialSnapshot
  },
  search: (q: string) => request<SocialPerson[]>('/search?q='+encodeURIComponent(q)),
  invite: (code: string) => request<SocialPerson>('/invite?code='+encodeURIComponent(code)),
  profile: (id: string) => request<{person:SocialPerson;outfits:SharedOutfit[]}>('/profile/'+encodeURIComponent(id)),
}
