import {
  AlertCircle,
  Check,
  Loader2,
  Move,
  RotateCcw,
  RotateCw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

type AvatarCropModalProps = {
  open: boolean
  file: File | null
  onClose: () => void
  onApply: (croppedFile: File) => Promise<void>
}

const VIEWPORT_SIZE = 320
const CROP_DIAMETER = 260
const OUTPUT_SIZE = 512

const toCanvasPoint = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
  const rect = canvas.getBoundingClientRect()
  const scale = VIEWPORT_SIZE / rect.width
  return {
    x: (clientX - rect.left) * scale,
    y: (clientY - rect.top) * scale,
  }
}

export function AvatarCropModal({ open, file, onClose, onApply }: AvatarCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)

  const [imageLoaded, setImageLoaded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0) // 0, 90, 180, 270
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Tải ảnh khi file thay đổi
  useEffect(() => {
    if (!open || !file) {
      setImageLoaded(false)
      imageRef.current = null
      return
    }

    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageRef.current = img
      setImageLoaded(true)
      setZoom(1)
      setRotation(0)
      setPan({ x: 0, y: 0 })
      setErrorMessage(null)
    }
    img.onerror = () => {
      setErrorMessage('Không thể mở tệp ảnh. Vui lòng thử lại với ảnh khác.')
    }
    img.src = objectUrl

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [open, file])

  // Vẽ ảnh và vòng tròn cắt lên canvas tương tác
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img || !imageLoaded) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const V = VIEWPORT_SIZE
    const D = CROP_DIAMETER

    // Xóa khung vẽ
    ctx.clearRect(0, 0, V, V)

    // Tính tỉ lệ cơ sở để ảnh phủ kín đường tròn cắt (cover)
    const isSideways = rotation === 90 || rotation === 270
    const effWidth = isSideways ? img.naturalHeight : img.naturalWidth
    const effHeight = isSideways ? img.naturalWidth : img.naturalHeight
    const baseScale = Math.max(D / effWidth, D / effHeight)
    const currentScale = baseScale * zoom

    // Vẽ ảnh với tâm quay và pan
    ctx.save()
    ctx.translate(V / 2 + pan.x, V / 2 + pan.y)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(currentScale, currentScale)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
    ctx.restore()

    // Lớp phủ tối mờ bên ngoài vòng tròn crop (Dark Mask)
    ctx.save()
    ctx.fillStyle = 'rgba(15, 23, 20, 0.65)'
    ctx.beginPath()
    ctx.rect(0, 0, V, V)
    ctx.arc(V / 2, V / 2, D / 2, 0, Math.PI * 2, true)
    ctx.fill()

    // Đường viền tròn hướng dẫn (Guide Ring)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(V / 2, V / 2, D / 2, 0, Math.PI * 2)
    ctx.stroke()

    // Lưới căn chỉnh 3x3 tinh tế mờ bên trong
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    // Đường ngang
    ctx.moveTo(V / 2 - D / 2, V / 2 - D / 6)
    ctx.lineTo(V / 2 + D / 2, V / 2 - D / 6)
    ctx.moveTo(V / 2 - D / 2, V / 2 + D / 6)
    ctx.lineTo(V / 2 + D / 2, V / 2 + D / 6)
    // Đường dọc
    ctx.moveTo(V / 2 - D / 6, V / 2 - D / 2)
    ctx.lineTo(V / 2 - D / 6, V / 2 + D / 2)
    ctx.moveTo(V / 2 + D / 6, V / 2 - D / 2)
    ctx.lineTo(V / 2 + D / 6, V / 2 + D / 2)
    ctx.stroke()

    ctx.restore()
  }, [imageLoaded, zoom, rotation, pan])

  useEffect(() => {
    renderCanvas()
  }, [renderCanvas])

  // Chuột: Kéo để di chuyển vị trí (Pan)
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = toCanvasPoint(e.currentTarget, e.clientX, e.clientY)
    setIsDragging(true)
    setDragStart({ x: point.x - pan.x, y: point.y - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return
    const point = toCanvasPoint(e.currentTarget, e.clientX, e.clientY)
    setPan({
      x: point.x - dragStart.x,
      y: point.y - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Cảm ứng chạm (Touch / Mobile)
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      const point = toCanvasPoint(e.currentTarget, touch.clientX, touch.clientY)
      setIsDragging(true)
      setDragStart({ x: point.x - pan.x, y: point.y - pan.y })
    }
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDragging || e.touches.length !== 1) return
    const touch = e.touches[0]
    const point = toCanvasPoint(e.currentTarget, touch.clientX, touch.clientY)
    setPan({
      x: point.x - dragStart.x,
      y: point.y - dragStart.y,
    })
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  // Lăn chuột phóng to / thu nhỏ
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.08 : -0.08
    setZoom((prev) => Math.min(3, Math.max(1, Number((prev + delta).toFixed(2)))))
  }

  // Xoay 90 độ
  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360)
  }

  // Đặt lại căn giữa và kích thước ban đầu
  const handleReset = () => {
    setZoom(1)
    setRotation(0)
    setPan({ x: 0, y: 0 })
  }

  // Xuất ảnh chất lượng cao 512x512
  const handleConfirmCrop = async () => {
    const img = imageRef.current
    if (!img || !imageLoaded) return

    setIsSaving(true)
    setErrorMessage(null)

    try {
      const outCanvas = document.createElement('canvas')
      outCanvas.width = OUTPUT_SIZE
      outCanvas.height = OUTPUT_SIZE
      const outCtx = outCanvas.getContext('2d')
      if (!outCtx) throw new Error('Không thể khởi tạo bộ xử lý đồ họa.')

      const D = CROP_DIAMETER
      const exportScaleFactor = OUTPUT_SIZE / D

      const isSideways = rotation === 90 || rotation === 270
      const effWidth = isSideways ? img.naturalHeight : img.naturalWidth
      const effHeight = isSideways ? img.naturalWidth : img.naturalHeight
      const baseScale = Math.max(D / effWidth, D / effHeight)
      const currentScale = baseScale * zoom

      // Vẽ vào canvas đích ở đúng vị trí tâm
      outCtx.save()
      outCtx.translate(OUTPUT_SIZE / 2 + pan.x * exportScaleFactor, OUTPUT_SIZE / 2 + pan.y * exportScaleFactor)
      outCtx.rotate((rotation * Math.PI) / 180)
      outCtx.scale(currentScale * exportScaleFactor, currentScale * exportScaleFactor)
      outCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
      outCtx.restore()

      // Chuyển canvas thành Blob WebP/JPEG chất lượng cao
      const blob = await new Promise<Blob | null>((resolve) => {
        outCanvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
      })

      if (!blob) throw new Error('Không thể tạo tệp ảnh đại diện.')

      const croppedFile = new File([blob], file?.name ? `avatar-${file.name.replace(/\.[^/.]+$/, '')}.jpg` : 'avatar.jpg', {
        type: 'image/jpeg',
      })

      await onApply(croppedFile)
      onClose()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Có lỗi xảy ra khi lưu ảnh.')
    } finally {
      setIsSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[100dvh] w-full max-w-[420px] space-y-4 overflow-y-auto rounded-t-[28px] border border-black/[0.08] bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[92dvh] sm:rounded-[32px] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-1 border-b border-black/[0.06]">
          <div>
            <h3 className="font-display text-base sm:text-lg font-bold text-ink flex items-center gap-2">
              <Sparkles size={16} className="text-amber-500" />
              <span>Chỉnh kích thước ảnh đại diện</span>
            </h3>
            <p className="text-xs text-ink/45">Kéo để di chuyển, dùng thanh trượt hoặc lăn chuột để phóng to/thu nhỏ</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-ink/50 hover:bg-black/[0.05] hover:text-ink transition"
            aria-label="Đóng"
          >
            <X size={17} />
          </button>
        </div>

        {/* Viewport Canvas Area */}
        <div className="relative mx-auto flex flex-col items-center">
          <div className="relative aspect-square w-full max-w-[320px] overflow-hidden rounded-2xl border border-black/10 bg-neutral-900 shadow-inner select-none cursor-grab active:cursor-grabbing">
            <canvas
              ref={canvasRef}
              width={VIEWPORT_SIZE}
              height={VIEWPORT_SIZE}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onWheel={handleWheel}
              className="aspect-square h-auto w-full touch-none"
            />

            {!imageLoaded && (
              <div className="absolute inset-0 grid place-items-center bg-neutral-900 text-white/50 text-xs">
                <Loader2 size={24} className="animate-spin text-sage-400" />
                <span className="mt-2">Đang tải ảnh...</span>
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink/40">
            <Move size={12} />
            <span>Kéo thả để căn góc mặt phù hợp</span>
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs font-semibold text-ink/75">
            <span className="flex items-center gap-1">
              <ZoomOut size={13} className="text-ink/40" />
              <span>Kích thước / Thu phóng</span>
            </span>
            <span className="font-mono text-sage-800 text-[11px]">{Math.round(zoom * 100)}%</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, Number((z - 0.1).toFixed(2))))}
              className="grid size-8 place-items-center rounded-lg border border-black/[0.08] bg-white text-ink shadow-2xs hover:bg-black/[0.02] transition"
              title="Thu nhỏ"
            >
              <ZoomOut size={14} />
            </button>

            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="h-2 w-full flex-1 cursor-pointer appearance-none rounded-lg bg-black/10 accent-sage-700 outline-none"
            />

            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.1).toFixed(2))))}
              className="grid size-8 place-items-center rounded-lg border border-black/[0.08] bg-white text-ink shadow-2xs hover:bg-black/[0.02] transition"
              title="Phóng to"
            >
              <ZoomIn size={14} />
            </button>
          </div>
        </div>

        {/* Quick Tools: Rotate & Reset */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={handleRotate}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-2xs hover:bg-black/[0.02] transition"
          >
            <RotateCw size={13} className="text-sage-700" />
            <span>Xoay 90°</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 py-1.5 text-xs font-semibold text-ink shadow-2xs hover:bg-black/[0.02] transition"
          >
            <RotateCcw size={13} className="text-ink/50" />
            <span>Đặt lại vị trí</span>
          </button>
        </div>

        {/* Error message if any */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-700">
            <AlertCircle size={15} className="shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 rounded-full border border-black/[0.1] bg-white py-2.5 text-xs font-bold text-ink hover:bg-black/[0.03] transition disabled:opacity-50"
          >
            Hủy
          </button>

          <button
            type="button"
            onClick={() => void handleConfirmCrop()}
            disabled={isSaving || !imageLoaded}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-[#16171b] py-2.5 text-xs font-bold text-white shadow-md hover:bg-black transition disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Đang xử lý ảnh...</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span>Lưu ảnh đại diện</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
