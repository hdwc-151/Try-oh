import {
  ArrowLeft,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { authApi, type SocialProvider, type SocialProviders } from '../../services/auth-api'
import type { AuthUser } from '../../types/auth'
import { BrandLogo } from '../../shared/components/BrandMark'

type AuthMode = 'login' | 'register' | 'forgot' | 'reset'

type RecoveryCredentials = {
  accessToken: string
  refreshToken: string
}

type RecoveryState = {
  requested: boolean
  credentials: RecoveryCredentials | null
  error: string | null
}

type AuthPageProps = {
  onAuthenticated: (user: AuthUser, portal?: 'user' | 'creator') => void
}

const readRecoveryState = (): RecoveryState => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const requested = window.location.pathname === '/reset-password' || params.get('type') === 'recovery'
  if (!requested) return { requested: false, credentials: null, error: null }

  const accessToken = params.get('access_token') ?? ''
  const refreshToken = params.get('refresh_token') ?? ''
  const providerError = params.get('error_description')
  window.history.replaceState(null, '', '/reset-password')

  return {
    requested: true,
    credentials: accessToken && refreshToken ? { accessToken, refreshToken } : null,
    error: providerError
      ? providerError.replace(/\+/g, ' ')
      : (!accessToken || !refreshToken ? 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.' : null),
  }
}

const providerLabels: Record<SocialProvider, string> = { google: 'Google' }

const oauthErrorMessages: Record<string, string> = {
  google_cancelled: 'Bạn đã huỷ đăng nhập bằng Google.',
  google_expired: 'Phiên đăng nhập Google đã hết hạn. Vui lòng thử lại.',
  google_unavailable: 'Đăng nhập bằng Google hiện chưa được bật.',
  google_failed: 'Không thể đăng nhập bằng Google. Vui lòng thử lại.',
}

/** Lỗi máy chủ gửi kèm khi quay về từ Google (`/?auth_error=…`); đọc một lần rồi xoá khỏi URL. */
const readOAuthError = (): string | null => {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('auth_error')
  if (!code) return null
  params.delete('auth_error')
  const query = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash)
  return oauthErrorMessages[code] ?? oauthErrorMessages.google_failed
}

const contentByMode: Record<AuthMode, { eyebrow: string; title?: string; description?: string }> = {
  login: {
    eyebrow: 'Chào mừng trở lại',
  },
  register: {
    eyebrow: 'Tạo tài khoản mới',
  },
  forgot: {
    eyebrow: 'Khôi phục tài khoản',
    title: 'Quên mật khẩu?',
    description: 'Nhập email đăng ký, chúng tôi sẽ gửi cho bạn liên kết đặt lại mật khẩu.',
  },
  reset: {
    eyebrow: 'Bảo mật tài khoản',
    title: 'Đặt mật khẩu mới',
    description: 'Chọn mật khẩu mới có ít nhất 8 ký tự.',
  },
}

