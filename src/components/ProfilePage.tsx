import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  Images,
  Loader2,
  Maximize2,
  Shirt,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppView } from '../navigation'
import { garmentApi } from '../services/garment-api'
import { socialApi } from '../services/social-api'
import { tryOnApi } from '../services/try-on-api'
import type { AuthUser } from '../types/auth'
import type { Garment, GarmentCategory, SavedOutfit } from '../types/fitting-room'
import { garmentCategoryLabels } from '../types/fitting-room'
import { AvatarCropModal } from './AvatarCropModal'
import { ImageLightbox } from './ImageLightbox'
import { Avatar } from './social/Avatar'

type ProfilePageProps = {
  user: AuthUser
  avatarUrl: string | null
  onAvatarChange: (avatarUrl: string | null) => void
  onNavigate: (view: AppView) => void
}

type ProfileTab = 'outfits' | 'wardrobe'

const roleLabels: Record<AuthUser['role'], { label: string; className: string }> = {
  admin: { label: 'Quản trị viên', className: 'bg-red-500/10 text-red-700 border-red-200/80' },
  moderator: { label: 'Kiểm duyệt viên', className: 'bg-purple-500/10 text-purple-700 border-purple-200/80' },
  koc: { label: 'KOC', className: 'bg-amber-500/10 text-amber-700 border-amber-200/80' },
  user: { label: 'Thành viên', className: 'bg-sage-600/10 text-sage-800 border-sage-200/80' },
}

const formatJoinDate = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(value))

const formatOutfitDate = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))

