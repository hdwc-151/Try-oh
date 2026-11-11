import { ArrowRight, Check, ImagePlus, LoaderCircle, Maximize2, Pencil, Plus, Search, Shirt, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { garmentApi } from '../services/garment-api'
import { useFittingRoomStore } from '../store/useFittingRoomStore'
import { garmentCategoryLabels, MAX_SELECTED_GARMENTS, MAX_WARDROBE_GARMENTS, type Garment, type GarmentCategory } from '../types/fitting-room'
import { ConfirmDialog } from './ConfirmDialog'
import { EditGarmentModal } from './EditGarmentModal'
import { ImageLightbox } from './ImageLightbox'

const categories = Object.keys(garmentCategoryLabels) as GarmentCategory[]
const skipGarmentDeleteConfirmationKey = 'fitting-room:skip-garment-delete-confirmation-this-session'

type WardrobeGarmentCardProps = {
  garment: Garment
  isSelected: boolean
  onSelect: () => void
  onEdit?: (garment: Garment) => void
  onDelete: (id: string, name: string) => void
  onZoom: (url: string, title: string) => void
}

function WardrobeGarmentCard({ garment, isSelected, onSelect, onEdit, onDelete, onZoom }: WardrobeGarmentCardProps) {
  const [viewSide, setViewSide] = useState<'front' | 'back'>('front')
  const hasBack = Boolean(garment.backProcessedUrl || garment.backOriginalUrl)
  const currentUrl = viewSide === 'front' || !hasBack
    ? (garment.frontProcessedUrl || garment.frontOriginalUrl)
    : (garment.backProcessedUrl || garment.backOriginalUrl)!

  return (
    <div
      className={
        'group relative flex flex-col justify-between overflow-hidden rounded-2xl border transition-all duration-200 ' +
        (isSelected
          ? 'border-ink bg-white shadow-[0_12px_28px_rgba(23,33,29,0.12)] ring-2 ring-ink/20'
          : 'border-black/[0.07] bg-white hover:-translate-y-0.5 hover:border-black/20 hover:shadow-[0_10px_24px_rgba(0,0,0,0.06)]')
      }
    >
      {/* Clickable Image & Title Area to select garment */}
      <div className="relative">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={isSelected}
          aria-label={`Chọn ${garment.name}`}
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500"
        >
          <div className="relative aspect-[4/5] overflow-hidden bg-[radial-gradient(circle_at_center,#ffffff_0%,#f1efe9_100%)]">
            <img
              key={currentUrl}
              src={currentUrl}
              alt={`${garment.name} (${viewSide === 'front' ? 'mặt trước' : 'mặt sau'})`}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-contain p-3 transition-transform duration-300 ease-out group-hover:scale-105"
            />

            {/* Viewfinder corner brackets on hover */}
            <span className="viewfinder-corner-tl opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
            <span className="viewfinder-corner-tr opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
            <span className="viewfinder-corner-bl opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
            <span className="viewfinder-corner-br opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

            {/* Quick zoom button on hover */}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onZoom(currentUrl, `${garment.name} (${viewSide === 'front' ? 'mặt trước' : 'mặt sau'})`)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  onZoom(currentUrl, `${garment.name} (${viewSide === 'front' ? 'mặt trước' : 'mặt sau'})`)
                }
              }}
              className="absolute left-2.5 bottom-2.5 z-10 flex size-7 items-center justify-center rounded-lg bg-black/50 text-white opacity-0 shadow-md backdrop-blur-md transition hover:bg-black/80 group-hover:opacity-100 cursor-zoom-in"
              aria-label={`Phóng to ${garment.name}`}
              title={`Phóng to ${garment.name}`}
            >
              <Maximize2 size={13} />
            </span>

            {isSelected && (
              <span
                className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[10px] font-bold text-white shadow-md backdrop-blur-md"
                aria-label="Đang chọn"
              >
                <Check size={12} strokeWidth={3} />
                <span>Đang chọn</span>
              </span>
            )}
          </div>

          <div className="px-3 pt-2.5 pb-1">
            <p className="truncate text-xs font-bold tracking-tight text-ink" title={garment.name}>
              {garment.name}
            </p>
          </div>
        </button>

        {/* Top-right corner 2-goc badge (non-nested) */}
        <span className="pointer-events-none absolute right-2.5 top-2.5 rounded-full border border-black/5 bg-white/90 px-2 py-0.5 text-[9px] font-bold text-ink/60 shadow-sm backdrop-blur-md">
          {hasBack ? '2 góc' : '1 góc'}
        </span>
      </div>

      {/* Bottom control row: [ Trước | Sau ] swap toggle and Delete button */}
      <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
        {hasBack ? (
          <div
            className="inline-flex items-center rounded-lg border border-black/[0.08] bg-black/[0.04] p-0.5 text-[10px]"
            role="group"
            aria-label="Chọn mặt hiển thị"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setViewSide('front')
              }}
              className={
                'rounded-md px-2.5 py-0.5 text-[10px] transition-all ' +
                (viewSide === 'front'
                  ? 'bg-white font-bold text-ink shadow-xs border border-black/[0.06]'
                  : 'font-medium text-ink/45 hover:text-ink')
              }
              aria-pressed={viewSide === 'front'}
            >
              Trước
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setViewSide('back')
              }}
              className={
                'rounded-md px-2.5 py-0.5 text-[10px] transition-all ' +
                (viewSide === 'back'
                  ? 'bg-white font-bold text-ink shadow-xs border border-black/[0.06]'
                  : 'font-medium text-ink/45 hover:text-ink')
              }
              aria-pressed={viewSide === 'back'}
            >
              Sau
            </button>
          </div>
        ) : (
          <span className="text-[10px] font-medium text-ink/35">Chỉ có mặt trước</span>
        )}

        <div className="flex items-center gap-0.5">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(garment)
              }}
              className="grid size-7 place-items-center rounded-lg text-ink/40 transition hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500"
              aria-label={'Chỉnh sửa ' + garment.name}
              title={'Chỉnh sửa ' + garment.name}
            >
              <Pencil size={12} />
            </button>
          )}

          <button
            type="button"
            onClick={() => onDelete(garment.id, garment.name)}
            className="grid size-7 place-items-center rounded-lg text-ink/30 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            aria-label={'Xoá ' + garment.name}
            title={'Xoá ' + garment.name}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

