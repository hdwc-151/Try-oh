import { Camera, Maximize2, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFittingRoomStore } from '../store/useFittingRoomStore'
import { MAX_SELECTED_GARMENTS, type AngleGenerationState, type Garment, type TryOnAngle } from '../types/fitting-room'
import { ImageLightbox } from './ImageLightbox'

const angles: Array<{ key: TryOnAngle; label: string; number: string; subLabel: string }> = [
  { key: 'front', label: 'GÓC TRƯỚC', number: '01', subLabel: 'FRONT VIEW' },
  { key: 'back', label: 'GÓC SAU', number: '02', subLabel: 'BACK VIEW' },
]

type ResultStageProps = {
  states: Record<TryOnAngle, AngleGenerationState>
  onRegenerate: (angle: TryOnAngle) => Promise<void>
  onSelectImage: () => void
}

function GenerationPlaceholder({ label }: { label: string }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const visualProgress = Math.min(92, 14 + elapsedSeconds * 2.2)

  return (
    <div className="generation-loading absolute inset-0 grid place-items-center overflow-hidden px-6" role="status" aria-live="polite">
      <span className="generation-scan-line" aria-hidden="true" />
      <div className="generation-loading-content relative z-[2] w-full max-w-[260px] text-center text-ink">
        <span className="generation-orbit mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-black/[0.08] bg-white/80 shadow-[0_12px_36px_rgba(22,23,27,0.12)] backdrop-blur-md">
          <Sparkles size={22} className="text-amber-500 animate-pulse" aria-hidden="true" />
        </span>
        <div className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/70 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-ink/70 backdrop-blur-sm">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-ping" />
          Studio Render · {label}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
          <span className="generation-progress block h-full rounded-full bg-gradient-to-r from-ink via-sage-700 to-amber-500" style={{ width: `${visualProgress}%` }} />
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-semibold text-ink/40">
          <span>Đang tạo ảnh</span>
          <span className="generation-dot" />
          <span className="generation-dot" />
          <span className="generation-dot" />
          <span className="ml-1 tabular-nums font-mono">{elapsedSeconds}s</span>
        </div>
      </div>
    </div>
  )
}

