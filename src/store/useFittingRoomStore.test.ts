import { beforeEach, describe, expect, it } from 'vitest'
import type { Garment } from '../types/fitting-room'
import { useFittingRoomStore } from './useFittingRoomStore'

const shirt: Garment = {
  id: 'shirt-1',
  name: 'Sơ mi trắng',
  category: 'tops',
  frontOriginalUrl: '/original.jpg',
  frontProcessedUrl: '/processed.png',
  backOriginalUrl: null,
  backProcessedUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('useFittingRoomStore', () => {
  beforeEach(() => {
    useFittingRoomStore.setState({
      activeCategory: 'tops',
      garments: [],
      outfit: { tops: null, outerwear: null, bottoms: null, shoes: null, accessories: [] },
      isLoadingGarments: false,
      wardrobeError: null,
      personImage: null,
      privacyConsent: false,
    })
  })

  it('thay món đang chọn trong cùng một nhóm', () => {
    const { selectGarment } = useFittingRoomStore.getState()
    selectGarment('tops', 'shirt-1')
    selectGarment('tops', 'shirt-2')
    expect(useFittingRoomStore.getState().outfit.tops).toBe('shirt-2')
  })

  it('bấm lại món đang chọn sẽ bỏ chọn món đó', () => {
    const { selectGarment } = useFittingRoomStore.getState()
    selectGarment('tops', 'shirt-1')
    selectGarment('tops', 'shirt-1')
    expect(useFittingRoomStore.getState().outfit.tops).toBeNull()
  })

  it('cho phép chọn áo trong và áo khoác cùng lúc', () => {
    const { selectGarment } = useFittingRoomStore.getState()
    selectGarment('tops', 'shirt-1')
    selectGarment('outerwear', 'jacket-1')
    expect(useFittingRoomStore.getState().outfit.tops).toBe('shirt-1')
    expect(useFittingRoomStore.getState().outfit.outerwear).toBe('jacket-1')
  })

  it('cho phép chọn nhiều phụ kiện cùng lúc và bỏ chọn từng món', () => {
    const { selectGarment, clearSelection } = useFittingRoomStore.getState()
    selectGarment('accessories', 'watch-1')
    selectGarment('accessories', 'bag-1')
    selectGarment('accessories', 'glasses-1')
    expect(useFittingRoomStore.getState().outfit.accessories).toEqual(['watch-1', 'bag-1', 'glasses-1'])

    // Bấm lại bag-1 sẽ bỏ chọn bag-1 nhưng giữ watch-1 và glasses-1
    selectGarment('accessories', 'bag-1')
    expect(useFittingRoomStore.getState().outfit.accessories).toEqual(['watch-1', 'glasses-1'])

    // clearSelection xóa toàn bộ phụ kiện
    clearSelection('accessories')
    expect(useFittingRoomStore.getState().outfit.accessories).toEqual([])
  })

  it('không cho chọn quá 8 món nhưng vẫn cho thay món cùng nhóm', () => {
    useFittingRoomStore.setState({
      outfit: {
        tops: 'shirt-1',
        outerwear: 'jacket-1',
        bottoms: 'pants-1',
        shoes: 'shoes-1',
        accessories: ['a-1', 'a-2', 'a-3', 'a-4'],
      },
    })
    const { selectGarment } = useFittingRoomStore.getState()
    selectGarment('accessories', 'a-5')
    expect(useFittingRoomStore.getState().outfit.accessories).toHaveLength(4)

    selectGarment('tops', 'shirt-2')
    expect(useFittingRoomStore.getState().outfit.tops).toBe('shirt-2')
  })

  it('xóa món đồ cũng bỏ chọn món đó', () => {
    const store = useFittingRoomStore.getState()
    store.addGarment(shirt)
    store.selectGarment('tops', shirt.id)
    useFittingRoomStore.getState().removeGarment(shirt.id)
    expect(useFittingRoomStore.getState().garments).toHaveLength(0)
    expect(useFittingRoomStore.getState().outfit.tops).toBeNull()
  })

  it('reset xác nhận quyền riêng tư khi đổi hoặc xoá ảnh người dùng', () => {
    const store = useFittingRoomStore.getState()
    store.setPrivacyConsent(true)
    store.setPersonImage({
      id: 'current',
      imageUrl: '/person.jpg',
      width: 683,
      height: 1024,
      warnings: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(useFittingRoomStore.getState().privacyConsent).toBe(false)
    useFittingRoomStore.getState().setPrivacyConsent(true)
    useFittingRoomStore.getState().clearUserData()
    expect(useFittingRoomStore.getState().privacyConsent).toBe(false)
    expect(useFittingRoomStore.getState().personImage).toBeNull()
  })

  it('loadOutfitGarments nạp chính xác các món đồ vào nhóm tương ứng', () => {
    useFittingRoomStore.setState({
      garments: [
        { id: 'top-1', name: 'Áo', category: 'tops', frontOriginalUrl: '', frontProcessedUrl: '', backOriginalUrl: null, backProcessedUrl: null, createdAt: '' },
        { id: 'bot-1', name: 'Quần', category: 'bottoms', frontOriginalUrl: '', frontProcessedUrl: '', backOriginalUrl: null, backProcessedUrl: null, createdAt: '' },
        { id: 'acc-1', name: 'Mũ', category: 'accessories', frontOriginalUrl: '', frontProcessedUrl: '', backOriginalUrl: null, backProcessedUrl: null, createdAt: '' },
        { id: 'acc-2', name: 'Túi', category: 'accessories', frontOriginalUrl: '', frontProcessedUrl: '', backOriginalUrl: null, backProcessedUrl: null, createdAt: '' },
      ],
      outfit: { tops: null, outerwear: null, bottoms: null, shoes: null, accessories: [] },
    })

    useFittingRoomStore.getState().loadOutfitGarments(['top-1', 'bot-1', 'acc-1', 'acc-2'])
    const state = useFittingRoomStore.getState().outfit
    expect(state.tops).toBe('top-1')
    expect(state.bottoms).toBe('bot-1')
    expect(state.accessories).toEqual(['acc-1', 'acc-2'])
  })
})
