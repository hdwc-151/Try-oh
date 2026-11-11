import { ArrowLeft, CalendarDays, Images, LoaderCircle, Maximize2, Pencil, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SocialSnapshot } from '../../server/social/types'
import { getOutfitCustomizations, removeOutfitCustomization, saveOutfitCustomization, type OutfitCustomization } from '../services/outfit-customizations'
import { socialApi } from '../services/social-api'
import { MAX_SAVED_OUTFITS, type SavedOutfit } from '../types/fitting-room'
import { ConfirmDialog } from './ConfirmDialog'
import { EditOutfitModal } from './EditOutfitModal'
import { ImageLightbox } from './ImageLightbox'

type OutfitHistoryProps = {
  outfits: SavedOutfit[]
  isLoading: boolean
  error: string | null
  onDelete: (id: string) => Promise<void>
  onBack: () => void
  onUpdateOutfit?: (id: string, updates: Partial<SavedOutfit>) => void
  onEditInFitting?: (outfit: SavedOutfit) => void
  maxSavedOutfits?: number
}

const formatDate = (value: string) => new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

export function OutfitHistory({
  outfits,
  isLoading,
  error,
  onDelete,
  onBack,
  onUpdateOutfit,
  onEditInFitting,
  maxSavedOutfits = MAX_SAVED_OUTFITS,
}: OutfitHistoryProps) {
  const [social, setSocial] = useState<SocialSnapshot | null>(null)
  useEffect(() => {
    let active = true
    void socialApi.snapshot().then(data => { if (active) setSocial(data) }).catch(() => {})
    return () => { active = false }
  }, [])

  const officialIds = social?.policies.filter(policy => policy.official).map(policy => policy.outfitId) ?? []

  const [preview, setPreview] = useState<SavedOutfit | null>(null)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [customizations, setCustomizations] = useState<Record<string, OutfitCustomization>>(() => getOutfitCustomizations())
  const [editingOutfit, setEditingOutfit] = useState<SavedOutfit | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SavedOutfit | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [visibleLimit, setVisibleLimit] = useState(30)
  const renderedOutfits = outfits.slice(0, visibleLimit)

  const remove = async (outfit: SavedOutfit) => {
    setDeletingId(outfit.id)
    setDeleteError(null)
    try {
      await onDelete(outfit.id)
      removeOutfitCustomization(outfit.id)
      if (preview?.id === outfit.id) setPreview(null)
      if (editingOutfit?.id === outfit.id) setEditingOutfit(null)
      setCustomizations(getOutfitCustomizations())
    } catch (removeError) {
      setDeleteError(removeError instanceof Error ? removeError.message : 'Không thể xoá bộ ảnh.')
    } finally {
      setDeletingId(null)
      setPendingDelete(null)
    }
  }

  const handleSaveOutfit = async (id: string, updates: {
    title?: string | null
    visibility: 'private' | 'friends' | 'groups'
    groupIds: string[]
  }) => {
    const nextSocial = await socialApi.act('outfit-policy', {
      outfitId: id,
      visibility: updates.visibility,
      groupIds: updates.groupIds,
    })
    setSocial(nextSocial)
    saveOutfitCustomization(id, { title: updates.title })
    setCustomizations(getOutfitCustomizations())
  }

  const handleRemoveAngle = (id: string, angle: 'front' | 'back') => {
    const target = outfits.find((o) => o.id === id)
    if (!target) return
    const custom = customizations[id]
    const currentBack = custom?.backImageUrl !== undefined ? custom.backImageUrl : target.backImageUrl

    if (angle === 'back') {
      saveOutfitCustomization(id, { backImageUrl: null })
      if (onUpdateOutfit) onUpdateOutfit(id, { backImageUrl: null })
      setCustomizations(getOutfitCustomizations())
    } else if (angle === 'front') {
      if (currentBack) {
        saveOutfitCustomization(id, { frontImageUrl: currentBack, backImageUrl: null })
        if (onUpdateOutfit) onUpdateOutfit(id, { frontImageUrl: currentBack, backImageUrl: null })
        setCustomizations(getOutfitCustomizations())
      }
    }
  }

  const handleDeleteOutfit = async (id: string) => {
    removeOutfitCustomization(id)
    await onDelete(id)
    if (editingOutfit?.id === id) setEditingOutfit(null)
    if (preview?.id === id) setPreview(null)
    setCustomizations(getOutfitCustomizations())
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <section className="overflow-hidden rounded-[24px] border border-black/[0.065] bg-white/80 shadow-[0_20px_50px_rgba(23,33,29,0.06)] backdrop-blur-md sm:rounded-[32px]">
        <div className="flex flex-col gap-4 border-b border-black/[0.055] px-6 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:py-8">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Bộ đồ của tôi</h2>
            <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-sage-800">
              <a href="/bang-tin?compose=1" className="underline">Tải outfit →</a>
            </div>
          </div>
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <span className="rounded-full border border-black/[0.07] bg-black/[0.035] px-3 py-2 text-xs font-bold text-ink/65">
              {outfits.length}/{maxSavedOutfits} bộ
            </span>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-xs font-bold text-ink shadow-2xs transition hover:bg-black/5"
            >
              <ArrowLeft size={14} />
              <span>Phòng thử</span>
            </button>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          {deleteError && (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
              {deleteError}
            </div>
          )}

          {error && (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="grid min-h-[320px] place-items-center">
              <div className="flex flex-col items-center gap-3">
                <LoaderCircle size={28} className="animate-spin text-ink/40" />
                <p className="text-xs font-bold text-ink/50">Đang tải các bộ đồ đã lưu...</p>
              </div>
            </div>
          ) : outfits.length === 0 ? (
            <div className="grid min-h-[360px] place-items-center rounded-3xl border border-dashed border-black/10 bg-panel/60 p-8 text-center">
              <div className="max-w-sm">
                <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-black/5 text-ink/40">
                  <Images size={20} />
                </div>
                <h3 className="font-display text-lg font-bold text-ink">Chưa có bộ đồ nào được lưu</h3>
                <p className="mt-2 text-xs text-ink/60">
                  Khi bạn thử đồ trong phòng thử và bấm lưu kết quả, các bộ đồ hoàn chỉnh sẽ xuất hiện ở đây để xem lại bất cứ lúc nào.
                </p>
                <button
                  type="button"
                  onClick={onBack}
                  className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-ink px-5 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-black"
                >
                  <Sparkles size={14} className="text-amber-300" />
                  <span>Đến phòng thử ngay</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {renderedOutfits.map((outfit, index) => {
                const defaultTitle = `Bộ thử ${outfits.length - index}`
                const custom = customizations[outfit.id]
                const displayTitle = custom?.title || defaultTitle
                const frontImageUrl = custom?.frontImageUrl || outfit.frontImageUrl
                const backImageUrl = custom?.backImageUrl !== undefined ? custom.backImageUrl : outfit.backImageUrl

                return (
                  <article
                    key={outfit.id}
                    className="group flex flex-col overflow-hidden rounded-[26px] border border-black/[0.065] bg-white shadow-[0_12px_36px_rgba(40,54,47,0.06)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(40,54,47,0.12)]"
                  >
                    {officialIds.includes(outfit.id) && (
                      <p className="bg-sage-100 px-4 py-2 text-xs font-bold text-sage-800">
                        ★ Outfit chính thức · Bạn bè đã bình chọn
                      </p>
                    )}

                    {/* Image Area - Cân đối tỉ lệ cố định h-64 sm:h-72 */}
                    <div className="p-3">
                      {backImageUrl ? (
                        <div className="grid h-64 sm:h-72 w-full grid-cols-2 gap-2">
                          {/* Góc trước */}
                          <div
                            onClick={() => setLightbox({ src: frontImageUrl, alt: `${displayTitle} (mặt trước)` })}
                            className="group/img relative h-full w-full cursor-zoom-in overflow-hidden rounded-2xl bg-[#eeece6] transition hover:opacity-95"
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                setLightbox({ src: frontImageUrl, alt: `${displayTitle} (mặt trước)` })
                              }
                            }}
                            aria-label={`Phóng to ${displayTitle} mặt trước`}
                          >
                            <img
                              src={frontImageUrl}
                              alt="Ảnh mặt trước"
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-contain transition-transform duration-300 ease-out group-hover/img:scale-105"
                            />
                            <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/75 px-2.5 py-1 text-[9px] font-bold tracking-wider text-white backdrop-blur-md">
                              TRƯỚC
                            </span>
                            <span className="absolute bottom-2.5 right-2.5 grid size-8 place-items-center rounded-xl bg-white/95 text-ink opacity-0 shadow-md backdrop-blur-md transition-all duration-200 group-hover/img:opacity-100 hover:scale-110">
                              <Maximize2 size={13} />
                            </span>
                          </div>

                          {/* Góc sau */}
                          <div
                            onClick={() => setLightbox({ src: backImageUrl, alt: `${displayTitle} (mặt sau)` })}
                            className="group/img relative h-full w-full cursor-zoom-in overflow-hidden rounded-2xl bg-[#eeece6] transition hover:opacity-95"
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                setLightbox({ src: backImageUrl, alt: `${displayTitle} (mặt sau)` })
                              }
                            }}
                            aria-label={`Phóng to ${displayTitle} mặt sau`}
                          >
                            <img
                              src={backImageUrl}
                              alt="Ảnh mặt sau"
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-contain transition-transform duration-300 ease-out group-hover/img:scale-105"
                            />
                            <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/75 px-2.5 py-1 text-[9px] font-bold tracking-wider text-white backdrop-blur-md">
                              SAU
                            </span>
                            <span className="absolute bottom-2.5 right-2.5 grid size-8 place-items-center rounded-xl bg-white/95 text-ink opacity-0 shadow-md backdrop-blur-md transition-all duration-200 group-hover/img:opacity-100 hover:scale-110">
                              <Maximize2 size={13} />
                            </span>
                          </div>
                        </div>
                      ) : (
                        /* Đồ 1 góc: Giữ đúng chiều cao h-64 sm:h-72, ảnh căn giữa nền #eeece6 tỉ lệ đồng đều */
                        <div
                          onClick={() => setLightbox({ src: frontImageUrl, alt: `${displayTitle} (mặt trước)` })}
                          className="group/img relative h-64 sm:h-72 w-full cursor-zoom-in overflow-hidden rounded-2xl bg-[#eeece6] transition hover:opacity-95"
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setLightbox({ src: frontImageUrl, alt: `${displayTitle} (mặt trước)` })
                            }
                          }}
                          aria-label={`Phóng to ${displayTitle} mặt trước`}
                        >
                          <img
                            src={frontImageUrl}
                            alt="Ảnh mặt trước"
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-contain transition-transform duration-300 ease-out group-hover/img:scale-105"
                          />
                          <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/75 px-2.5 py-1 text-[9px] font-bold tracking-wider text-white backdrop-blur-md">
                            TRƯỚC
                          </span>
                          <span className="absolute bottom-2.5 right-2.5 grid size-8 place-items-center rounded-xl bg-white/95 text-ink opacity-0 shadow-md backdrop-blur-md transition-all duration-200 group-hover/img:opacity-100 hover:scale-110">
                            <Maximize2 size={13} />
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Metadata & Actions */}
                    <div className="flex items-center justify-between border-t border-black/[0.05] px-4 py-3 sm:px-5">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-display text-sm font-bold tracking-tight text-ink sm:text-base">
                            {displayTitle}
                          </h4>
                          <span
                            className={
                              'rounded-full px-2 py-0.5 text-[10px] font-bold ' +
                              (backImageUrl
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/60'
                                : 'bg-amber-50 text-amber-800 border border-amber-200/60')
                            }
                          >
                            {backImageUrl ? '2 góc đầy đủ' : '1 góc trước'}
                          </span>
                        </div>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink/40">
                          <CalendarDays size={12} />
                          <span>{formatDate(outfit.createdAt)}</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-1">
                        {/* Nút Chỉnh sửa bộ thử */}
                        <button
                          type="button"
                          onClick={() => setEditingOutfit(outfit)}
                          className="grid size-9 shrink-0 place-items-center rounded-xl text-ink/40 transition hover:bg-black/5 hover:text-ink"
                          aria-label={`Chỉnh sửa ${displayTitle}`}
                          title="Chỉnh sửa bộ thử"
                        >
                          <Pencil size={15} />
                        </button>

                        {/* Nút Xoá bộ thử */}
                        <button
                          type="button"
                          onClick={() => setPendingDelete(outfit)}
                          disabled={deletingId === outfit.id}
                          className="grid size-9 shrink-0 place-items-center rounded-xl text-ink/30 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          aria-label={`Xoá ${displayTitle}`}
                          title="Xoá bộ ảnh"
                        >
                          {deletingId === outfit.id ? <LoaderCircle size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
              {renderedOutfits.length < outfits.length && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((current) => current + 30)}
                  className="col-span-full mx-auto rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-bold text-ink shadow-sm transition hover:border-black/20 hover:bg-black/[0.03]"
                >
                  Hiện thêm {Math.min(30, outfits.length - renderedOutfits.length)} bộ
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Lightbox Phóng to ảnh */}
      <ImageLightbox
        open={Boolean(lightbox)}
        src={lightbox?.src ?? ''}
        alt={lightbox?.alt ?? ''}
        onClose={() => setLightbox(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Xoá bộ đồ?"
        description={pendingDelete ? `“${customizations[pendingDelete.id]?.title || 'Bộ thử'}” sẽ bị xoá khỏi Bộ đồ của tôi. Hành động này không thể hoàn tác.` : ''}
        confirmLabel="Xoá bộ đồ"
        cancelLabel="Giữ lại"
        isBusy={deletingId !== null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete)
        }}
      />

      {/* Modal Chỉnh sửa bộ thử */}
      {editingOutfit && (() => {
        const custom = customizations[editingOutfit.id]
        const resolvedEditingOutfit: SavedOutfit = {
          ...editingOutfit,
          frontImageUrl: custom?.frontImageUrl || editingOutfit.frontImageUrl,
          backImageUrl: custom?.backImageUrl !== undefined ? custom.backImageUrl : editingOutfit.backImageUrl,
        }
        const outfitIndex = outfits.findIndex((o) => o.id === editingOutfit.id)
        const defaultTitle = `Bộ thử ${outfitIndex !== -1 ? outfits.length - outfitIndex : ''}`
        const policy = social?.policies.find((item) => item.outfitId === editingOutfit.id)

        return (
          <EditOutfitModal
            outfit={resolvedEditingOutfit}
            defaultTitle={defaultTitle}
            currentTitle={custom?.title || undefined}
            currentVisibility={policy?.visibility ?? social?.me.defaultVisibility ?? 'private'}
            currentGroupIds={policy?.groupIds ?? []}
            groups={social?.groups ?? []}
            onClose={() => setEditingOutfit(null)}
            onSave={handleSaveOutfit}
            onRemoveAngle={handleRemoveAngle}
            onDeleteOutfit={handleDeleteOutfit}
            onZoom={(src, alt) => setLightbox({ src, alt })}
          />
        )
      })()}

      {/* Modal Xem 2 góc */}
      {preview && (() => {
        const custom = customizations[preview.id]
        const previewTitle = custom?.title || formatDate(preview.createdAt)
        const previewFront = custom?.frontImageUrl || preview.frontImageUrl
        const previewBack = custom?.backImageUrl !== undefined ? custom.backImageUrl : preview.backImageUrl

        return createPortal(
          <div
            className="fixed inset-0 z-[100] grid place-items-end bg-black/85 p-0 backdrop-blur-xl sm:place-items-center sm:p-4"
            role="presentation"
            onMouseDown={(event) => event.target === event.currentTarget && setPreview(null)}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Xem bộ ảnh"
              className="relative max-h-[100dvh] w-full max-w-4xl overflow-y-auto border border-white/10 bg-[#16171b] shadow-2xl sm:max-h-[92dvh] sm:rounded-[32px]"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 text-white">
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Atelier Preview</span>
                  <span className="text-white/20">·</span>
                  <span className="text-xs font-semibold text-white/80">{previewTitle}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOutfit(preview)
                      setPreview(null)
                    }}
                    className="grid size-9 place-items-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
                    title="Chỉnh sửa bộ thử"
                    aria-label="Chỉnh sửa bộ thử"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="grid size-9 place-items-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
                    aria-label="Đóng"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className={'grid gap-px bg-white/10 ' + (previewBack ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 max-w-lg mx-auto')}>
                <div
                  className="group/p relative aspect-[4/5] cursor-zoom-in bg-[#111215]"
                  onClick={() => setLightbox({ src: previewFront, alt: `${previewTitle} - Góc trước` })}
                >
                  <img src={previewFront} alt="Ảnh mặt trước phóng to" className="h-full w-full object-contain" />
                  {previewBack && (
                    <span className="absolute left-4 top-4 rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold text-white backdrop-blur-md">
                      GÓC TRƯỚC
                    </span>
                  )}
                  <span className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-xl bg-white/90 text-ink opacity-0 transition group-hover/p:opacity-100">
                    <Maximize2 size={13} />
                  </span>
                </div>
                {previewBack && (
                  <div
                    className="group/p relative grid aspect-[4/5] cursor-zoom-in place-items-center bg-[#111215]"
                    onClick={() => setLightbox({ src: previewBack, alt: `${previewTitle} - Góc sau` })}
                  >
                    <img src={previewBack} alt="Ảnh mặt sau phóng to" className="h-full w-full object-contain" />
                    <span className="absolute left-4 top-4 rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold text-white backdrop-blur-md">
                      GÓC SAU
                    </span>
                    <span className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-xl bg-white/90 text-ink opacity-0 transition group-hover/p:opacity-100">
                      <Maximize2 size={13} />
                    </span>
                  </div>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )
      })()}
    </main>
  )
}
