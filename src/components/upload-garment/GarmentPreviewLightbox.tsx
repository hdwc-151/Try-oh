import { X, ZoomIn } from 'lucide-react'
import type { GarmentZoomImage } from './types'

type GarmentPreviewLightboxProps = {
  image: GarmentZoomImage
  garmentName: string
  categoryLabel: string
  onClose: () => void
}

export function GarmentPreviewLightbox({
  image,
  garmentName,
  categoryLabel,
  onClose,
}: GarmentPreviewLightboxProps) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-3 backdrop-blur-md animate-in fade-in duration-200 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Phóng to ${image.title}`}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-[#161616]/95 p-4 shadow-2xl backdrop-blur-2xl sm:max-h-[92dvh] sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-3 flex w-full items-center justify-between gap-3 border-b border-white/10 pb-3 text-white">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/10 text-white shadow-inner">
              <ZoomIn size={16} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-wide text-white">{image.title}</p>
              <p className="truncate text-[11px] text-white/50">
                {garmentName.trim() || categoryLabel} · Kích thước xem đầy đủ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
            aria-label="Đóng phóng to"
          >
            <X size={18} />
          </button>
        </header>

        <div className="relative flex max-h-[72dvh] w-full items-center justify-center overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_center,#262626_0%,#0f0f0f_100%)] p-3 shadow-inner sm:p-4">
          <img
            src={image.url}
            alt={image.title}
            className="max-h-[68dvh] w-auto max-w-full select-none object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.6)]"
          />
        </div>

        <div className="mt-3 flex w-full items-center justify-between text-[11px] text-white/40">
          <span>Nhấn ESC hoặc bấm ra ngoài để đóng</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-1.5 font-bold text-white/90 transition hover:bg-white/20"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
