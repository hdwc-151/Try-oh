import { ArrowLeft, ArrowRight, Camera, Check, LockKeyhole, Shirt, Sparkles, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { SocialSnapshot } from '../../server/social/types'
import { socialApi } from '../services/social-api'
import type { AuthUser } from '../types/auth'
import { BrandMark } from './brand/BrandMark'
import { storageKeys, writeStoredValue } from '../services/local-storage-keys'

type OnboardingFlowProps = {
  user: AuthUser
  hasGarments: boolean
  onComplete: (destination: 'upload' | 'fitting') => void
}

const usernameFrom = (value: string, id: string) => {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return (normalized.length >= 3 ? normalized : `user_${id.replace(/-/g, '').slice(0, 12)}`).slice(0, 40)
}

export function OnboardingFlow({ user, hasGarments, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0)
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [username, setUsername] = useState(() => usernameFrom(user.displayName, user.id))
  const [birthDate, setBirthDate] = useState('')
  const [defaultVisibility, setDefaultVisibility] = useState<'private' | 'friends'>('private')
  const [invitePolicy, setInvitePolicy] = useState<'known' | 'code'>('known')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await socialApi.snapshot()
      setSnapshot(data)
      setUsername(data.me.username.startsWith('user_') ? usernameFrom(user.displayName, user.id) : data.me.username)
      setBirthDate(data.me.birthDate ?? '')
      setDefaultVisibility(data.me.defaultVisibility)
      setInvitePolicy(data.me.invitePolicy === 'code' ? 'code' : 'known')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải hồ sơ.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const progress = useMemo(() => Math.round(((step + 1) / 5) * 100), [step])
  const saveAndFinish = async (destination: 'upload' | 'fitting') => {
    if (!snapshot) return
    setSaving(true)
    setError('')
    try {
      await socialApi.act('settings', {
        username,
        birthDate: snapshot.me.birthDate ? undefined : birthDate,
        invitePolicy,
        defaultVisibility,
      })
      writeStoredValue(storageKeys.onboarding(user.id), 'complete')
      onComplete(destination)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể lưu thiết lập.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="fixed inset-0 z-[100] grid place-items-center bg-canvas"><Sparkles className="animate-pulse text-sage-600" /><span className="sr-only">Đang chuẩn bị hồ sơ</span></div>
  }
  if (!snapshot) {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-canvas p-5">
        <div className="max-w-sm rounded-[28px] bg-panel p-6 text-center shadow-soft">
          <p className="font-bold text-ink">Chưa thể chuẩn bị hồ sơ</p>
          <p className="mt-2 text-sm text-red-600">{error}</p>
          <button onClick={() => void load()} className="mt-5 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white">Thử lại</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-canvas/95 p-0 backdrop-blur-xl sm:p-6">
      <div className="mx-auto flex min-h-full max-w-3xl items-center">
        <section className="min-h-[100dvh] w-full overflow-hidden border border-black/[0.07] bg-panel shadow-[0_30px_90px_rgba(23,33,29,0.18)] sm:min-h-0 sm:rounded-[32px]">
          <div className="h-1.5 bg-black/[0.05]"><div className="h-full bg-sage-600 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
          <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-10">
            <div className="mb-7 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-sage-700">Thiết lập {step + 1}/5</span>
              <span className="text-xs font-semibold text-ink/35">Fitsy</span>
            </div>

            {step === 0 && (
              <div className="py-6 text-center">
                <BrandMark className="mx-auto size-16" label="Fitsy" />
                <h1 className="mt-6 font-display text-3xl font-bold text-ink sm:text-4xl">Tủ đồ của bạn, theo cách riêng.</h1>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-ink/55">Lưu trang phục, thử phối đồ và chỉ chia sẻ với những người bạn chọn. Không có lượt thích hay bảng xếp hạng.</p>
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 className="font-display text-2xl font-bold text-ink">Hồ sơ thân thiện</h2>
                <p className="mt-2 text-sm text-ink/50">Username giúp bạn bè tìm đúng bạn. Ngày sinh chỉ dùng để áp dụng cài đặt an toàn.</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-[160px_1fr]">
                  <div>
                    <p className="mb-2 text-xs font-bold text-ink/55">Ảnh đại diện</p>
                    <div className="grid size-24 place-items-center rounded-[28px] bg-gradient-to-br from-sage-100 to-sage-200 font-display text-2xl font-bold text-sage-900 shadow-inner">
                      {user.displayName.trim().slice(0, 2).toUpperCase()}
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-ink/40">Bạn có thể tải ảnh thật tại trang cá nhân sau khi hoàn tất.</p>
                  </div>
                  <div className="space-y-4">
                    <label className="block text-xs font-bold text-ink/55">Username<input value={username} onChange={event => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40))} pattern="[a-z0-9_]{3,40}" required className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:ring-2 focus:ring-sage-400" /></label>
                    <label className="block text-xs font-bold text-ink/55">Ngày sinh<input type="date" value={birthDate} disabled={Boolean(snapshot.me.birthDate)} max={new Date().toISOString().slice(0, 10)} onChange={event => setBirthDate(event.target.value)} className="mt-1.5 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-ink outline-none focus:ring-2 focus:ring-sage-400 disabled:opacity-60" /></label>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <LockKeyhole size={28} className="text-sage-700" />
                <h2 className="mt-4 font-display text-2xl font-bold text-ink">Bạn quyết định ai được xem</h2>
                <p className="mt-2 text-sm leading-6 text-ink/50">Mỗi outfit vẫn có thể đổi quyền riêng. Đây chỉ là lựa chọn mặc định an toàn.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {([
                    ['private', 'Chỉ mình tôi', 'An toàn nhất. Bạn chủ động chia sẻ từng outfit.', LockKeyhole],
                    ['friends', 'Bạn bè', 'Bạn bè đã chấp nhận có thể xem outfit mới.', Users],
                  ] as const).map(([value, title, description, Icon]) => (
                    <button key={value} onClick={() => setDefaultVisibility(value)} className={`rounded-3xl border p-5 text-left transition ${defaultVisibility === value ? 'border-sage-500 bg-sage-50 ring-2 ring-sage-300/50' : 'border-black/[0.08] bg-white'}`}>
                      <Icon size={20} className="text-sage-700" /><span className="mt-4 block font-bold text-ink">{title}</span><span className="mt-1 block text-xs leading-5 text-ink/45">{description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="font-display text-2xl font-bold text-ink">Quyền truy cập, giải thích rõ ràng</h2>
                <div className="mt-6 space-y-3">
                  <div className="flex gap-4 rounded-3xl bg-sage-50 p-5"><Camera className="shrink-0 text-sage-700" /><div><p className="font-bold text-ink">Camera & thư viện ảnh</p><p className="mt-1 text-xs leading-5 text-ink/50">Chỉ mở khi bạn chọn chụp hoặc tải ảnh. Ứng dụng không tự đọc thư viện.</p></div></div>
                  <div className="flex gap-4 rounded-3xl bg-sage-50 p-5"><Users className="shrink-0 text-sage-700" /><div><p className="font-bold text-ink">Bạn bè & thông báo</p><p className="mt-1 text-xs leading-5 text-ink/50">Chỉ dùng trong vòng kết nối bạn đã chấp nhận. Bạn có thể tắt bất cứ lúc nào.</p></div></div>
                </div>
                <label className="mt-5 flex items-center gap-3 text-sm text-ink/65"><input type="checkbox" checked={invitePolicy === 'code'} onChange={event => setInvitePolicy(event.target.checked ? 'code' : 'known')} className="size-4 accent-sage-700" /> Chỉ nhận lời mời từ người có mã mời</label>
              </div>
            )}

            {step === 4 && (
              <div className="py-4 text-center">
                <span className="mx-auto grid size-16 place-items-center rounded-full bg-sage-100 text-sage-800"><Check size={28} /></span>
                <h2 className="mt-5 font-display text-2xl font-bold text-ink">Sẵn sàng rồi!</h2>
                <p className="mt-2 text-sm text-ink/50">{hasGarments ? 'Tủ đồ của bạn đã có dữ liệu. Hãy bắt đầu phối đồ.' : 'Thêm món đầu tiên để bắt đầu xây tủ đồ kỹ thuật số.'}</p>
                <button disabled={saving} onClick={() => void saveAndFinish(hasGarments ? 'fitting' : 'upload')} className="mt-7 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-50"><Shirt size={17} /> {saving ? 'Đang lưu…' : hasGarments ? 'Vào phòng thử' : 'Thêm món đầu tiên'}</button>
              </div>
            )}

            {error && <p role="alert" className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            {step < 4 && (
              <div className="mt-8 flex items-center justify-between">
                <button disabled={step === 0} onClick={() => setStep(current => current - 1)} className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-bold text-ink/55 disabled:invisible"><ArrowLeft size={16} /> Quay lại</button>
                <button disabled={step === 1 && (username.length < 3 || (!birthDate && !snapshot.me.birthDate))} onClick={() => setStep(current => current + 1)} className="inline-flex items-center gap-1 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">Tiếp tục <ArrowRight size={16} /></button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
