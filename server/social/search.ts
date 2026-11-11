type PreparedSearch = {
  value: string
  usernameOnly: boolean
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

export function prepareSocialSearch(query: string): PreparedSearch | null {
  const trimmed = query.trim().slice(0, 50)
  const usernameOnly = trimmed.startsWith('@')
  const value = normalize(usernameOnly ? trimmed.slice(1) : trimmed)
  return value.length >= 2 ? { value, usernameOnly } : null
}

export function socialSearchScore(
  username: string,
  name: string,
  search: PreparedSearch,
): number | null {
  const normalizedUsername = normalize(username)
  const normalizedName = normalize(name)
  const { value, usernameOnly } = search

  if (normalizedUsername === value) return 0
  if (normalizedUsername.startsWith(value)) return 1
  if (!usernameOnly && normalizedName === value) return 2
  if (!usernameOnly && normalizedName.startsWith(value)) return 3
  if (normalizedUsername.includes(value)) return 4
  if (!usernameOnly && normalizedName.includes(value)) return 5
  return null
}
