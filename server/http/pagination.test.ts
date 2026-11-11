import { describe, expect, it } from 'vitest'
import { pageMetadata, parsePagination } from './pagination.js'

describe('pagination', () => {
  it('keeps legacy unpaginated requests compatible', () => {
    expect(parsePagination({})).toBeUndefined()
  })

  it('parses a bounded page and reports the next offset', () => {
    expect(parsePagination({ limit: '20', offset: '40' })).toEqual({ limit: 20, offset: 40 })
    expect(pageMetadata(40, 20, 75)).toEqual({ total: 75, nextOffset: 60 })
    expect(pageMetadata(60, 15, 75)).toEqual({ total: 75, nextOffset: null })
  })

  it('rejects invalid or excessive pages instead of returning the full table', () => {
    expect(() => parsePagination({ limit: '1000' })).toThrow(/Phân trang không hợp lệ/)
    expect(() => parsePagination({ offset: '-1' })).toThrow(/Phân trang không hợp lệ/)
  })
})
