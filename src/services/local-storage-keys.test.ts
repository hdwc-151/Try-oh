import { beforeEach, describe, expect, it } from 'vitest'
import { readStoredValue, storageKeys, writeStoredValue } from './local-storage-keys'

describe('local storage keys', () => {
  beforeEach(() => window.localStorage.clear())

  it('chuyển giá trị từ key tryoh cũ sang key fitsy mới', () => {
    window.localStorage.setItem('tryoh:theme', 'dark')
    expect(readStoredValue(storageKeys.theme)).toBe('dark')
    expect(window.localStorage.getItem('fitsy:theme')).toBe('dark')
    expect(window.localStorage.getItem('tryoh:theme')).toBeNull()
  })

  it('ưu tiên key mới khi đã có', () => {
    window.localStorage.setItem('tryoh:onboarding:u1:v1', 'complete')
    writeStoredValue(storageKeys.onboarding('u1'), 'pending')
    expect(readStoredValue(storageKeys.onboarding('u1'))).toBe('pending')
  })

  it('trả về null khi chưa có gì', () => {
    expect(readStoredValue(storageKeys.theme)).toBeNull()
  })
})