export function ResultStage({ states, onRegenerate, onSelectImage }: ResultStageProps) {
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null)
  const garments = useFittingRoomStore((state) => state.garments)
  const outfit = useFittingRoomStore((state) => state.outfit)
  const selectGarment = useFittingRoomStore((state) => state.selectGarment)
  const selectedIds = [
    outfit.tops,
    outfit.outerwear,
    outfit.bottoms,
    outfit.shoes,
    ...outfit.accessories,
  ].filter((id): id is string => Boolean(id))
  const selected = selectedIds
    .map((id) => garments.find((garment) => garment.id === id))
    .filter((garment): garment is Garment => garment !== undefined)

  return (
    <section className="flex min-h-[560px] flex-col overflow-x-hidden overflow-y-auto rounded-[32px] border border-black/[0.06] bg-[#eae7de]/70 shadow-[0_20px_50px_rgba(23,33,29,0.06)] backdrop-blur-md lg:h-full lg:min-h-0">
      <div className="flex flex-col gap-2 border-b border-black/[0.05] px-6 pb-3.5 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-bold text-ink">Kết quả thử đồ</h2>
          <p className="mt-0.5 text-[11px] text-ink/45">Góc trước và góc sau</p>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-5">
        <div className="grid min-h-[460px] grid-cols-1 gap-4 rounded-[28px] border border-white/80 bg-white/40 p-3 sm:grid-cols-2 sm:gap-4 sm:p-4 lg:min-h-[540px]">
          {angles.map((angle) => {
            const state = states[angle.key]
            return (
              <div
                key={angle.key}
                className="group relative grid min-h-[260px] place-items-center overflow-hidden rounded-[24px] border border-white/85 bg-gradient-to-b from-white/80 to-[#f3f0ea]/70 shadow-xs lg:min-h-0"
              >
                {/* Viewfinder corner crop marks */}
                <span className="viewfinder-corner-tl" />
                <span className="viewfinder-corner-tr" />
                <span className="viewfinder-corner-bl" />
                <span className="viewfinder-corner-br" />

                {/* Top Angle Badge */}
                <div className="absolute left-3.5 top-3.5 z-10 flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white/85 px-3 py-1 shadow-xs backdrop-blur-md">
                  <span className="font-mono text-[9px] font-bold text-ink/40">{angle.number}</span>
                  <span className="h-2.5 w-px bg-black/[0.1]" />
                  <span className="text-[9.5px] font-bold tracking-[0.14em] text-ink/75">{angle.label}</span>
                </div>

                {state.status === 'success' && state.result ? (
                  <>
                    <img
                      src={state.result.imageUrl}
                      alt={'Kết quả góc ' + angle.label.toLowerCase()}
                      onClick={() => setLightboxImage({ src: state.result!.imageUrl, alt: `Kết quả ${angle.label}` })}
                      className="h-full min-h-0 w-full cursor-zoom-in object-contain transition-transform duration-500 group-hover:scale-[1.015]"
                    />

                    {/* Bottom floating action bar */}
                    <div className="absolute bottom-3 inset-x-3.5 z-10 flex items-center justify-between gap-2">
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-black/55 px-2.5 py-1 font-mono text-[9px] font-bold text-white shadow-xs backdrop-blur-md">
                        PORTRAIT · 4:5
                      </span>

                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          type="button"
                          onClick={() => setLightboxImage({ src: state.result!.imageUrl, alt: `Kết quả ${angle.label}` })}
                          className="flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/95 px-3 py-1.5 text-[10px] font-bold text-ink shadow-sm backdrop-blur-md transition hover:bg-white hover:shadow-md"
                          title="Phóng to ảnh"
                        >
                          <Maximize2 size={12} /> Phóng to
                        </button>
                        <button
                          type="button"
                          onClick={() => void onRegenerate(angle.key)}
                          className="flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/95 px-3 py-1.5 text-[10px] font-bold text-ink shadow-sm backdrop-blur-md transition hover:bg-white hover:shadow-md"
                          title="Tạo lại góc này"
                        >
                          <RefreshCw size={11} /> Tạo lại
                        </button>
                      </div>
                    </div>
                  </>
                ) : state.status === 'loading' ? (
                  <GenerationPlaceholder label={angle.label} />
                ) : state.status === 'error' ? (
                  <div className="max-w-xs px-5 text-center">
                    <div className="mx-auto mb-2.5 grid size-10 place-items-center rounded-2xl bg-red-100 text-red-600">
                      <RefreshCw size={16} />
                    </div>
                    <p className="text-xs leading-5 text-red-700 font-medium">{state.error}</p>
                    <button
                      type="button"
                      onClick={() => void onRegenerate(angle.key)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-4 py-1.5 text-xs font-bold text-red-700 shadow-xs transition hover:bg-red-50"
                    >
                      <RefreshCw size={12} /> Thử lại
                    </button>
                  </div>
                ) : (
                  <div className="text-center px-6">
                    <button
                      type="button"
                      onClick={onSelectImage}
                      className="mx-auto mb-3 grid size-14 place-items-center rounded-3xl border border-black/[0.07] bg-white/60 text-ink/25 shadow-xs backdrop-blur-xs transition hover:border-sage-300 hover:bg-white hover:text-sage-700 hover:shadow-sm"
                      aria-label={`Chọn ảnh toàn thân cho ${angle.label.toLowerCase()}`}
                      title="Chọn ảnh toàn thân"
                    >
                      <Camera size={24} strokeWidth={1.5} />
                    </button>
                    {angle.key === 'back' && states.front.status === 'success' ? (
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-ink/70">Ảnh góc sau chưa tạo</p>
                        <p className="text-[11px] leading-4 text-ink/40 max-w-[200px] mx-auto">Tạo góc sau để hoàn thiện lookbook thời trang 2 góc nhìn</p>
                        <button
                          type="button"
                          onClick={() => void onRegenerate('back')}
                          className="inline-flex items-center gap-2 rounded-full bg-[#16171b] px-4 py-2 text-xs font-bold text-white shadow-md transition hover:bg-black hover:scale-105"
                        >
                          <Sparkles size={13} className="text-amber-300" /> Tạo góc sau
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-bold text-ink/40 tracking-wide uppercase">
                          {angle.key === 'back' ? 'Chờ tạo góc trước' : 'Sẵn sàng tạo ảnh'}
                        </p>
                        <p className="mt-1 text-[11px] text-ink/30">Ảnh studio 4:5 sẽ xuất hiện tại đây</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Lookbook ribbon */}
      <div className="shrink-0 border-t border-black/[0.05] bg-white/40 px-6 py-3.5 backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold text-ink/55">
            Bộ đồ đã chọn · {selected.length}/{MAX_SELECTED_GARMENTS} món
          </p>
          <span className="text-[10px] font-medium text-ink/40">Theo thứ tự phối</span>
        </div>
        {selected.length ? (
          <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
            {selected.map((garment, idx) => (
              <div
                key={garment.id}
                className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-black/[0.06] bg-white/85 p-1.5 pr-3 text-xs font-bold text-ink shadow-2xs backdrop-blur-sm transition-transform hover:-translate-y-0.5"
              >
                <div className="relative size-9 overflow-hidden rounded-xl bg-[#f4f2ec] p-0.5">
                  <img src={garment.frontProcessedUrl} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
                  <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/60 px-1 font-mono text-[7.5px] font-bold text-white">
                    {idx + 1}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate max-w-32 text-[11px] font-bold text-ink">{garment.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => selectGarment(garment.category, garment.id)}
                  className="grid size-6 place-items-center rounded-full text-ink/35 transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Bỏ ${garment.name} khỏi bộ đồ`}
                  title="Bỏ món này"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink/40 py-1">Chưa có món nào được chọn. Hãy chuẩn bị đồ trong tủ đồ.</p>
        )}
      </div>

      {lightboxImage && (
        <ImageLightbox
          open={Boolean(lightboxImage)}
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </section>
  )
}
