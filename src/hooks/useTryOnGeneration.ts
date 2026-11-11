import { useCallback, useEffect, useMemo, useState } from 'react'
import { applyOutfitCustomizations, removeOutfitCustomization } from '../services/outfit-customizations'
import { tryOnApi } from '../services/try-on-api'
import { useFittingRoomStore } from '../store/useFittingRoomStore'
import { MAX_SAVED_OUTFITS, type AngleGenerationState, type CreditStatus, type SavedOutfit, type TryOnAngle, type TryOnResult } from '../types/fitting-room'

const angles: TryOnAngle[] = ['front', 'back']

const createInitialState = (): Record<TryOnAngle, AngleGenerationState> => ({
  front: { status: 'idle', result: null, error: null },
  back: { status: 'idle', result: null, error: null },
})

export function useTryOnGeneration(enabled = true, maxSavedOutfits = MAX_SAVED_OUTFITS) {
  const [states, setStates] = useState(createInitialState)
  const [history, setHistory] = useState<SavedOutfit[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [creditStatus, setCreditStatus] = useState<CreditStatus | null>(null)
  const outfit = useFittingRoomStore((state) => state.outfit)
  const preservePoseFront = useFittingRoomStore((state) => state.preservePoseFront)
  const preservePoseBack = useFittingRoomStore((state) => state.preservePoseBack)
  const privacyConsent = useFittingRoomStore((state) => state.privacyConsent)
  const garmentIds = useMemo(
    () =>
      [outfit.tops, outfit.outerwear, outfit.bottoms, outfit.shoes, ...outfit.accessories].filter(
        (id): id is string => Boolean(id),
      ),
    [outfit],
  )

  const refreshHistory = useCallback(async () => {
    setHistoryError(null)
    try {
      const raw = await tryOnApi.listOutfits()
      setHistory(applyOutfitCustomizations(raw))
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Không thể tải Bộ đồ của tôi.')
    } finally {
      setIsHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    Promise.all([tryOnApi.listResults(), tryOnApi.listOutfits(), tryOnApi.getCredits()])
      .then(([results, outfits, credits]) => {
        setStates((current) => {
          const next = { ...current }
          results.forEach((result) => {
            next[result.angle] = { status: 'success', result, error: null }
          })
          return next
        })
        setHistory(applyOutfitCustomizations(outfits))
        setCreditStatus(credits)
      })
      .catch((error: unknown) => {
        setHistoryError(error instanceof Error ? error.message : 'Không thể tải dữ liệu kết quả.')
      })
      .finally(() => setIsHistoryLoading(false))
  }, [enabled])

  const runAngle = useCallback(async (angle: TryOnAngle, ids: string[]) => {
    setStates((current) => ({
      ...current,
      [angle]: { ...current[angle], status: 'loading', error: null },
    }))
    try {
      const preservePose = angle === 'front' ? preservePoseFront : preservePoseBack
      const generated = await tryOnApi.generateAngle(angle, ids, preservePose, privacyConsent)
      const result: TryOnResult = {
        angle: generated.angle,
        imageUrl: generated.imageUrl,
        createdAt: generated.createdAt,
      }
      setCreditStatus(generated.credits)
      setStates((current) => ({
        ...current,
        [angle]: { status: 'success', result, error: null },
      }))
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể tạo ảnh.'
      setStates((current) => ({
        ...current,
        [angle]: { ...current[angle], status: 'error', error: message },
      }))
      throw error
    }
  }, [preservePoseFront, preservePoseBack, privacyConsent])

  const generateAll = useCallback(async () => {
    if (!garmentIds.length) return
    if (history.length >= maxSavedOutfits) {
      setStates((current) => ({
        ...current,
        front: {
          ...current.front,
          status: 'error',
          error: `Gói hiện tại lưu tối đa ${maxSavedOutfits} outfit.`,
        },
      }))
      return
    }
    setStates(createInitialState())
    try {
      await runAngle('front', garmentIds)
      await refreshHistory()
    } catch {
      setStates((current) => {
        return {
          ...current,
          back: {
            status: 'error',
            result: null,
            error: 'Ảnh TRƯỚC chưa thành công.',
          },
        }
      })
    }
  }, [garmentIds, history.length, refreshHistory, runAngle])

  const regenerate = useCallback(async (angle: TryOnAngle) => {
    if (!garmentIds.length) return
    if (angle === 'front' && history.length >= maxSavedOutfits) {
      setStates((current) => ({
        ...current,
        front: {
          ...current.front,
          status: 'error',
          error: `Gói hiện tại lưu tối đa ${maxSavedOutfits} outfit.`,
        },
      }))
      return
    }
    if (angle === 'front') {
      setStates((current) => ({
        ...current,
        back: { status: 'idle', result: null, error: null },
      }))
    }
    try {
      await runAngle(angle, garmentIds)
      await refreshHistory()
    } catch {
      // ResultStage hiển thị lỗi và cho phép thử lại.
    }
  }, [garmentIds, history.length, refreshHistory, runAngle])

  const deleteOutfit = useCallback(async (id: string) => {
    await tryOnApi.deleteOutfit(id)
    removeOutfitCustomization(id)
    setHistory((current) => current.filter((outfit) => outfit.id !== id))
  }, [])

  const updateOutfit = useCallback((id: string, updates: Partial<SavedOutfit>) => {
    setHistory((current) =>
      current.map((outfit) => (outfit.id === id ? { ...outfit, ...updates } : outfit)),
    )
  }, [])

  return {
    states,
    generateAll,
    regenerate,
    history,
    isHistoryLoading,
    historyError,
    creditStatus,
    deleteOutfit,
    updateOutfit,
    clearResults: () => setStates(createInitialState()),
    clearAllResults: () => {
      setStates(createInitialState())
      setHistory([])
      setHistoryError(null)
    },
    isGenerating: angles.some((angle) => states[angle].status === 'loading'),
  }
}
