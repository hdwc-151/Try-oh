import { Check, LoaderCircle, Maximize2, Pencil, Trash2, X } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FriendGroup, OutfitPolicy } from '../../server/social/types'
import type { SavedOutfit } from '../types/fitting-room'

type EditOutfitModalProps = {
  outfit: SavedOutfit | null
  defaultTitle: string
  currentTitle?: string
  currentVisibility: OutfitPolicy['visibility']
  currentGroupIds: string[]
  groups: FriendGroup[]
  onClose: () => void
  onSave: (id: string, updates: {
    title?: string | null
    visibility: OutfitPolicy['visibility']
    groupIds: string[]
  }) => void | Promise<unknown>
  onRemoveAngle: (id: string, angle: 'front' | 'back') => void | Promise<unknown>
  onDeleteOutfit: (id: string) => void | Promise<unknown>
  onZoom?: (url: string, title: string) => void
}

type PendingRemoval = {
  angle: 'front' | 'back'
}

export function EditOutfitModal({
  outfit,
  defaultTitle,
  currentTitle,
  currentVisibility,
  currentGroupIds,
  groups,
  onClose,
  onSave,
  onRemoveAngle,
  onDeleteOutfit,
  onZoom,
}: EditOutfitModalProps) {
  const [currentOutfit, setCurrentOutfit] = useState<SavedOutfit | null>(outfit)
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState<OutfitPolicy['visibility']>(currentVisibility)
  const [groupIds, setGroupIds] = useState<string[]>(currentGroupIds)
  const [isSaving, setIsSaving] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)

  useEffect(() => {
    setCurrentOutfit(outfit)
    if (outfit) {
      setTitle(currentTitle || '')
      setVisibility(currentVisibility)
      setGroupIds(currentGroupIds)
      setError(null)
      setPendingRemoval(null)
    }
  }, [outfit, currentTitle, currentVisibility, currentGroupIds])

  useEffect(() => {
    if (!outfit) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingRemoval) {
          setPendingRemoval(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [outfit, onClose, pendingRemoval])

  if (!currentOutfit) return null

  const hasBack = Boolean(currentOutfit.backImageUrl)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (visibility === 'groups' && groupIds.length === 0) {
      setError('Hãy chọn ít nhất một nhóm được xem bộ đồ này.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      await onSave(currentOutfit.id, {
        title: title.trim() || null,
        visibility,
        groupIds: visibility === 'groups' ? groupIds : [],
      })
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể lưu thay đổi.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleConfirmRemoval = async () => {
    if (!pendingRemoval || !currentOutfit) return
    setIsRemoving(true)
    setError(null)
    const angle = pendingRemoval.angle

    try {
      if (angle === 'back') {
        await onRemoveAngle(currentOutfit.id, 'back')
        setCurrentOutfit((prev) => (prev ? { ...prev, backImageUrl: null } : null))
        setPendingRemoval(null)
      } else if (angle === 'front') {
        if (hasBack && currentOutfit.backImageUrl) {
          await onRemoveAngle(currentOutfit.id, 'front')
          setCurrentOutfit((prev) =>
            prev ? { ...prev, frontImageUrl: prev.backImageUrl!, backImageUrl: null } : null,
          )
          setPendingRemoval(null)
        } else {
          // Chỉ có 1 ảnh -> xoá toàn bộ bộ thử
          await onDeleteOutfit(currentOutfit.id)
          setPendingRemoval(null)
          onClose()
        }
      }
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Không thể gỡ ảnh.')
    } finally {
      setIsRemoving(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-end bg-black/80 p-0 backdrop-blur-md sm:place-items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pendingRemoval) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Chỉnh sửa bộ thử"
        className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden border border-black/10 bg-panel shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:rounded-[28px]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-2xl bg-sage-100 text-sage-800">
              <Pencil size={15} />
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-ink sm:text-lg">Chỉnh sửa bộ thử</h2>
              <p className="text-[11px] text-ink/45">{currentTitle || defaultTitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-ink/40 transition hover:bg-black/5 hover:text-ink"
            aria-label="Đóng"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
          {error && (
            <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-700" role="alert">
              {error}
            </div>
          )}

          {/* Visual Previews - Tỉ lệ khung vừa vặn chuẩn chỉnh */}
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-bold text-ink/70">Góc nhìn ảnh</label>
              <span className="text-[11px] text-ink/40">
                {hasBack ? 'Bộ 2 góc đầy đủ' : 'Bộ 1 góc'}
              </span>
            </div>

            <div className={'grid gap-3 ' + (hasBack ? 'grid-cols-2' : 'max-w-[240px] mx-auto')}>
              {/* Front view */}
              <div className="group relative h-44 w-full overflow-hidden rounded-2xl bg-[#eeece6] transition sm:h-56">
                <img
                  src={currentOutfit.frontImageUrl}
                  alt="Góc trước"
                  className="size-full object-contain transition-transform duration-200 group-hover:scale-105"
                />
                <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/75 px-2.5 py-0.5 text-[9px] font-bold tracking-wider text-white backdrop-blur-md">
                  TRƯỚC
                </span>

                {/* Action buttons on image */}
                <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  {onZoom && (
                    <button
                      type="button"
                      onClick={() => onZoom(currentOutfit.frontImageUrl, `${currentTitle || defaultTitle} - Mặt trước`)}
                      className="grid size-7 place-items-center rounded-xl bg-white/95 text-ink shadow-sm backdrop-blur-md transition hover:bg-white hover:scale-105"
                      title="Phóng to"
                      aria-label="Phóng to ảnh trước"
                    >
                      <Maximize2 size={12} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingRemoval({ angle: 'front' })}
                    className="grid size-7 place-items-center rounded-xl bg-white/95 text-red-600 shadow-sm backdrop-blur-md transition hover:bg-red-50 hover:scale-105"
                    title="Gỡ ảnh này"
                    aria-label="Gỡ ảnh trước"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Back view if exists */}
              {hasBack && currentOutfit.backImageUrl && (
                <div className="group relative h-44 w-full overflow-hidden rounded-2xl bg-[#eeece6] transition sm:h-56">
                  <img
                    src={currentOutfit.backImageUrl}
                    alt="Góc sau"
                    className="size-full object-contain transition-transform duration-200 group-hover:scale-105"
                  />
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/75 px-2.5 py-0.5 text-[9px] font-bold tracking-wider text-white backdrop-blur-md">
                    SAU
                  </span>

                  {/* Action buttons on image */}
                  <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    {onZoom && (
                      <button
                        type="button"
                        onClick={() => onZoom(currentOutfit.backImageUrl!, `${currentTitle || defaultTitle} - Mặt sau`)}
                        className="grid size-7 place-items-center rounded-xl bg-white/95 text-ink shadow-sm backdrop-blur-md transition hover:bg-white hover:scale-105"
                        title="Phóng to"
                        aria-label="Phóng to ảnh sau"
                      >
                        <Maximize2 size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPendingRemoval({ angle: 'back' })}
                      className="grid size-7 place-items-center rounded-xl bg-white/95 text-red-600 shadow-sm backdrop-blur-md transition hover:bg-red-50 hover:scale-105"
                      title="Gỡ ảnh này"
                      aria-label="Gỡ ảnh sau"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Title Input */}
          <div className="mb-6">
            <label className="mb-1.5 block text-xs font-bold text-ink">
              Tên bộ thử
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={defaultTitle}
              maxLength={60}
              className="w-full rounded-2xl border border-black/[0.08] bg-white px-4 py-2.5 text-sm text-ink outline-none transition focus:border-sage-400 focus:ring-2 focus:ring-sage-400/20"
            />
            <p className="mt-1 text-[11px] text-ink/40">
              Để trống sẽ sử dụng tên mặc định ({defaultTitle}).
            </p>
          </div>

          <div className="mb-6 border-t border-black/[0.06] pt-5">
            <label className="mb-1.5 block text-xs font-bold text-ink" htmlFor="outfit-visibility">
              Ai được xem?
            </label>
            <select
              id="outfit-visibility"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as OutfitPolicy['visibility'])}
              className="w-full rounded-2xl border border-black/[0.08] bg-white px-4 py-2.5 text-sm font-semibold text-ink outline-none transition focus:border-sage-400 focus:ring-2 focus:ring-sage-400/20"
            >
              <option value="private">Chỉ mình tôi</option>
              <option value="friends">Bạn bè</option>
              <option value="groups">Nhóm đã chọn</option>
            </select>

            {visibility === 'groups' && (
              <div className="mt-3 grid gap-2">
                {groups.length > 0 ? groups.map((group) => (
                  <label
                    key={group.id}
                    className="flex cursor-pointer items-center gap-3 rounded-2xl border border-black/[0.07] bg-white px-4 py-3 text-sm font-semibold text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={groupIds.includes(group.id)}
                      onChange={(event) => setGroupIds((current) => event.target.checked
                        ? [...current, group.id]
                        : current.filter((id) => id !== group.id))}
                      className="size-4 accent-sage-700"
                    />
                    <span>{group.name}</span>
                  </label>
                )) : (
                  <p className="rounded-2xl bg-black/[0.035] px-4 py-3 text-xs font-semibold text-ink/55">
                    Chưa có nhóm bạn bè.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="mt-auto flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving || isRemoving}
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold text-ink transition hover:bg-black/5"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={isSaving || isRemoving}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-black disabled:opacity-40"
            >
              {isSaving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
              <span>Lưu thay đổi</span>
            </button>
          </div>
        </form>

        {/* Modal Xác nhận gỡ ảnh (Có hỏi trước) */}
        {pendingRemoval && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-remove-title"
          >
            <div className="w-full max-w-sm rounded-[24px] border border-black/10 bg-white p-5 shadow-2xl">
              <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <Trash2 size={20} />
              </div>
              <h3 id="confirm-remove-title" className="font-display text-base font-bold text-ink">
                {pendingRemoval.angle === 'back'
                  ? 'Gỡ ảnh góc sau?'
                  : hasBack
                    ? 'Gỡ ảnh góc trước?'
                    : 'Xoá bộ thử này?'}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink/65">
                {pendingRemoval.angle === 'back'
                  ? 'Bạn có chắc chắn muốn gỡ ảnh góc sau khỏi bộ thử này không? Bộ thử sẽ chỉ còn lại góc trước.'
                  : hasBack
                    ? 'Gỡ ảnh góc trước sẽ chuyển ảnh góc sau thành ảnh chính của bộ thử. Bạn có muốn tiếp tục?'
                    : 'Bộ thử chỉ còn một ảnh này. Gỡ ảnh sẽ xoá toàn bộ bộ thử khỏi danh sách. Bạn có chắc chắn muốn xoá không?'}
              </p>
              <div className="mt-5 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={() => setPendingRemoval(null)}
                  className="rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold text-ink transition hover:bg-black/5"
                >
                  Huỷ
                </button>
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={handleConfirmRemoval}
                  className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-red-700 disabled:opacity-40"
                >
                  {isRemoving ? <LoaderCircle size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  <span>{hasBack || pendingRemoval.angle === 'back' ? 'Xác nhận gỡ ảnh' : 'Xác nhận xoá'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
