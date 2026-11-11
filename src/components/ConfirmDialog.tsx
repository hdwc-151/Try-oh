import { AlertTriangle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  rememberLabel?: string
  isBusy?: boolean
  onCancel: () => void
  onConfirm: (rememberChoice: boolean) => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Xoá',
  cancelLabel = 'Huỷ',
  rememberLabel,
  isBusy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [rememberChoice, setRememberChoice] = useState(false)

  useEffect(() => {
    if (!open) return
    setRememberChoice(false)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onCancel()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isBusy, onCancel, open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-3 backdrop-blur-md sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) onCancel()
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-white/60 bg-white/95 shadow-[0_30px_90px_rgba(23,33,29,0.28)] backdrop-blur-xl sm:rounded-[32px]"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-ink/35 transition hover:bg-black/5 hover:text-ink disabled:opacity-30"
          aria-label="Đóng"
        >
          <X size={18} />
        </button>

        <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-6 sm:px-8 sm:pt-7">
          <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-red-50 text-red-600 shadow-sm">
            <AlertTriangle size={22} aria-hidden="true" />
          </span>
          <h2 id="confirm-dialog-title" className="pr-8 font-display text-xl font-bold leading-tight text-ink">
            {title}
          </h2>
          <p id="confirm-dialog-description" className="mt-2 text-xs leading-6 text-ink/55 sm:text-sm">
            {description}
          </p>

          {rememberLabel && (
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-xs text-ink/70">
              <input
                type="checkbox"
                checked={rememberChoice}
                onChange={(event) => setRememberChoice(event.target.checked)}
                disabled={isBusy}
                className="mt-0.5 size-4 rounded border-black/20 text-ink focus:ring-sage-500"
              />
              <span className="leading-5">{rememberLabel}</span>
            </label>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-black/[0.055] bg-[#faf9f6] px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-8 sm:py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="rounded-full px-5 py-2.5 text-xs font-bold text-ink/60 transition hover:bg-black/5 hover:text-ink disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(rememberChoice)}
            disabled={isBusy}
            className="rounded-full bg-red-600 px-6 py-2.5 text-xs font-bold text-white shadow-[0_8px_20px_rgba(220,38,38,0.2)] transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-55"
          >
            {isBusy ? 'Đang xoá…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