export function ProfilePage({
  user,
  avatarUrl,
  onAvatarChange,
  onNavigate,
}: ProfilePageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState<ProfileTab>('outfits')
  const [username, setUsername] = useState('')
  const [friendsCount, setFriendsCount] = useState(0)
  const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[]>([])
  const [garments, setGarments] = useState<Garment[]>([])
  const [selectedCategory, setSelectedCategory] = useState<GarmentCategory | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null)
  const [outfitLimit, setOutfitLimit] = useState(24)
  const [garmentLimit, setGarmentLimit] = useState(40)

  // Trạng thái cho modal chỉnh sửa kích thước avatar
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [isCropModalOpen, setIsCropModalOpen] = useState(false)

  useEffect(() => {
    let current = true
    setLoading(true)
    Promise.all([socialApi.snapshot(), tryOnApi.listOutfits(), garmentApi.list()])
      .then(([social, outfits, wardrobe]) => {
        if (!current) return
        setUsername(social.me.username)
        setFriendsCount(social.friends.length)
        setSavedOutfits(outfits)
        setGarments(wardrobe)
      })
      .catch((cause: unknown) => {
        if (current) setMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Không thể tải hồ sơ.' })
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [user.id])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const handleSelectFile = (file: File | undefined) => {
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      setMessage({ type: 'error', text: 'Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.' })
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Ảnh đại diện phải nhỏ hơn hoặc bằng 10MB.' })
      return
    }

    // Mở modal chỉnh sửa kích thước / zoom / xoay trước khi up
    setCropFile(file)
    setIsCropModalOpen(true)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleApplyCroppedAvatar = async (croppedFile: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const localPreview = URL.createObjectURL(croppedFile)
    setPreviewUrl(localPreview)
    setUploading(true)
    setMessage(null)
    try {
      const snapshot = await socialApi.uploadAvatar(croppedFile)
      onAvatarChange(snapshot.me.avatar.startsWith('/uploads/') ? snapshot.me.avatar : null)
      setUsername(snapshot.me.username)
      setFriendsCount(snapshot.friends.length)
      setMessage({ type: 'success', text: 'Đã cập nhật ảnh đại diện mới thành công.' })
      URL.revokeObjectURL(localPreview)
      setPreviewUrl(null)
    } catch (cause) {
      setMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Không thể cập nhật ảnh đại diện.' })
      URL.revokeObjectURL(localPreview)
      setPreviewUrl(null)
      throw cause
    } finally {
      setUploading(false)
    }
  }

  const filteredGarments = useMemo(() => {
    if (selectedCategory === 'all') return garments
    return garments.filter((g) => g.category === selectedCategory)
  }, [garments, selectedCategory])
  const renderedOutfits = savedOutfits.slice(0, outfitLimit)
  const renderedGarments = filteredGarments.slice(0, garmentLimit)

  useEffect(() => setGarmentLimit(40), [selectedCategory])

  const roleInfo = user.role === 'user' ? null : (roleLabels[user.role] ?? null)

  return (
    <main className="mx-auto w-full max-w-[1180px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* ========================================================= */}
      {/* HERO BANNER & PROFILE CARD (Phong cách Facebook & Instagram) */}
      {/* ========================================================= */}
      <section className="overflow-hidden rounded-[28px] border border-black/[0.07] bg-panel/95 shadow-[0_16px_42px_rgba(23,33,29,0.055)] backdrop-blur-md">
        {/* Cover Panorama / Banner */}
        <div className="relative h-24 w-full overflow-hidden bg-gradient-to-r from-[#18231d] via-[#2b4033] to-[#1b2a21] sm:h-32">
          {/* Subtle Studio Micro-grid */}
          <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px] opacity-15" />
          <div className="pointer-events-none absolute -right-16 -top-28 size-80 rounded-full bg-emerald-400/15 blur-3xl" />
        </div>

        {/* Profile Info Header */}
        <div className="px-5 pb-5 sm:px-8 sm:pb-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            {/* Avatar & Identifiers */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              {/* Avatar với viền Story Instagram Gradient */}
              <div className="group relative -mt-12 size-24 shrink-0 rounded-full bg-panel p-1 shadow-lg sm:-mt-14 sm:size-28">
                <div className="size-full overflow-hidden rounded-full border-4 border-panel bg-sand-100">
                  <Avatar
                    name={user.displayName}
                    src={previewUrl ?? avatarUrl}
                    className="size-full text-2xl font-extrabold"
                    imageClassName="object-cover size-full"
                  />
                </div>

                {/* Input chọn ảnh ẩn */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => void handleSelectFile(event.target.files?.[0])}
                />

                {/* Nút camera đổi avatar */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="absolute bottom-0 right-0 grid size-9 place-items-center rounded-full border-[3px] border-panel bg-[#16171b] text-white shadow-lg transition hover:bg-black active:scale-95 disabled:opacity-60"
                  aria-label="Đổi ảnh đại diện"
                  title="Đổi ảnh đại diện (JPG, PNG, WebP)"
                >
                  {uploading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                </button>
              </div>

              {/* Tên, Username, Vai trò */}
              <div className="min-w-0 flex-1 pb-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                    {user.displayName}
                  </h1>
                  {roleInfo && (
                    <span className={'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold ' + roleInfo.className}>
                      {roleInfo.label}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink/50">
                  <span className="font-semibold text-sage-800 dark:text-sage-300">
                    @{username || user.displayName.toLowerCase().replace(/\s+/g, '')}
                  </span>
                  <span className="text-black/20">•</span>
                  <span className="flex items-center gap-1 text-ink/45">
                    <CalendarDays size={12} /> Tham gia {formatJoinDate(user.createdAt)}
                  </span>
                </div>

                {/* Hàng số liệu thống kê (Instagram Stat Counters) */}
                <div className="mt-4 flex items-center gap-7">
                  <button
                    type="button"
                    onClick={() => setActiveTab('outfits')}
                    className="group text-left transition hover:opacity-80"
                  >
                    <strong className="block font-display text-lg font-extrabold tracking-tight text-ink">
                      {savedOutfits.length}
                    </strong>
                    <span className="text-[11px] font-medium text-ink/45 group-hover:text-ink">outfit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('wardrobe')}
                    className="group text-left transition hover:opacity-80"
                  >
                    <strong className="block font-display text-lg font-extrabold tracking-tight text-ink">
                      {garments.length}
                    </strong>
                    <span className="text-[11px] font-medium text-ink/45 group-hover:text-ink">món đồ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate('friends')}
                    className="group text-left transition hover:opacity-80"
                  >
                    <strong className="block font-display text-lg font-extrabold tracking-tight text-ink">
                      {friendsCount}
                    </strong>
                    <span className="text-[11px] font-medium text-ink/45 group-hover:text-ink">bạn bè</span>
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* Thông báo kết quả thao tác (Alert Badge) */}
          {message && (
            <div
              className={`mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold ${
                message.type === 'success'
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {message.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              <span>{message.text}</span>
            </div>
          )}
        </div>

        {/* Thanh chuyển Tab phong cách Instagram Feed */}
        <div className="flex border-t border-black/[0.06] bg-white/50 backdrop-blur-xs">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'outfits'}
            onClick={() => setActiveTab('outfits')}
            className={`flex flex-1 items-center justify-center gap-2 border-b-2 py-3.5 text-xs font-bold transition-all sm:py-4 ${
              activeTab === 'outfits'
                ? 'border-ink text-ink bg-white/70'
                : 'border-transparent text-ink/40 hover:text-ink/75 hover:bg-black/[0.02]'
            }`}
          >
            <Images size={15} />
            <span>Outfit</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'wardrobe'}
            onClick={() => setActiveTab('wardrobe')}
            className={`flex flex-1 items-center justify-center gap-2 border-b-2 py-3.5 text-xs font-bold transition-all sm:py-4 ${
              activeTab === 'wardrobe'
                ? 'border-ink text-ink bg-white/70'
                : 'border-transparent text-ink/40 hover:text-ink/75 hover:bg-black/[0.02]'
            }`}
          >
            <Shirt size={15} />
            <span>Tủ đồ</span>
          </button>
        </div>
      </section>

      {/* ========================================================= */}
      {/* TAB CONTENT: BỘ SƯU TẬP HOẶC TỦ ĐỒ */}
      {/* ========================================================= */}
      {loading ? (
        <div className="grid min-h-72 place-items-center">
          <Loader2 className="animate-spin text-sage-700" size={28} />
          <span className="sr-only">Đang tải dữ liệu hồ sơ</span>
        </div>
      ) : activeTab === 'outfits' ? (
        <section className="mt-7">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-ink sm:text-xl">Outfit của tôi</h2>
            <button
              type="button"
              onClick={() => onNavigate('outfits')}
              className="inline-flex items-center gap-1 text-xs font-bold text-sage-800 hover:underline"
            >
              <span>Quản lý</span>
              <ArrowRight size={13} />
            </button>
          </div>

          {savedOutfits.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[28px] border border-dashed border-black/[0.1] bg-panel/60 p-8 text-center sm:p-12">
              <span className="grid size-14 place-items-center rounded-2xl bg-sage-50 text-sage-700 shadow-xs">
                <Images size={26} strokeWidth={1.7} />
              </span>
              <h3 className="mt-4 font-display text-base font-bold text-ink">Chưa có outfit nào</h3>
              <p className="mt-1.5 max-w-sm text-xs leading-5 text-ink/45">
                Chọn trang phục trong Phòng thử để tạo outfit đầu tiên của bạn.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('fitting')}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#16171b] px-5 py-2.5 text-xs font-bold text-white shadow-md transition hover:bg-black"
              >
                <Sparkles size={13} className="text-amber-300" />
                <span>Tạo outfit</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 sm:gap-4">
              {renderedOutfits.map((outfit, index) => (
                <article
                  key={outfit.id}
                  className="group relative aspect-[4/5] overflow-hidden rounded-[22px] border border-black/[0.08] bg-white shadow-2xs transition duration-300 hover:-translate-y-1 hover:shadow-md"
                >
                  <img
                    src={outfit.frontImageUrl}
                    alt={`Bộ ảnh lookbook ${index + 1}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-contain p-2.5 transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* 2-Góc Badge */}
                  {outfit.backImageUrl && (
                    <span className="absolute left-2.5 top-2.5 rounded-full border border-black/10 bg-black/60 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur-md">
                      2 góc nhìn
                    </span>
                  )}

                  {/* Hover Overlay phong cách Instagram */}
                  <div className="absolute inset-0 flex flex-col justify-between bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxImage({
                            src: outfit.frontImageUrl,
                            alt: `Bộ ảnh lookbook ${index + 1}`,
                          })
                        }
                        className="grid size-8 place-items-center rounded-xl bg-white/90 text-ink shadow-sm backdrop-blur-md transition hover:bg-white hover:scale-105"
                        title="Phóng to ảnh"
                      >
                        <Maximize2 size={13} />
                      </button>
                    </div>

                    <div className="text-white">
                      <p className="text-[10px] text-white/70">{formatOutfitDate(outfit.createdAt)}</p>
                      <p className="text-xs font-bold">Bộ đồ {index + 1}</p>
                    </div>
                  </div>
                </article>
              ))}
              {renderedOutfits.length < savedOutfits.length && (
                <button type="button" onClick={() => setOutfitLimit((current) => current + 24)} className="col-span-full mx-auto rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-bold text-ink shadow-sm">
                  Hiện thêm {Math.min(24, savedOutfits.length - renderedOutfits.length)} bộ
                </button>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="mt-7">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-lg font-bold text-ink sm:text-xl">Tủ đồ của tôi</h2>
            <button
              type="button"
              onClick={() => onNavigate('wardrobe')}
              className="inline-flex items-center gap-1 text-xs font-bold text-sage-800 hover:underline"
            >
              <span>Quản lý</span>
              <ArrowRight size={13} />
            </button>
          </div>

          {/* Category Filter Pills */}
          <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-black/[0.06] pb-3">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                selectedCategory === 'all'
                  ? 'bg-ink text-white'
                  : 'bg-black/[0.04] text-ink/60 hover:bg-black/[0.08]'
              }`}
            >
              Tất cả ({garments.length})
            </button>
            {(['tops', 'outerwear', 'bottoms', 'shoes', 'accessories'] as GarmentCategory[]).map((cat) => {
              const count = garments.filter((g) => g.category === cat).length
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    selectedCategory === cat
                      ? 'bg-ink text-white'
                      : 'bg-black/[0.04] text-ink/60 hover:bg-black/[0.08]'
                  }`}
                >
                  {garmentCategoryLabels[cat]} ({count})
                </button>
              )
            })}
          </div>

          {filteredGarments.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[28px] border border-dashed border-black/[0.1] bg-panel/60 p-8 text-center sm:p-12">
              <span className="grid size-14 place-items-center rounded-2xl bg-sage-50 text-sage-700 shadow-xs">
                <Shirt size={26} strokeWidth={1.7} />
              </span>
              <h3 className="mt-4 font-display text-base font-bold text-ink">Chưa có món đồ nào</h3>
              <p className="mt-1.5 max-w-sm text-xs leading-5 text-ink/45">
                Thêm món đồ yêu thích để phối đồ trong phòng thử ảo.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('wardrobe')}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#16171b] px-5 py-2.5 text-xs font-bold text-white shadow-md transition hover:bg-black"
              >
                <span>Mở tủ đồ để thêm</span>
                <ArrowRight size={13} />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 sm:gap-4">
              {renderedGarments.map((garment) => (
                <article
                  key={garment.id}
                  className="group relative flex flex-col justify-between overflow-hidden rounded-[22px] border border-black/[0.07] bg-white shadow-2xs transition duration-300 hover:-translate-y-1 hover:shadow-md"
                >
                  <div className="relative aspect-[4/5] overflow-hidden bg-[radial-gradient(circle_at_center,#ffffff_0%,#f1efe9_100%)]">
                    <img
                      src={garment.frontProcessedUrl || garment.frontOriginalUrl}
                      alt={garment.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-105"
                    />
                    <span className="absolute left-2.5 top-2.5 rounded-full border border-black/[0.08] bg-white/90 px-2 py-0.5 text-[9px] font-bold text-ink/75 backdrop-blur-md">
                      {garmentCategoryLabels[garment.category]}
                    </span>
                  </div>

                  <div className="p-3">
                    <p className="truncate text-xs font-bold text-ink" title={garment.name}>
                      {garment.name}
                    </p>
                  </div>
                </article>
              ))}
              {renderedGarments.length < filteredGarments.length && (
                <button type="button" onClick={() => setGarmentLimit((current) => current + 40)} className="col-span-full mx-auto rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-bold text-ink shadow-sm">
                  Hiện thêm {Math.min(40, filteredGarments.length - renderedGarments.length)} món
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Lightbox phóng to ảnh sắc nét khi click */}
      <ImageLightbox
        open={Boolean(lightboxImage)}
        src={lightboxImage?.src ?? ''}
        alt={lightboxImage?.alt ?? ''}
        onClose={() => setLightboxImage(null)}
      />

      {/* Modal Căn chỉnh kích thước & Cắt ảnh đại diện */}
      <AvatarCropModal
        open={isCropModalOpen}
        file={cropFile}
        onClose={() => {
          setIsCropModalOpen(false)
          setCropFile(null)
        }}
        onApply={handleApplyCroppedAvatar}
      />
    </main>
  )
}
