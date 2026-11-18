import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  Images,
  Loader2,
  Maximize2,
  Sparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppView } from '../../navigation'
import { socialApi } from '../../services/social-api'
import { tryOnApi } from '../../services/try-on-api'
import type { AuthUser } from '../../types/auth'
import type { SavedOutfit } from '../../types/fitting-room'
import { AvatarCropModal } from './AvatarCropModal'
import { ImageLightbox } from '../../shared/components/ImageLightbox'
import { Avatar } from '../../shared/components/Avatar'
import { thumbnailProps } from '../../services/image-url'

type ProfilePageProps = {
  user: AuthUser
  avatarUrl: string | null
  onAvatarChange: (avatarUrl: string | null) => void
  onNavigate: (view: AppView) => void
}

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
  const [username, setUsername] = useState('')
  const [friendsCount, setFriendsCount] = useState(0)
  const [followersCount, setFollowersCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [isCreator, setIsCreator] = useState(false)
  const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null)
  const [outfitLimit, setOutfitLimit] = useState(24)

  // Trạng thái cho modal chỉnh sửa kích thước avatar
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [isCropModalOpen, setIsCropModalOpen] = useState(false)

  useEffect(() => {
    let current = true
    setLoading(true)
    Promise.allSettled([socialApi.snapshot(), tryOnApi.listOutfits()])
      .then(([socialRes, outfitsRes]) => {
        if (!current) return
        if (socialRes.status === 'fulfilled') {
          setUsername(socialRes.value.me.username)
          setFriendsCount(socialRes.value.friends.length)
          setFollowersCount(socialRes.value.followerCount ?? 0)
          setFollowingCount(socialRes.value.following?.length ?? 0)
          setIsCreator(Boolean(socialRes.value.me.creator))
        }
        if (outfitsRes.status === 'fulfilled') {
          setSavedOutfits(outfitsRes.value)
        }
        if (outfitsRes.status === 'rejected') {
          setMessage({ type: 'error', text: 'Không thể tải danh sách outfit.' })
        }
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

  const renderedOutfits = savedOutfits.slice(0, outfitLimit)

  const roleInfo = user.role === 'user' ? null : (roleLabels[user.role] ?? null)
  // Chỉ KOL/KOC (và admin) mới có người theo dõi; moderator là tài khoản thường về mặt mạng xã hội.
  const isSpecialRole = user.role === 'admin' || user.role === 'koc' || isCreator

  return (
    <main className="mx-auto w-full max-w-[1180px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* ========================================================= */}
      {/* HERO BANNER & PROFILE CARD (Phong cách Atelier Studio) */}
      {/* ========================================================= */}
      <section className="overflow-hidden rounded-[28px] border border-black/[0.07] bg-panel/95 shadow-[0_16px_42px_rgba(23,33,29,0.055)] backdrop-blur-md">
        {/* Cover Panorama / Banner */}
        <div className="relative h-28 w-full overflow-hidden bg-gradient-to-r from-[#17221c] via-[#24352a] to-[#1a261e] sm:h-36">
          {/* Subtle Studio Micro-grid */}
          <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px] opacity-15" />
          <div className="pointer-events-none absolute -right-12 -top-16 size-80 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 -bottom-16 size-64 rounded-full bg-amber-400/10 blur-3xl" />
        </div>

        {/* Profile Info Header */}
        <div className="px-5 pb-5 sm:px-8 sm:pb-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            {/* Cột trái: Avatar & Danh tính */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              {/* Avatar với viền kép tinh xảo */}
              <div className="group relative -mt-14 size-24 shrink-0 rounded-full bg-panel p-1.5 shadow-xl sm:-mt-16 sm:size-32">
                <div className="size-full overflow-hidden rounded-full border-4 border-panel bg-sand-100 shadow-inner">
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
                  className="absolute bottom-1 right-1 grid size-9 place-items-center rounded-full border-[3px] border-panel bg-ink text-white shadow-md transition hover:scale-105 hover:bg-black active:scale-95 disabled:opacity-60"
                  aria-label="Đổi ảnh đại diện"
                  title="Đổi ảnh đại diện (JPG, PNG, WebP)"
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
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

                {/* Hàng số liệu thống kê (Chữ thuần không icon, không khung) */}
                <div className="mt-3.5 flex items-center gap-5">
                  {isSpecialRole ? (
                    <>
                      <div className="inline-flex items-baseline gap-1.5 text-ink">
                        <strong className="font-display text-base font-extrabold text-ink sm:text-lg">
                          {followersCount}
                        </strong>
                        <span className="text-xs font-medium text-ink/50">
                          người theo dõi
                        </span>
                      </div>

                      <div className="inline-flex items-baseline gap-1.5 text-ink">
                        <strong className="font-display text-base font-extrabold text-ink sm:text-lg">
                          {followingCount}
                        </strong>
                        <span className="text-xs font-medium text-ink/50">
                          đang theo dõi
                        </span>
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigate('friends')}
                      className="group inline-flex items-baseline gap-1.5 text-ink transition hover:opacity-80"
                    >
                      <strong className="font-display text-base font-extrabold text-ink sm:text-lg">
                        {friendsCount}
                      </strong>
                      <span className="text-xs font-medium text-ink/50 group-hover:text-ink">
                        bạn bè
                      </span>
                    </button>
                  )}
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
      </section>

      {/* ========================================================= */}
      {/* BỘ SƯU TẬP OUTFIT */}
      {/* ========================================================= */}
      {loading ? (
        <div className="grid min-h-72 place-items-center">
          <Loader2 className="animate-spin text-sage-700" size={28} />
          <span className="sr-only">Đang tải dữ liệu hồ sơ</span>
        </div>
      ) : (
        <section className="mt-7">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-ink sm:text-xl">Outfit đã lưu</h2>
              <p className="text-xs text-ink/45">Các bộ trang phục đã phối và lưu từ phòng thử</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('outfits')}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-panel px-3.5 py-1.5 text-xs font-bold text-ink transition hover:border-black/20 hover:shadow-xs active:scale-95"
            >
              <span>Xem chi tiết</span>
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
                    {...thumbnailProps(outfit.frontImageUrl)}
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