export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [recovery] = useState(readRecoveryState)
  const [mode, setMode] = useState<AuthMode>(recovery.requested ? 'reset' : 'login')
  const [portal, setPortal] = useState<'user'|'creator'>('user')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const [error, setError] = useState<string | null>(() => recovery.error ?? readOAuthError())
  const [socialProviders, setSocialProviders] = useState<SocialProviders>({ google: false })
  const [redirectingTo, setRedirectingTo] = useState<SocialProvider | null>(null)

  useEffect(() => {
    let active = true
    void authApi.providers().then((providers) => { if (active) setSocialProviders(providers) })
    // Bấm Back từ trang Google: trình duyệt khôi phục trang cũ, nút không được kẹt ở trạng thái đang chuyển.
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) setRedirectingTo(null) }
    window.addEventListener('pageshow', onPageShow)
    return () => { active = false; window.removeEventListener('pageshow', onPageShow) }
  }, [])

  const continueWith = (provider: SocialProvider) => {
    setError(null)
    setRedirectingTo(provider)
    authApi.startSocialSignIn(provider, portal === 'creator' ? '/koc' : '/')
  }
  const [success, setSuccess] = useState<string | null>(null)

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setError(null)
    setSuccess(null)
    setAwaitingConfirmation(false)
    setPassword('')
    setConfirmPassword('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if ((mode === 'register' || mode === 'reset') && password !== confirmPassword) {
      setError('Mật khẩu nhập lại chưa khớp.')
      return
    }
    if (mode === 'reset' && !recovery.credentials) {
      setError('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      if (mode === 'forgot') {
        setSuccess(await authApi.requestPasswordReset(email))
        return
      }
      if (mode === 'reset' && recovery.credentials) {
        const user = await authApi.resetPassword({ ...recovery.credentials, password })
        onAuthenticated(user, 'user')
        return
      }
      const user = mode === 'login'
        ? await authApi.login({ email, password })
        : await authApi.register({ displayName, email, password })
      if (mode === 'login' && portal === 'creator' && user.role !== 'koc' && user.role !== 'admin') {
        await authApi.logout()
        throw new Error('Tài khoản này chưa được cấp quyền KOL/KOC. Bạn có thể đăng nhập ở chế độ Người dùng.')
      }
      onAuthenticated(user, mode === 'login' ? portal : 'user')
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Không thể xác thực tài khoản.'
      const needsConfirmation = /xác minh email|email chưa được xác minh/i.test(message)
      if (needsConfirmation) {
        setAwaitingConfirmation(true)
        setSuccess(message)
      } else {
        setError(message)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const resendConfirmation = async () => {
    if (!email.trim()) return
    setIsResendingConfirmation(true)
    setError(null)
    setSuccess(null)
    try {
      setSuccess(await authApi.resendSignupConfirmation(email))
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Chưa thể gửi lại email xác minh.')
    } finally {
      setIsResendingConfirmation(false)
    }
  }

  const content = contentByMode[mode]
  const submitLabel = mode === 'login'
    ? 'Đăng nhập'
    : mode === 'register'
      ? 'Tạo tài khoản'
      : mode === 'forgot'
        ? 'Gửi liên kết đặt lại'
        : 'Lưu mật khẩu mới'

  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-x-hidden bg-canvas p-3 sm:p-6">
      <div className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-sage-100/80 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 -right-20 size-[32rem] rounded-full bg-violet-100/65 blur-3xl" />

      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[26px] border border-white/75 bg-panel shadow-[0_30px_90px_rgba(23,33,29,0.14)] sm:rounded-[34px] lg:grid-cols-[1.05fr_0.95fr]">
        <div className="relative hidden min-h-[650px] overflow-hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(169,190,163,0.32),transparent_36%),radial-gradient(circle_at_85%_80%,rgba(139,92,246,0.2),transparent_40%)]" />
          <div className="relative">
            <BrandLogo inverse markClassName="size-12" wordmarkClassName="text-2xl" />
            <p className="mt-7 text-[11px] font-bold uppercase tracking-[0.22em] text-sage-300">Fitting Room</p>
            <h1 className="mt-3 max-w-md font-display text-4xl font-bold leading-[1.15]">Thử phong cách mới trên chính ảnh của bạn</h1>
          </div>
          <div className="relative flex items-center gap-3 text-xs text-white/55">
            <ShieldCheck size={18} className="text-sage-300" />
            Phiên đăng nhập và ảnh của bạn được bảo vệ
          </div>
        </div>

        <div className="p-5 sm:p-9 lg:p-10">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandLogo markClassName="size-11" wordmarkClassName="text-lg" />
            <p className="sr-only">Không gian thử đồ của bạn</p>
          </div>

          {mode === 'login' && <div className="mb-3 grid grid-cols-2 rounded-2xl border border-black/[0.07] bg-white p-1" aria-label="Loại tài khoản">
            <button type="button" onClick={()=>setPortal('user')} className={`rounded-xl px-3 py-2.5 text-xs font-bold ${portal==='user'?'bg-ink text-white shadow-sm':'text-ink/45'}`}>Người dùng</button>
            <button type="button" onClick={()=>setPortal('creator')} className={`rounded-xl px-3 py-2.5 text-xs font-bold ${portal==='creator'?'bg-ink text-white shadow-sm':'text-ink/45'}`}>KOL/KOC</button>
          </div>}

          {(mode === 'login' || mode === 'register') ? (
            <div className="rounded-2xl bg-black/[0.04] p-1" role="tablist" aria-label="Đăng nhập hoặc đăng ký">
              <div className="grid grid-cols-2">
                <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => changeMode('login')} className={'rounded-xl px-4 py-2.5 text-sm transition ' + (mode === 'login' ? 'bg-white font-bold text-ink shadow-sm' : 'font-medium text-ink/40 hover:text-ink')}>Đăng nhập</button>
                <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => changeMode('register')} className={'rounded-xl px-4 py-2.5 text-sm transition ' + (mode === 'register' ? 'bg-white font-bold text-ink shadow-sm' : 'font-medium text-ink/40 hover:text-ink')}>Đăng ký</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => changeMode('login')} className="flex items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold text-ink/50 transition hover:bg-black/5 hover:text-ink">
              <ArrowLeft size={15} /> Quay lại đăng nhập
            </button>
          )}

          <div className="mt-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sage-700">{content.eyebrow}</p>
            {content.title && <h2 className="mt-2 font-display text-2xl font-bold leading-tight text-ink">{content.title}</h2>}
            {content.description && <p className="mt-2 text-sm leading-6 text-ink/45">{content.description}</p>}
          </div>

          <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-4">
            {mode === 'register' && (
              <label className="block"><span className="mb-2 block text-xs font-bold text-ink/65">Tên hiển thị</span><span className="relative block"><UserRound size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" /><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required minLength={2} maxLength={50} placeholder="Tên của bạn" className="w-full rounded-2xl border border-black/10 bg-white py-3.5 pl-11 pr-4 text-sm outline-none transition placeholder:text-ink/25 focus:border-sage-500 focus:ring-4 focus:ring-sage-100" /></span></label>
            )}

            {mode !== 'reset' && (
              <label className="block"><span className="mb-2 block text-xs font-bold text-ink/65">Email</span><span className="relative block"><Mail size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={254} placeholder="ban@example.com" className="w-full rounded-2xl border border-black/10 bg-white py-3.5 pl-11 pr-4 text-sm outline-none transition placeholder:text-ink/25 focus:border-sage-500 focus:ring-4 focus:ring-sage-100" /></span></label>
            )}

            {mode !== 'forgot' && (
              <label className="block">
                <span className="mb-2 flex items-center justify-between text-xs font-bold text-ink/65">
                  <span>{mode === 'reset' ? 'Mật khẩu mới' : 'Mật khẩu'}</span>
                  {mode === 'login' && <button type="button" onClick={() => changeMode('forgot')} className="font-semibold text-sage-700 transition hover:text-sage-900 hover:underline">Quên mật khẩu?</button>}
                </span>
                <span className="relative block"><LockKeyhole size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} placeholder="Tối thiểu 8 ký tự" className="w-full rounded-2xl border border-black/10 bg-white py-3.5 pl-11 pr-12 text-sm outline-none transition placeholder:text-ink/25 focus:border-sage-500 focus:ring-4 focus:ring-sage-100" /><button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-xl text-ink/30 hover:bg-black/5 hover:text-ink" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
              </label>
            )}

            {(mode === 'register' || mode === 'reset') && (
              <label className="block"><span className="mb-2 block text-xs font-bold text-ink/65">Nhập lại mật khẩu</span><span className="relative block"><LockKeyhole size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" /><input type={showPassword ? 'text' : 'password'} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128} placeholder="Nhập lại mật khẩu" className="w-full rounded-2xl border border-black/10 bg-white py-3.5 pl-11 pr-4 text-sm outline-none transition placeholder:text-ink/25 focus:border-sage-500 focus:ring-4 focus:ring-sage-100" /></span></label>
            )}

            {success && <div className="flex gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800" role="status"><ShieldCheck size={17} className="mt-0.5 shrink-0" />{success}</div>}
            {error && <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700" role="alert">{error}</div>}

            <button type="submit" disabled={isSubmitting || (mode === 'reset' && !recovery.credentials)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink px-5 py-3.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(23,33,29,0.18)] transition hover:-translate-y-0.5 hover:bg-sage-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0">
              {isSubmitting && <LoaderCircle size={17} className="animate-spin" />}
              {isSubmitting ? 'Đang xử lý…' : submitLabel}
            </button>

            {awaitingConfirmation && (mode === 'login' || mode === 'register') && (
              <button type="button" onClick={() => void resendConfirmation()} disabled={isResendingConfirmation} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-sage-200 bg-sage-50 px-5 py-3 text-xs font-bold text-sage-800 transition hover:border-sage-300 hover:bg-sage-100 disabled:cursor-wait disabled:opacity-55">
                {isResendingConfirmation && <LoaderCircle size={15} className="animate-spin" />}
                {isResendingConfirmation ? 'Đang gửi lại…' : 'Gửi lại email xác minh'}
              </button>
            )}

            {socialProviders.google && (mode === 'login' || mode === 'register') && <>
              <div className="flex items-center gap-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/30" aria-hidden="true">
                <span className="h-px flex-1 bg-black/[0.08]" />hoặc<span className="h-px flex-1 bg-black/[0.08]" />
              </div>
              {(['google'] as const).filter(provider => socialProviders[provider]).map(provider => (
                <button key={provider} type="button" onClick={() => continueWith(provider)} disabled={redirectingTo !== null || isSubmitting} className={`flex w-full items-center justify-center gap-2 rounded-2xl border px-5 py-3.5 text-sm font-bold transition disabled:cursor-wait disabled:opacity-60 border-black/10 bg-white text-ink hover:border-black/20 hover:bg-black/[0.02]`}>
                  {redirectingTo === provider && <LoaderCircle size={17} className="animate-spin" />}
                  {redirectingTo === provider ? `Đang chuyển tới ${providerLabels[provider]}…` : `Tiếp tục với ${providerLabels[provider]}`}
                </button>
              ))}
            </>}

            {mode === 'reset' && !recovery.credentials && (
              <button type="button" onClick={() => changeMode('forgot')} className="w-full text-center text-xs font-bold text-sage-700 hover:underline">Yêu cầu liên kết mới</button>
            )}
          </form>
        </div>
      </section>
    </main>
  )
}
