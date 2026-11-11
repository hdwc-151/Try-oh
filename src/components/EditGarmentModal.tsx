import { Check, LoaderCircle, Maximize2, Pencil, X } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { garmentApi } from '../services/garment-api'
import { useFittingRoomStore } from '../store/useFittingRoomStore'
import { Garment, GarmentCategory, garmentCategoryLabels } from '../types/fitting-room'

type EditGarmentModalProps = {
  garment: Garment | null
  onClose: () => void
  onSaved?: (updated: Garment) => void
}

export function EditGarmentModal({ garment, onClose, onSaved }: EditGarmentModalProps) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<GarmentCategory>('tops')
  const [viewSide, setViewSide] = useState<'front' | 'back'>('front')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updateGarmentInStore = useFittingRoomStore((state) => state.updateGarment)

  useEffect(() => {
    if (garment) {
      setName(garment.name)
      setCategory(garment.category)
      setViewSide('front')
      setError(null)
    }
  }, [garment])

  useEffect(() => {
    if (!garment) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [garment, onClose])

  if (!garment) return null

  const hasBack = Boolean(garment.backProcessedUrl || garment.backOriginalUrl)
  const currentUrl = viewSide === 'front' || !hasBack
    ? (garment.frontProcessedUrl || garment.frontOriginalUrl)
    : (garment.backProcessedUrl || garment.backOriginalUrl)!

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Vui lòng nhập tên món đồ.')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const updated = await garmentApi.update(garment.id, {
        name: trimmed,
        category,
      })
      updateGarmentInStore(updated)
      onSaved?.(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật món đồ.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-md sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-garment-title"
        className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-white/60 bg-white/95 shadow-[0_24px_70px_rgba(23,33,29,0.22)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 sm:max-h-[92dvh] sm:rounded-[28px]"
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-ink text-white shadow-xs">
                <Pencil size={15} />
              </span>
              <div>
                <h3 id="edit-garment-title" className="text-sm font-bold text-ink">
                  Chỉnh sửa món đồ
                </h3>
                <p className="text-[11px] text-ink/45">Cập nhật tên và phân loại tủ đồ</p>
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
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            {/* Preview image */}
            <div className="flex flex-col items-center">
              <div className="relative aspect-square w-36 overflow-hidden rounded-2xl border border-black/[0.08] bg-[radial-gradient(circle_at_center,#ffffff_0%,#f1efe9_100%)] p-2 shadow-xs">
                <img
                  src={currentUrl}
                  alt={garment.name}
                  className="size-full object-contain drop-shadow-sm"
                />
                <span className="viewfinder-corner-tl opacity-40" />
                <span className="viewfinder-corner-tr opacity-40" />
                <span className="viewfinder-corner-bl opacity-40" />
                <span className="viewfinder-corner-br opacity-40" />
              </div>

              {hasBack && (
                <div className="mt-2.5 inline-flex items-center rounded-lg border border-black/[0.08] bg-black/[0.04] p-0.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setViewSide('front')}
                    className={
                      'rounded-md px-2.5 py-0.5 text-[10px] transition ' +
                      (viewSide === 'front'
                        ? 'bg-white font-bold text-ink shadow-xs border border-black/[0.06]'
                        : 'font-medium text-ink/50 hover:text-ink')
                    }
                  >
                    Mặt trước
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewSide('back')}
                    className={
                      'rounded-md px-2.5 py-0.5 text-[10px] transition ' +
                      (viewSide === 'back'
                        ? 'bg-white font-bold text-ink shadow-xs border border-black/[0.06]'
                        : 'font-medium text-ink/50 hover:text-ink')
                    }
                  >
                    Mặt sau
                  </button>
                </div>
              )}
            </div>

            {/* Input Name */}
            <div>
              <label htmlFor="edit-name" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink/50">
                Tên món đồ
              </label>
              <input
                id="edit-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
                className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-bold text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-black/5"
                placeholder="Nhập tên món đồ…"
              />
            </div>

            {/* Select Category */}
            <div>
              <label htmlFor="edit-category" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink/50">
                Phân loại tủ đồ
              </label>
              <select
                id="edit-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as GarmentCategory)}
                className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-xs font-semibold text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-black/5"
              >
                {Object.entries(garmentCategoryLabels).map(([catKey, label]) => (
                  <option key={catKey} value={catKey}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs leading-5 text-red-700" role="alert">
                {error}
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2.5 border-t border-black/[0.06] bg-black/[0.015] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-ink/75 transition hover:bg-black/5"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-black disabled:opacity-40"
            >
              {isSaving ? (
                <>
                  <LoaderCircle size={13} className="animate-spin" />
                  <span>Đang lưu…</span>
                </>
              ) : (
                <>
                  <Check size={13} strokeWidth={2.5} />
                  <span>Lưu thay đổi</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
