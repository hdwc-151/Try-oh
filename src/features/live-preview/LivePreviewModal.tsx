import { Camera, Crown, ImagePlus, LoaderCircle, RotateCcw, Sparkles, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import type { RealTimeClient } from '@decartai/sdk'
import { LivePreviewApiError, livePreviewApi } from '../../services/live-preview-api'
import { useFittingRoomStore } from '../../store/useFittingRoomStore'
import { garmentCategoryLabels, type GarmentCategory } from '../../types/fitting-room'
import type { LivePreviewSpeed, LivePreviewStatus } from '../../types/live-preview'
import { thumbnailUrl } from '../../services/image-url'

const categories = Object.keys(garmentCategoryLabels) as GarmentCategory[]
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
/** Give up if the stream never starts: the session is charged, but nobody is left waiting. */
const CONNECT_TIMEOUT_MS = 45_000

type Phase = 'idle' | 'starting' | 'connecting' | 'live' | 'ended'
const SPEED_STORAGE_KEY = 'fitsy.livePreview.speed'

// The chosen tier is only a per-browser convenience; the server checks the plan.
const readStoredSpeed = (): LivePreviewSpeed => {
  try { return window.localStorage.getItem(SPEED_STORAGE_KEY) === 'fast' ? 'fast' : 'standard' } catch { return 'standard' }
}
const storeSpeed = (speed: LivePreviewSpeed) => {
  try { window.localStorage.setItem(SPEED_STORAGE_KEY, speed) } catch { /* storage unavailable */ }
}
type Source = 'wardrobe' | 'upload'

type LivePreviewModalProps = {
  open: boolean
  onClose: () => void
  onOpenPlans: () => void
  /** Called after a session is used so callers can refresh plan counters. */
  onUsed?: (status: LivePreviewStatus) => void
}

const formatReset = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
  : null

export function LivePreviewModal({ open, onClose, onOpenPlans, onUsed }: LivePreviewModalProps) {
  const garments = useFittingRoomStore((state) => state.garments)
  const outfit = useFittingRoomStore((state) => state.outfit)
  const selectedIds = useMemo(
    () => [outfit.tops, outfit.outerwear, outfit.bottoms, outfit.shoes, ...outfit.accessories].filter((id): id is string => Boolean(id)),
    [outfit],
  )
  const [status, setStatus] = useState<LivePreviewStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [source, setSource] = useState<Source>('wardrobe')
  const [garmentId, setGarmentId] = useState<string | null>(null)
  const [upload, setUpload] = useState<File | null>(null)
  const [uploadUrl, setUploadUrl] = useState<string | null>(null)
  const [uploadCategory, setUploadCategory] = useState<GarmentCategory>('tops')
  const [preferredSpeed, setPreferredSpeed] = useState<LivePreviewSpeed>(readStoredSpeed)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const clientRef = useRef<RealTimeClient | null>(null)
  const cameraRef = useRef<MediaStream | null>(null)
  const timersRef = useRef<number[]>([])

  const stop = useCallback((nextPhase: Phase = 'ended') => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current = []
    try { clientRef.current?.disconnect() } catch { /* already closed */ }
    clientRef.current = null
    cameraRef.current?.getTracks().forEach((track) => track.stop())
    cameraRef.current = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    setPhase((current) => (current === 'idle' ? current : nextPhase))
  }, [])

  const close = useCallback(() => {
    stop('idle')
    setPhase('idle')
    onClose()
  }, [onClose, stop])

  useEffect(() => {
    if (!open) return
    setError(null)
    setStatusError(null)
    livePreviewApi.status().then(setStatus).catch((cause: unknown) => {
      setStatusError(cause instanceof Error ? cause.message : 'Không thể tải trạng thái thử trực tiếp.')
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    setGarmentId((current) => current && garments.some((item) => item.id === current)
      ? current
      : selectedIds[0] ?? garments[0]?.id ?? null)
  }, [garments, open, selectedIds])

  useEffect(() => {
    if (!upload) { setUploadUrl(null); return }
    const url = URL.createObjectURL(upload)
    setUploadUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [upload])

  // Never leave the camera or a paid stream running behind a closed dialog.
  useEffect(() => () => stop('idle'), [stop])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const onHide = () => { if (document.visibilityState === 'hidden') stop() }
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [close, open, stop])

  const chooseUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) { setError('Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.'); return }
    if (file.size > MAX_UPLOAD_BYTES) { setError('Ảnh phải nhỏ hơn 8MB.'); return }
    setError(null)
    setUpload(file)
  }

  // A stored "fast" choice falls back to standard when the plan does not include it.
  const speed: LivePreviewSpeed = preferredSpeed === 'fast' && status?.fastModeIncluded ? 'fast' : 'standard'
  const sessionCost = speed === 'fast' ? status?.fastCost ?? 1 : 1
  const chooseSpeed = (value: LivePreviewSpeed) => {
    setPreferredSpeed(value)
    storeSpeed(value)
  }

  const canStart = phase !== 'starting' && phase !== 'connecting' && phase !== 'live'
    && (source === 'wardrobe' ? Boolean(garmentId) : Boolean(upload))

  const start = async () => {
    if (!canStart) return
    setError(null)
    setPhase('starting')
    try {
      // Ask for the camera before charging a session, so a denied permission costs nothing.
      let camera: MediaStream
      try {
        camera = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        })
      } catch {
        throw new Error('Không mở được camera. Hãy cho phép Try-oh dùng camera trong trình duyệt rồi thử lại.')
      }
      cameraRef.current = camera
      if (localVideoRef.current) localVideoRef.current.srcObject = camera

      const [sdk, started] = await Promise.all([
        import('@decartai/sdk'),
        livePreviewApi.start(source === 'wardrobe'
          ? { source: 'wardrobe', garmentId: garmentId!, speed }
          : { source: 'upload', category: uploadCategory, speed }),
      ])
      setStatus(started.status)
      onUsed?.(started.status)
      const seconds = started.session.seconds
      setSecondsLeft(seconds)
      setPhase('connecting')

      const client = sdk.createDecartClient({
        apiKeyProvider: async () => (await livePreviewApi.token(started.session.id)).apiKey,
      })
      const image = started.reference.imageBase64 ?? upload!
      timersRef.current.push(window.setTimeout(() => {
        setError('Kết nối quá lâu nên phiên đã dừng. Hãy kiểm tra mạng rồi thử lại.')
        stop()
      }, CONNECT_TIMEOUT_MS))

      let countdownStarted = false
      const beginCountdown = () => {
        if (countdownStarted) return
        countdownStarted = true
        timersRef.current.forEach((timer) => window.clearTimeout(timer))
        timersRef.current = []
        setPhase('live')
        const endsAt = Date.now() + seconds * 1000
        const tick = () => {
          const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
          setSecondsLeft(left)
          if (left <= 0) stop()
          else timersRef.current.push(window.setTimeout(tick, 250))
        }
        tick()
      }

      const realtime = await client.realtime.connect(camera, {
        model: sdk.models.realtime(started.session.model as Parameters<typeof sdk.models.realtime>[0]),
        mirror: 'auto',
        ...(started.session.speed === 'fast' ? { speed: 'fast' as const } : {}),
        initialState: { prompt: { text: started.reference.prompt, enhance: true }, image },
        onRemoteStream: (stream) => {
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream
        },
        onConnectionChange: (state) => {
          if (state === 'generating') beginCountdown()
        },
      })
      clientRef.current = realtime
      realtime.on('generationTick', beginCountdown)
      realtime.on('sessionEnded', () => stop())
      realtime.on('error', (cause) => {
        setError(cause.message || 'Phiên thử trực tiếp bị gián đoạn.')
        stop()
      })
      if (realtime.getConnectionState() === 'generating') beginCountdown()
    } catch (cause) {
      stop('idle')
      setPhase('idle')
      if (cause instanceof LivePreviewApiError && (cause.code === 'plan_required' || cause.code === 'quota_exhausted')) {
        livePreviewApi.status().then(setStatus).catch(() => undefined)
      }
      setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu thử trực tiếp.')
    }
  }

  if (!open) return null

  const busy = phase === 'starting' || phase === 'connecting'
  const locked = status !== null && !status.included
  const exhausted = status !== null && status.included && !status.unlimited && status.remaining === 0
  const reset = formatReset(status?.nextResetAt ?? null)
  const showStage = phase !== 'idle'

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-3 backdrop-blur-md sm:p-4"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close() }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-preview-title"
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/60 bg-white/95 shadow-[0_30px_90px_rgba(23,33,29,0.28)] backdrop-blur-xl sm:rounded-[32px]"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-full bg-white/80 text-ink/45 transition hover:bg-black/5 hover:text-ink"
          aria-label="Đóng"
        >
          <X size={18} />
        </button>

        <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-6 sm:px-7 sm:pt-7">
          <div className="pr-10">
            <h2 id="live-preview-title" className="flex items-center gap-2 font-display text-xl font-bold text-ink">
              <Camera size={20} className="text-sage-700" /> Thử trực tiếp bằng camera
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink/55 sm:text-sm">
              Xem nhanh món đồ trên người bạn trong {status?.sessionSeconds ?? 10} giây trước khi tạo ảnh chất lượng cao.
            </p>
            {status && status.included && (
              <p className="mt-2 inline-flex rounded-full bg-sage-50 px-3 py-1 text-[11px] font-semibold text-sage-800">
                {status.unlimited
                  ? 'Không giới hạn (quản trị viên)'
                  : `Còn ${status.remaining}/${status.limit} lượt trong ${status.windowDays} ngày${exhausted && reset ? ` · lượt mới từ ${reset}` : ''}`}
              </p>
            )}
          </div>

          {statusError && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">{statusError}</p>}
          {status && !status.enabled && (
            <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">Tính năng thử trực tiếp tạm thời chưa mở.</p>
          )}

          {locked ? (
            <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50/70 p-5 text-center">
              <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-white text-amber-600 shadow-sm"><Crown size={22} /></span>
              <p className="font-display text-base font-bold text-ink">Dành cho gói trả phí</p>
              <p className="mt-1 text-xs leading-5 text-ink/60">Gói Plus có 3 lượt, Pro 10 lượt, Max 30 lượt mỗi 30 ngày.</p>
              <button type="button" onClick={() => { close(); onOpenPlans() }} className="mt-4 rounded-full bg-[#16171b] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-black">
                Xem các gói
              </button>
            </div>
          ) : (
            <>
              <div className={`relative mt-5 overflow-hidden rounded-3xl bg-[#16171b] ${showStage ? 'aspect-video' : 'hidden'}`}>
                <video ref={remoteVideoRef} autoPlay playsInline muted className={`absolute inset-0 size-full object-cover ${phase === 'live' ? 'opacity-100' : 'opacity-0'}`} />
                <video ref={localVideoRef} autoPlay playsInline muted className={`absolute inset-0 size-full -scale-x-100 object-cover ${phase === 'live' ? 'opacity-0' : 'opacity-40'}`} />
                {busy && (
                  <div className="absolute inset-0 grid place-items-center text-center text-white">
                    <div>
                      <LoaderCircle className="mx-auto animate-spin" size={28} />
                      <p className="mt-2 text-xs font-semibold">{phase === 'starting' ? 'Đang chuẩn bị…' : 'Đang kết nối, đồng hồ chỉ chạy khi hình đã hiện…'}</p>
                    </div>
                  </div>
                )}
                {phase === 'live' && (
                  <span className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 font-display text-sm font-bold text-white tabular-nums">{secondsLeft}s</span>
                )}
                {phase === 'ended' && (
                  <div className="absolute inset-0 grid place-items-center bg-black/70 text-center text-white">
                    <div className="px-6">
                      <Sparkles className="mx-auto" size={26} />
                      <p className="mt-2 text-sm font-bold">Hết phiên xem trước</p>
                      <p className="mt-1 text-xs text-white/70">Ưng món này? Đóng cửa sổ và bấm “Tạo ảnh” để có ảnh chất lượng cao.</p>
                    </div>
                  </div>
                )}
              </div>

              {!busy && phase !== 'live' && (
                <div className="mt-5">
                  <div className="grid grid-cols-2 rounded-2xl bg-black/[0.04] p-1 text-xs font-bold">
                    {(['wardrobe', 'upload'] as const).map((value) => (
                      <button key={value} type="button" onClick={() => setSource(value)}
                        className={`rounded-xl px-3 py-2 transition ${source === value ? 'bg-white text-ink shadow-xs' : 'text-ink/50 hover:text-ink'}`}>
                        {value === 'wardrobe' ? 'Từ tủ đồ' : 'Tải ảnh lên'}
                      </button>
                    ))}
                  </div>

                  {source === 'wardrobe' ? (
                    garments.length === 0 ? (
                      <p className="mt-4 text-center text-xs text-ink/50">Tủ đồ đang trống. Hãy thêm món đồ hoặc chọn “Tải ảnh lên”.</p>
                    ) : (
                      <div className="mt-4 grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                        {garments.map((item) => (
                          <button key={item.id} type="button" onClick={() => setGarmentId(item.id)} title={item.name}
                            className={`relative aspect-square overflow-hidden rounded-2xl border-2 bg-black/[0.03] transition ${garmentId === item.id ? 'border-sage-700' : 'border-transparent hover:border-black/15'}`}>
                            <img src={thumbnailUrl(item.frontProcessedUrl || item.frontOriginalUrl, 320)} alt={item.name} loading="lazy" className="size-full object-contain p-1" />
                            {selectedIds.includes(item.id) && <span className="absolute left-1 top-1 rounded-full bg-sage-700 px-1.5 text-[9px] font-bold text-white">Đang chọn</span>}
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                      <button type="button" onClick={() => inputRef.current?.click()}
                        className="grid aspect-square place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-black/15 bg-black/[0.02] text-ink/45 transition hover:border-black/30">
                        {uploadUrl ? <img src={uploadUrl} alt="Ảnh tham chiếu" className="size-full object-contain p-1" /> : <span className="text-center text-[11px] font-semibold"><ImagePlus className="mx-auto mb-1" size={22} />Chọn ảnh</span>}
                      </button>
                      <div>
                        <p className="text-[11px] font-bold text-ink/60">Loại món đồ</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {categories.map((category) => (
                            <button key={category} type="button" onClick={() => setUploadCategory(category)}
                              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${uploadCategory === category ? 'bg-[#16171b] text-white' : 'bg-black/[0.05] text-ink/60 hover:bg-black/10'}`}>
                              {garmentCategoryLabels[category]}
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 text-[11px] leading-5 text-ink/45">Ảnh sản phẩm chụp riêng món đồ trên nền trơn cho kết quả tốt nhất; tránh ảnh có người đang mặc. Ảnh chỉ dùng cho phiên này và không lưu vào tủ đồ.</p>
                      </div>
                      <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} className="hidden" onChange={chooseUpload} />
                    </div>
                  )}
                </div>
              )}

              {!busy && phase !== 'live' && (
                <div className="mt-5">
                  <p className="text-[11px] font-bold text-ink/60">Chế độ</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => chooseSpeed('standard')}
                      className={`rounded-2xl border-2 px-3 py-2.5 text-left transition ${speed === 'standard' ? 'border-sage-700 bg-sage-50' : 'border-black/10 hover:border-black/20'}`}>
                      <span className="block text-xs font-bold text-ink">Tiêu chuẩn</span>
                      <span className="block text-[11px] text-ink/50">1 lượt mỗi phiên</span>
                    </button>
                    <button type="button" disabled={!status?.fastModeIncluded} onClick={() => chooseSpeed('fast')}
                      title={status?.fastModeIncluded ? undefined : 'Dành cho gói Pro và Max'}
                      className={`rounded-2xl border-2 px-3 py-2.5 text-left transition disabled:cursor-not-allowed ${speed === 'fast' ? 'border-sage-700 bg-sage-50' : 'border-black/10 hover:border-black/20'} ${status?.fastModeIncluded ? '' : 'opacity-60'}`}>
                      <span className="flex items-center gap-1 text-xs font-bold text-ink"><Zap size={13} /> Nhanh</span>
                      <span className="block text-[11px] text-ink/50">
                        {status?.fastModeIncluded
                          ? `Phản hồi nhanh hơn · ${status.fastCost} lượt mỗi phiên`
                          : <span className="inline-flex items-center gap-1"><Crown size={11} /> Gói Pro trở lên</span>}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p>}

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {phase === 'live' ? (
                  <button type="button" onClick={() => stop()} className="rounded-full border border-black/10 px-5 py-2.5 text-xs font-bold text-ink transition hover:bg-black/5">Dừng</button>
                ) : (
                  <button
                    type="button"
                    disabled={!canStart || exhausted || (status !== null && !status.enabled) || (status !== null && !status.unlimited && (status.remaining ?? 0) < sessionCost)}
                    onClick={() => void start()}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#16171b] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? <LoaderCircle size={15} className="animate-spin" /> : phase === 'ended' ? <RotateCcw size={15} /> : <Camera size={15} />}
                    {phase === 'ended' ? `Xem lại (dùng ${sessionCost} lượt)` : `Bắt đầu ${status?.sessionSeconds ?? 10} giây (dùng ${sessionCost} lượt)`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  )
}
