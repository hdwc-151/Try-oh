import { Maximize2 } from 'lucide-react'

type PreviewCardProps = {
  label: string
  url: string | null
  emptyText: string
  onZoom?: () => void
}

export function PreviewCard({ label, url, emptyText, onZoom }: PreviewCardProps) {
  const canZoom = Boolean(url && onZoom)

  return (
    <div className="flex h-full min-h-[175px] min-w-0 flex-col">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-ink/40">{label}</p>
      <button
        type="button"
        disabled={!canZoom}
        onClick={onZoom}
        className={
          'group relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-black/[0.08] bg-[radial-gradient(circle_at_center,#ffffff_0%,#f1efe9_100%)] shadow-sm transition-all ' +
          (canZoom ? 'cursor-zoom-in hover:border-black/25 hover:shadow-md' : 'cursor-default')
        }
        title={canZoom ? 'Xem ảnh phóng to' : undefined}
      >
        {url ? (
          <>
            <img
              src={url}
              alt={label}
              className="h-full w-full object-contain p-3.5 transition-transform duration-300 ease-out group-hover:scale-105"
            />
            <span className="viewfinder-corner-tl opacity-40" />
            <span className="viewfinder-corner-tr opacity-40" />
            <span className="viewfinder-corner-bl opacity-40" />
            <span className="viewfinder-corner-br opacity-40" />
            <span className="pointer-events-none absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-white opacity-0 shadow-sm backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100">
              <Maximize2 size={10} />
              <span>Phóng to</span>
            </span>
          </>
        ) : (
          <span className="px-4 text-center text-xs leading-5 text-ink/35">{emptyText}</span>
        )}
      </button>
    </div>
  )
}
