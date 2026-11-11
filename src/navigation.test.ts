import { describe, expect, it } from 'vitest'
import { appViewPaths, resolveAppView } from './navigation'

describe('app navigation', () => {
  it('ánh xạ đúng URL tới từng trang', () => {
    expect(resolveAppView(appViewPaths.wardrobe)).toBe('wardrobe')
    expect(resolveAppView(appViewPaths.fitting + '/')).toBe('fitting')
    expect(resolveAppView(appViewPaths.outfits)).toBe('outfits')
    expect(resolveAppView(appViewPaths.profile)).toBe('profile')
    expect(resolveAppView(appViewPaths.settings)).toBe('settings')
    expect(resolveAppView(appViewPaths.admin)).toBe('admin')
  })

  it('trả về null với URL không thuộc ứng dụng', () => {
    expect(resolveAppView('/khong-ton-tai')).toBeNull()
  })
})
