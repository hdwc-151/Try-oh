import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

type ImageLightboxProps = {
  open: boolean
  src: string
  alt: string
  onClose: () => void
}

export function ImageLightbox({ open, src, alt, onClose }: ImageLightboxProps) {
  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose, open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-black/80 p-3 backdrop-blur-md sm:p-6"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section role="dialog" aria-modal="true" aria-label="Xem ảnh phóng to" className="relative flex h-[calc(100dvh-1.5rem)] w-full max-w-6xl items-center justify-center overflow-hidden rounded-[24px] bg-[#eeece6] shadow-2xl sm:h-[calc(100dvh-3rem)]">
        <button autoFocus type="button" onClick={onClose} className="absolute right-3 top-3 z-10 grid size-10 place-items-center rounded-full bg-white/95 text-ink shadow-md backdrop-blur-md transition hover:bg-white" aria-label="Đóng">
          <X size={18} />
        </button>
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
      </section>
    </div>,
    document.body,
  )
}
