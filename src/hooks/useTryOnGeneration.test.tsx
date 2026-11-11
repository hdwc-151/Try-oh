import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tryOnApi } from '../services/try-on-api'
import { useFittingRoomStore } from '../store/useFittingRoomStore'
import { useTryOnGeneration } from './useTryOnGeneration'

vi.mock('../services/try-on-api', () => ({
  tryOnApi: {
    listResults: vi.fn(),
    listOutfits: vi.fn(),
    getCredits: vi.fn(),
    generateAngle: vi.fn(),
    deleteOutfit: vi.fn(),
  },
}))

describe('useTryOnGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFittingRoomStore.setState({
      outfit: { tops: 'shirt-1', outerwear: null, bottoms: null, shoes: null, accessories: [] },
      privacyConsent: true,
    })
    vi.mocked(tryOnApi.listResults).mockResolvedValue([])
    vi.mocked(tryOnApi.listOutfits).mockResolvedValue([])
    vi.mocked(tryOnApi.getCredits).mockResolvedValue({remaining:10,limit:10,unlimited:false})
    vi.mocked(tryOnApi.generateAngle).mockImplementation(async (angle) => ({
      angle,
      imageUrl: `/generated-${angle}.png`,
      createdAt: '2026-01-01T00:00:00.000Z',
      credits: {remaining:9,limit:10,unlimited:false},
    }))
  })

  it('only generates FRONT on the primary action and waits for an explicit BACK action', async () => {
    const { result } = renderHook(() => useTryOnGeneration())
    await waitFor(() => expect(tryOnApi.listOutfits).toHaveBeenCalledOnce())

    await act(async () => result.current.generateAll())
    expect(tryOnApi.generateAngle).toHaveBeenCalledTimes(1)
    expect(tryOnApi.generateAngle).toHaveBeenLastCalledWith('front', ['shirt-1'], true, true)
    expect(result.current.states.back.status).toBe('idle')
    expect(result.current.creditStatus?.remaining).toBe(9)

    await act(async () => result.current.regenerate('back'))
    expect(tryOnApi.generateAngle).toHaveBeenCalledTimes(2)
    expect(tryOnApi.generateAngle).toHaveBeenLastCalledWith('back', ['shirt-1'], true, true)
  })

  it('gửi cờ preservePose độc lập cho ảnh trước và ảnh sau', async () => {
    useFittingRoomStore.setState({
      preservePoseFront: false,
      preservePoseBack: true,
    })
    const { result } = renderHook(() => useTryOnGeneration())
    await waitFor(() => expect(tryOnApi.listOutfits).toHaveBeenCalledOnce())

    await act(async () => result.current.generateAll())
    expect(tryOnApi.generateAngle).toHaveBeenLastCalledWith('front', ['shirt-1'], false, true)

    await act(async () => result.current.regenerate('back'))
    expect(tryOnApi.generateAngle).toHaveBeenLastCalledWith('back', ['shirt-1'], true, true)
  })

  it('chỉ tải lịch sử khi tab cần dữ liệu tạo ảnh được mở', async () => {
    const { rerender } = renderHook(
      ({ enabled }) => useTryOnGeneration(enabled),
      { initialProps: { enabled: false } },
    )

    expect(tryOnApi.listResults).not.toHaveBeenCalled()
    expect(tryOnApi.listOutfits).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(tryOnApi.listOutfits).toHaveBeenCalledOnce())
    expect(tryOnApi.listResults).toHaveBeenCalledOnce()
  })
})