type WardrobePanelProps = {
  onAddGarment: () => void
  onGoToFitting?: () => void
  mode?: 'compact' | 'page'
  maxGarments?: number
}

export function WardrobePanel({ onAddGarment, onGoToFitting, mode = 'compact', maxGarments = MAX_WARDROBE_GARMENTS }: WardrobePanelProps) {
  const [query, setQuery] = useState('')
  const [editingGarment, setEditingGarment] = useState<Garment | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [zoomImage, setZoomImage] = useState<{ url: string; title: string } | null>(null)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)
  const [visibleLimit, setVisibleLimit] = useState(mode === 'page' ? 40 : 20)
  const activeCategory = useFittingRoomStore((state) => state.activeCategory)
  const garments = useFittingRoomStore((state) => state.garments)
  const outfit = useFittingRoomStore((state) => state.outfit)
  const isLoading = useFittingRoomStore((state) => state.isLoadingGarments)
  const error = useFittingRoomStore((state) => state.wardrobeError)
  const setActiveCategory = useFittingRoomStore((state) => state.setActiveCategory)
  const selectGarment = useFittingRoomStore((state) => state.selectGarment)
  const removeGarment = useFittingRoomStore((state) => state.removeGarment)
  const setWardrobeError = useFittingRoomStore((state) => state.setWardrobeError)
  const tabListRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Partial<Record<GarmentCategory, HTMLButtonElement | null>>>({})

  const normalizedQuery = query.trim().toLocaleLowerCase('vi')
  const visibleGarments = garments.filter((garment) => (
    garment.category === activeCategory &&
    (!normalizedQuery || garment.name.toLocaleLowerCase('vi').includes(normalizedQuery))
  ))
  const renderedGarments = visibleGarments.slice(0, visibleLimit)
  const isWardrobeFull = garments.length >= maxGarments
  const selectedCount = [outfit.tops, outfit.outerwear, outfit.bottoms, outfit.shoes]
    .filter(Boolean).length + outfit.accessories.length
  const isGarmentSelected = (garment: Garment) =>
    garment.category === 'accessories'
      ? outfit.accessories.includes(garment.id)
      : outfit[garment.category] === garment.id

  const handleSelect = (garment: Garment) => {
    const isSelected = isGarmentSelected(garment)
    const replacesCurrent = garment.category !== 'accessories' && Boolean(outfit[garment.category])
    if (!isSelected && !replacesCurrent && selectedCount >= MAX_SELECTED_GARMENTS) {
      setSelectionNotice(`Bạn chỉ có thể chọn tối đa ${MAX_SELECTED_GARMENTS} món cho một bộ đồ.`)
      return
    }
    setSelectionNotice(null)
    selectGarment(garment.category, garment.id)
  }

  useEffect(() => {
    setVisibleLimit(mode === 'page' ? 40 : 20)
  }, [activeCategory, mode, normalizedQuery])

  useLayoutEffect(() => {
    const tabList = tabListRef.current
    const activeTab = tabRefs.current[activeCategory]
    if (!tabList || !activeTab) return

    const positionIndicator = () => {
      tabList.style.setProperty('--wardrobe-tab-x', `${activeTab.offsetLeft}px`)
      tabList.style.setProperty('--wardrobe-tab-width', `${activeTab.offsetWidth}px`)
      tabList.dataset.indicatorReady = 'true'
    }

    positionIndicator()
    if (typeof ResizeObserver === 'undefined') return
    const resizeObserver = new ResizeObserver(positionIndicator)
    resizeObserver.observe(tabList)
    resizeObserver.observe(activeTab)
    return () => resizeObserver.disconnect()
  }, [activeCategory])

  const deleteGarment = async (id: string) => {
    setIsDeleting(true)
    try {
      await garmentApi.delete(id)
      removeGarment(id)
      setPendingDelete(null)
    } catch (deleteError) {
      setWardrobeError(deleteError instanceof Error ? deleteError.message : 'Không thể xoá món đồ.')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDelete = (id: string, name: string) => {
    try {
      if (window.sessionStorage.getItem(skipGarmentDeleteConfirmationKey) === 'true') {
        void deleteGarment(id)
        return
      }
    } catch {
      // sessionStorage có thể bị chặn; khi đó vẫn hiển thị xác nhận an toàn.
    }
    setPendingDelete({ id, name })
  }

  const confirmDelete = (rememberChoice: boolean) => {
    if (!pendingDelete) return
    if (rememberChoice) {
      try {
        window.sessionStorage.setItem(skipGarmentDeleteConfirmationKey, 'true')
      } catch {
        // Không lưu được lựa chọn không ảnh hưởng thao tác xoá hiện tại.
      }
    }
    void deleteGarment(pendingDelete.id)
  }

  return (
    <aside className={'flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-black/[0.065] bg-white/80 shadow-[0_16px_40px_rgba(23,33,29,0.06)] backdrop-blur-md sm:rounded-[32px] ' + (mode === 'page' ? 'min-h-[520px] sm:min-h-[620px]' : 'lg:h-full')}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3.5 pt-5 sm:px-6">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">Tủ đồ</h2>
          <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-0.5 text-xs font-bold text-ink/60">
            {garments.length} món
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {onGoToFitting && (
            <button
              type="button"
              onClick={onGoToFitting}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold text-ink shadow-xs transition hover:border-black/20 hover:bg-black/[0.03]"
            >
              <span>Sang phòng thử</span>
              <ArrowRight size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onAddGarment}
            disabled={isWardrobeFull}
            className="group relative flex h-10 items-center gap-1.5 overflow-hidden rounded-full bg-ink px-4 text-xs font-bold text-white shadow-[0_8px_20px_rgba(23,33,29,0.18)] transition-all hover:-translate-y-0.5 hover:bg-sage-800 hover:shadow-[0_12px_24px_rgba(23,33,29,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            aria-label={`Thêm ${garmentCategoryLabels[activeCategory].toLowerCase()}`}
          >
            <Plus size={16} className="transition-transform duration-200 group-hover:rotate-90" />
            <span>{isWardrobeFull ? 'Tủ đồ đã đầy' : `Thêm ${garmentCategoryLabels[activeCategory].toLowerCase()}`}</span>
          </button>
        </div>
      </div>

      <div className="px-4 pb-3">
        <div className="mb-3">
          <label className="relative block">
            <span className="sr-only">Tìm trong tủ đồ</span>
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/35" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm theo tên món đồ…"
              className="w-full rounded-2xl border border-black/[0.07] bg-white/80 py-2.5 pl-10 pr-4 text-sm text-ink outline-none transition focus:border-sage-300 focus:ring-2 focus:ring-sage-300/40"
            />
          </label>
        </div>
        {selectionNotice && (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800" role="alert">
            {selectionNotice}
          </p>
        )}
        <div
          ref={tabListRef}
          className="wardrobe-tab-track scrollbar-none flex gap-1 overflow-x-auto rounded-2xl border border-black/[0.04] bg-black/[0.03] p-1"
          role="tablist"
        >
          <span className="wardrobe-tab-indicator" aria-hidden="true" />
          {categories.map((category) => (
            <button
              key={category}
              ref={(element) => { tabRefs.current[category] = element }}
              type="button"
              role="tab"
              aria-selected={activeCategory === category}
              onClick={() => setActiveCategory(category)}
              className={'wardrobe-tab-button relative z-[1] whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500 ' + (
                activeCategory === category ? 'wardrobe-tab-button-active font-bold text-white' : 'text-ink/55 hover:text-ink'
              )}
            >
              {garmentCategoryLabels[category]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs leading-5 text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="min-h-[260px] flex-1 overflow-y-auto p-4">
        <div key={activeCategory} className="wardrobe-tab-panel">
          {isLoading ? (
            <div className="grid h-full min-h-[240px] place-items-center text-ink/40">
              <LoaderCircle className="animate-spin" size={24} aria-label="Đang tải tủ đồ" />
            </div>
          ) : visibleGarments.length === 0 ? (
            <div className="grid h-full min-h-[260px] place-items-center rounded-3xl border border-dashed border-black/10 bg-black/[0.015] p-6 text-center">
              <div>
                <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl border border-black/[0.05] bg-white text-sage-800 shadow-[0_4px_12px_rgba(0,0,0,0.05)]">
                  <ImagePlus size={20} />
                </span>
                <p className="text-sm font-bold text-ink">{normalizedQuery ? 'Không tìm thấy món phù hợp' : `Chưa có ${garmentCategoryLabels[activeCategory].toLowerCase()}`}</p>
                <p className="mt-1 text-xs leading-5 text-ink/45">{normalizedQuery ? 'Thử tên khác hoặc chuyển danh mục.' : 'Tải ảnh trang phục lên'}</p>
                {!normalizedQuery && (
                <button
                  type="button"
                  onClick={onAddGarment}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-sage-800"
                >
                  <Plus size={14} />
                  <span>Thêm {garmentCategoryLabels[activeCategory].toLowerCase()} đầu tiên</span>
                </button>
                )}
              </div>
            </div>
          ) : (
            <div className={'grid grid-cols-2 gap-3 sm:grid-cols-3 ' + (mode === 'page' ? 'lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6' : 'lg:grid-cols-2')}>
              {renderedGarments.map((garment) => (
                <WardrobeGarmentCard
                  key={garment.id}
                  garment={garment}
                  isSelected={isGarmentSelected(garment)}
                  onSelect={() => handleSelect(garment)}
                  onEdit={(g) => setEditingGarment(g)}
                  onDelete={handleDelete}
                  onZoom={(url, title) => setZoomImage({ url, title })}
                />
              ))}
              {renderedGarments.length < visibleGarments.length && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((current) => current + (mode === 'page' ? 40 : 20))}
                  className="col-span-full mx-auto mt-2 rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-bold text-ink shadow-sm transition hover:border-black/20 hover:bg-black/[0.03]"
                >
                  Hiện thêm {Math.min(mode === 'page' ? 40 : 20, visibleGarments.length - renderedGarments.length)} món
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Xoá món đồ?"
        description={pendingDelete ? `“${pendingDelete.name}” sẽ bị xoá khỏi tủ đồ. Hành động này không thể hoàn tác.` : ''}
        rememberLabel="Không hỏi lại trong phiên này"
        isBusy={isDeleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

      {zoomImage && (
        <ImageLightbox
          open={Boolean(zoomImage)}
          src={zoomImage.url}
          alt={zoomImage.title}
          onClose={() => setZoomImage(null)}
        />
      )}

      {editingGarment && (
        <EditGarmentModal
          garment={editingGarment}
          onClose={() => setEditingGarment(null)}
        />
      )}
    </aside>
  )
}
