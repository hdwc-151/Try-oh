const PREFIX = 'fitsy:'
const LEGACY_PREFIX = 'tryoh:'

export const storageKeys = {
  theme: `${PREFIX}theme`,
  onboarding: (userId: string) => `${PREFIX}onboarding:${userId}:v1`,
}

/**
 * Đọc key mới `fitsy:*`; nếu chưa có thì lấy giá trị từ key cũ `tryoh:*`,
 * chép sang key mới và xoá key cũ, để người dùng không mất cài đặt sau khi đổi tên.
 */
export function readStoredValue(key: string): string | null {
  try {
    const current = window.localStorage.getItem(key)
    if (current !== null || !key.startsWith(PREFIX)) return current
    const legacyKey = LEGACY_PREFIX + key.slice(PREFIX.length)
    const legacy = window.localStorage.getItem(legacyKey)
    if (legacy !== null) {
      window.localStorage.setItem(key, legacy)
      window.localStorage.removeItem(legacyKey)
    }
    return legacy
  } catch {
    return null
  }
}

export function writeStoredValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Trình duyệt chặn bộ nhớ (chế độ riêng tư…): bỏ qua, chỉ mất ghi nhớ cục bộ.
  }
}
