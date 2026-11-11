import { Check, Layers, LoaderCircle, Maximize2, Sparkles } from 'lucide-react'
import { garmentCategoryLabels, type GarmentCategory } from '../../types/fitting-room'
import type { ExtractedGarmentCard, GarmentZoomImage } from './types'

type ExtractedGarmentGridProps = {
  items: ExtractedGarmentCard[]
  primaryBlob: Blob | null
  defaultCategory: GarmentCategory
  isSaving: boolean
  onSaveAll: () => void
  onToggle: (id: string) => void
  onNameChange: (id: string, name: string) => void
  onCategoryChange: (id: string, category: GarmentCategory) => void
  onMakePrimary: (item: ExtractedGarmentCard) => void
  onZoom: (image: GarmentZoomImage) => void
}

export function ExtractedGarmentGrid({
  items,
  primaryBlob,
  defaultCategory,
  isSaving,
  onSaveAll,
  onToggle,
  onNameChange,
  onCategoryChange,
  onMakePrimary,
  onZoom,
}: ExtractedGarmentGridProps) {
  const selectedCount = items.filter((item) => item.selected).length

  if (items.length <= 1) return null

  return (
    <div className="rounded-3xl border border-violet-200/80 bg-gradient-to-br from-violet-50/70 via-white to-indigo-50/50 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 pb-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-sm">
            <Layers size={18} />
          </span>
          <div>
            <h4 className="text-sm font-bold text-ink">Phát hiện {items.length} món đồ trong ảnh</h4>
            <p className="text-[11px] text-ink/55">
              Mỗi món đã được tạo ảnh studio riêng biệt. Bạn có thể kiểm tra ảnh, sửa tên và lưu vào tủ đồ:
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onSaveAll}
          disabled={isSaving || selectedCount === 0}
          className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-md transition hover:opacity-95 hover:shadow-lg disabled:opacity-40"
        >
          {isSaving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} strokeWidth={2.5} />}
          <span>Lưu tất cả ({selectedCount}) món vào tủ đồ</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item, index) => {
          const isPrimary =
            primaryBlob === item.blob ||
            (!primaryBlob && (item.category === defaultCategory || index === 0))

          return (
            <article
              key={item.id}
              className={
                'group relative flex flex-col justify-between overflow-hidden rounded-3xl border transition-all duration-200 ' +
                (item.selected
                  ? 'border-violet-300 bg-white shadow-sm ring-1 ring-violet-200/50 hover:shadow-md'
                  : 'border-black/[0.08] bg-white/70 opacity-60 hover:opacity-90')
              }
            >
              <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden border-b border-black/[0.06] bg-[radial-gradient(circle_at_center,#ffffff_0%,#f5f4ef_100%)] p-3">
                <button
                  type="button"
                  className="size-full cursor-zoom-in"
                  onClick={() => onZoom({ url: item.previewUrl, title: item.name })}
                  title="Nhấn để xem ảnh phóng to"
                >
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    className="size-full object-contain drop-shadow-sm transition-transform duration-300 ease-out group-hover:scale-105"
                  />
                </button>
                <span className="viewfinder-corner-tl opacity-30" />
                <span className="viewfinder-corner-tr opacity-30" />
                <span className="viewfinder-corner-bl opacity-30" />
                <span className="viewfinder-corner-br opacity-30" />

                <button
                  type="button"
                  onClick={() => onToggle(item.id)}
                  className="absolute left-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-xl bg-white/90 shadow-sm backdrop-blur-md transition hover:scale-105"
                  aria-label={item.selected ? `Bỏ chọn ${item.name}` : `Chọn ${item.name}`}
                  title={item.selected ? 'Bỏ chọn món này' : 'Chọn món này để lưu'}
                >
                  {item.selected ? (
                    <span className="grid size-5 place-items-center rounded-lg bg-violet-600 text-white shadow-xs">
                      <Check size={13} strokeWidth={3} />
                    </span>
                  ) : (
                    <span className="size-5 rounded-lg border-2 border-black/20 bg-white" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onZoom({ url: item.previewUrl, title: item.name })}
                  className="absolute right-2.5 top-2.5 z-10 grid size-7 place-items-center rounded-xl bg-black/60 text-white opacity-0 shadow-sm backdrop-blur-md transition-all duration-200 group-hover:opacity-100 hover:bg-black/80"
                  title="Phóng to ảnh"
                  aria-label={`Phóng to ${item.name}`}
                >
                  <Maximize2 size={13} />
                </button>

                <div className="absolute bottom-2.5 left-2.5 z-10 flex items-center gap-1.5">
                  {isPrimary ? (
                    <span className="flex items-center gap-1 rounded-full bg-violet-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm backdrop-blur-md">
                      <Sparkles size={11} />
                      <span>Đồ chính ở trên</span>
                    </span>
                  ) : (
                    <span className="rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-semibold text-white/90 shadow-sm backdrop-blur-md">
                      {garmentCategoryLabels[item.category]}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-1 flex-col justify-between space-y-3 p-3.5">
                <div className="space-y-2.5">
                  <div>
                    <label htmlFor={`extracted-name-${item.id}`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink/45">
                      Tên món đồ
                    </label>
                    <input
                      id={`extracted-name-${item.id}`}
                      type="text"
                      value={item.name}
                      onChange={(event) => onNameChange(item.id, event.target.value)}
                      placeholder="Tên món đồ..."
                      className="w-full rounded-xl border border-black/10 bg-black/[0.02] px-3 py-1.5 text-xs font-bold text-ink outline-none transition placeholder:text-ink/25 focus:border-violet-500 focus:bg-white focus:ring-2 focus:ring-violet-100"
                    />
                  </div>

                  <div>
                    <label htmlFor={`extracted-category-${item.id}`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-ink/45">
                      Phân loại tủ đồ
                    </label>
                    <select
                      id={`extracted-category-${item.id}`}
                      value={item.category}
                      onChange={(event) => onCategoryChange(item.id, event.target.value as GarmentCategory)}
                      className="w-full rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-ink/80 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    >
                      {Object.entries(garmentCategoryLabels).map(([category, label]) => (
                        <option key={category} value={category}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-1">
                  {isPrimary ? (
                    <div className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50/80 py-2 text-[11px] font-bold text-violet-700">
                      <Check size={13} strokeWidth={2.5} />
                      <span>Đang chọn hiển thị ở trên</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onMakePrimary(item)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-black/10 bg-white py-2 text-[11px] font-bold text-ink/75 shadow-xs transition hover:border-violet-400 hover:bg-violet-600 hover:text-white"
                    >
                      <Sparkles size={12} />
                      <span>Chọn làm ảnh chính</span>
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
