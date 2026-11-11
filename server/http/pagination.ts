import { AuthError } from '../auth/auth-service.js'

export type ListOptions = { limit?: number; offset?: number }

export const parsePagination = (query: Record<string, unknown>, maxLimit = 100): Required<ListOptions> | undefined => {
  if (query.limit === undefined && query.offset === undefined) return undefined
  const limit = Number(query.limit ?? 50)
  const offset = Number(query.offset ?? 0)
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit || !Number.isInteger(offset) || offset < 0) {
    throw new AuthError(400, `Phân trang không hợp lệ. limit phải từ 1 đến ${maxLimit} và offset không được âm.`)
  }
  return { limit, offset }
}

export const pageMetadata = (offset: number, itemCount: number, total: number) => ({
  total,
  nextOffset: offset + itemCount < total ? offset + itemCount : null,
})
