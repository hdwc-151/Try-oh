import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Moon,
  Palette,
  RotateCcw,
  Settings,
  Shield,
  Sun,
  Trash2,
  UserRound,
  UserX,
} from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { SocialSnapshot } from '../../server/social/types'
import type { AppView } from '../navigation'
import { authApi } from '../services/auth-api'
import { socialApi } from '../services/social-api'
import type { AuthUser } from '../types/auth'
import { Avatar } from './social/Avatar'
import { ConfirmDialog } from './ConfirmDialog'

type SettingsPageProps = {
  user: AuthUser
  isLoggingOut: boolean
  onNavigate: (view: AppView) => void
  onLogout: () => void
  darkMode: boolean
  onDarkModeChange: (enabled: boolean) => void
  onReplayOnboarding: () => void
  onUserUpdate: (user: AuthUser) => void
}

type SettingsSection = 'account' | 'privacy' | 'appearance'
type Message = { type: 'success' | 'error'; text: string } | null

const fieldClass = 'mt-1.5 w-full rounded-2xl border border-black/[0.09] bg-white px-4 py-3 text-sm font-medium text-ink outline-none transition focus:border-sage-500 focus:ring-2 focus:ring-sage-400/20 dark:bg-black/15'
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-[#16171b] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40'

const readSection = (): SettingsSection => {
  const value = new URLSearchParams(window.location.search).get('section')
  return value === 'privacy' || value === 'appearance' ? value : 'account'
}

function Feedback({ message }: { message: Message }) {
  if (!message) return null
  return (
    <p className={`mt-3 flex items-center gap-1.5 text-xs font-semibold ${message.type === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
      {message.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
      {message.text}
    </p>
  )
}

export function SettingsPage({
  user,
  isLoggingOut,
  onNavigate,
  onLogout,
  darkMode,
  onDarkModeChange,
  onReplayOnboarding,
  onUserUpdate,
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>(readSection)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [savingName, setSavingName] = useState(false)
  const [nameMessage, setNameMessage] = useState<Message>(null)
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailMessage, setEmailMessage] = useState<Message>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<Message>(null)
  const [social, setSocial] = useState<SocialSnapshot | null>(null)
  const [socialLoading, setSocialLoading] = useState(true)
  const [socialBusy, setSocialBusy] = useState(false)
  const [socialMessage, setSocialMessage] = useState<Message>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState<Message>(null)

  const loadSocialSettings = useCallback(async () => {
    setSocialLoading(true)
    try {
      setSocial(await socialApi.snapshot())
    } catch (cause) {
      setSocialMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Không thể tải cài đặt.' })
    } finally {
      setSocialLoading(false)
    }
  }, [])

  useEffect(() => { void loadSocialSettings() }, [loadSocialSettings])

  const selectSection = (next: SettingsSection) => {
    setSection(next)
    const url = new URL(window.location.href)
    url.searchParams.set('section', next)
    window.history.replaceState(null, '', url.pathname + url.search)
  }

  const socialAct = async (action: string, body: Record<string, unknown>) => {
    if (socialBusy) return false
    setSocialBusy(true)
    setSocialMessage(null)
    try {
      setSocial(await socialApi.act(action, body))
      return true
    } catch (cause) {
      setSocialMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Không thể lưu cài đặt.' })
      return false
    } finally {
      setSocialBusy(false)
    }
  }

  const saveName = async (event: FormEvent) => {
    event.preventDefault()
    const value = displayName.trim()
    if (value.length < 2) {
      setNameMessage({ type: 'error', text: 'Tên hiển thị cần ít nhất 2 ký tự.' })
      return
    }
    setSavingName(true)
    setNameMessage(null)
    try {
      const updated = await authApi.updateProfile({ displayName: value })
      onUserUpdate(updated)
      setDisplayName(updated.displayName)
      setNameMessage({ type: 'success', text: 'Đã cập nhật tên hiển thị.' })
    } catch (cause) {
      setNameMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Không thể cập nhật tên.' })
    } finally {
      setSavingName(false)
    }
  }

  const saveSocialProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!social) return
    const values = new FormData(event.currentTarget)
    const saved = await socialAct('settings', {
      username: values.get('username'),
      birthDate: social.me.birthDate ?? values.get('birthDate'),
      invitePolicy: social.me.invitePolicy,
      defaultVisibility: social.me.defaultVisibility,
    })
    if (saved) setSocialMessage({ type: 'success', text: 'Đã lưu thông tin cá nhân.' })
  }

  const saveEmail = async (event: FormEvent) => {
    event.preventDefault()
    setSavingEmail(true)
    setEmailMessage(null)
    try {
      const updated = await authApi.changeEmail({ newEmail: newEmail.trim(), password: emailPassword })
      onUserUpdate(updated)
      setNewEmail('')
      setEmailPassword('')
      setEmailMessage({ type: 'success', text: 'Đã cập nhật địa chỉ email.' })
    } catch (cause) {
      setEmailMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Không thể đổi email.' })
    } finally {
      setSavingEmail(false)
    }
  }

  const savePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'Mật khẩu mới cần ít nhất 8 ký tự.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Hai mật khẩu mới chưa trùng nhau.' })
      return
    }
    setSavingPassword(true)
    setPasswordMessage(null)
    try {
      const text = await authApi.changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage({ type: 'success', text })
    } catch (cause) {
      setPasswordMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Không thể đổi mật khẩu.' })
    } finally {
      setSavingPassword(false)
    }
  }

  const savePrivacy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!social) return
    const values = new FormData(event.currentTarget)
    const saved = await socialAct('settings', {
      username: social.me.username,
      birthDate: social.me.birthDate,
      invitePolicy: values.get('invitePolicy'),
      defaultVisibility: values.get('defaultVisibility'),
    })
    if (saved) setSocialMessage({ type: 'success', text: 'Đã lưu quyền riêng tư.' })
  }

  const deleteAccount = async () => {
    setDeletingAccount(true)
    setDeleteMessage(null)
    try {
      await authApi.deleteAccount()
      window.location.assign('/')
    } catch (cause) {
      setDeleteMessage({ type: 'error', text: cause instanceof Error ? cause.message : 'Không thể xóa tài khoản.' })
      setDeleteDialogOpen(false)
      setDeletingAccount(false)
    }
  }

  const sections: Array<{ id: SettingsSection; label: string; icon: typeof Settings }> = [
    { id: 'account', label: 'Tài khoản', icon: UserRound },
    { id: 'privacy', label: 'Quyền riêng tư', icon: Shield },
    { id: 'appearance', label: 'Giao diện', icon: Palette },
  ]

  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex items-center gap-4">
        <button type="button" onClick={() => onNavigate('profile')} className="grid size-10 shrink-0 place-items-center rounded-full border border-black/[0.08] bg-white text-ink/60 shadow-xs transition hover:bg-sage-50" aria-label="Quay lại hồ sơ"><ArrowLeft size={17} /></button>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Cài đặt</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="scrollbar-none flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-24 lg:flex-col lg:self-start lg:pb-0" aria-label="Danh mục cài đặt">
          {sections.map(item => {
            const Icon = item.icon
            const active = section === item.id
            return (
              <button key={item.id} type="button" onClick={() => selectSection(item.id)} aria-current={active ? 'page' : undefined} className={`flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-bold transition ${active ? 'bg-[#16171b] text-white shadow-md' : 'border border-black/[0.06] bg-white/70 text-ink/55 hover:bg-white hover:text-ink'}`}>
                <Icon size={17} /> {item.label}
              </button>
            )
          })}
        </nav>

        <div className="min-w-0">
          {section === 'account' && (
            <section className="grid gap-5 lg:grid-cols-2">
              <SettingsCard icon={UserRound} title="Thông tin cá nhân">
                <form onSubmit={(event) => void saveName(event)}>
                  <label className="text-xs font-bold text-ink/55">Tên hiển thị
                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value.slice(0, 50))} minLength={2} maxLength={50} required className={fieldClass} />
                  </label>
                  <Feedback message={nameMessage} />
                  <button type="submit" disabled={savingName || displayName.trim() === user.displayName} className={`${buttonClass} mt-4`}>{savingName && <Loader2 size={13} className="animate-spin" />} Lưu tên</button>
                </form>

                <div className="my-5 border-t border-black/[0.06]" />
                {socialLoading ? <Loader2 size={18} className="animate-spin text-ink/35" /> : social && (
                  <form key={`${social.me.id}-${social.me.birthDate ?? 'none'}`} onSubmit={(event) => void saveSocialProfile(event)}>
                    <label className="text-xs font-bold text-ink/55">Username
                      <input name="username" defaultValue={social.me.username} pattern="[a-z0-9_]{3,40}" required className={fieldClass} />
                    </label>
                    <label className="mt-3 block text-xs font-bold text-ink/55">Ngày sinh
                      <input type="date" name="birthDate" defaultValue={social.me.birthDate ?? ''} disabled={Boolean(social.me.birthDate)} max={new Date().toISOString().slice(0, 10)} className={`${fieldClass} disabled:opacity-50`} />
                    </label>
                    <Feedback message={socialMessage} />
                    <button type="submit" disabled={socialBusy} className={`${buttonClass} mt-4`}>{socialBusy && <Loader2 size={13} className="animate-spin" />} Lưu thông tin</button>
                  </form>
                )}
              </SettingsCard>

              {user.hasPassword === false ? (
                <SettingsCard icon={KeyRound} title="Đăng nhập bằng Google" className="lg:col-span-2">
                  <p className="text-sm leading-6 text-ink/60">Tài khoản <span className="font-semibold text-ink">{user.email}</span> đăng nhập bằng Google nên không có mật khẩu Fitsy. Email và mật khẩu được quản lý trong tài khoản Google của bạn.</p>
                </SettingsCard>
              ) : <>
              <SettingsCard icon={Mail} title="Địa chỉ email">
                <p className="mb-4 truncate text-sm font-semibold text-ink/60">{user.email}</p>
                <form onSubmit={(event) => void saveEmail(event)}>
                  <label className="text-xs font-bold text-ink/55">Email mới
                    <input type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} required autoComplete="email" className={fieldClass} />
                  </label>
                  <label className="mt-3 block text-xs font-bold text-ink/55">Mật khẩu hiện tại
                    <input type="password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} required autoComplete="current-password" className={fieldClass} />
                  </label>
                  <Feedback message={emailMessage} />
                  <button type="submit" disabled={savingEmail || !newEmail || !emailPassword} className={`${buttonClass} mt-4`}>{savingEmail && <Loader2 size={13} className="animate-spin" />} Đổi email</button>
                </form>
              </SettingsCard>

              <SettingsCard icon={KeyRound} title="Mật khẩu" className="lg:col-span-2">
                <form onSubmit={(event) => void savePassword(event)}>
                  <div className="mb-2 flex justify-end">
                    <button type="button" onClick={() => setShowPasswords(value => !value)} className="flex items-center gap-1.5 text-[10px] font-semibold text-ink/45 hover:text-ink">{showPasswords ? <EyeOff size={12} /> : <Eye size={12} />}{showPasswords ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}</button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="text-xs font-bold text-ink/55">Mật khẩu hiện tại<input type={showPasswords ? 'text' : 'password'} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required autoComplete="current-password" className={fieldClass} /></label>
                    <label className="text-xs font-bold text-ink/55">Mật khẩu mới<input type={showPasswords ? 'text' : 'password'} value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} required autoComplete="new-password" className={fieldClass} /></label>
                    <label className="text-xs font-bold text-ink/55">Nhập lại mật khẩu<input type={showPasswords ? 'text' : 'password'} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={8} required autoComplete="new-password" className={fieldClass} /></label>
                  </div>
                  <Feedback message={passwordMessage} />
                  <button type="submit" disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword} className={`${buttonClass} mt-4`}>{savingPassword && <Loader2 size={13} className="animate-spin" />} Lưu mật khẩu</button>
                </form>
              </SettingsCard>
              </>}

              <section className="flex flex-col gap-4 rounded-[26px] border border-red-100 bg-red-50/70 p-5 sm:flex-row sm:items-center sm:justify-between lg:col-span-2">
                <div>
                  <h2 className="text-sm font-bold text-red-900">Tài khoản</h2>
                  <Feedback message={deleteMessage} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={onLogout} disabled={isLoggingOut || deletingAccount} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50">{isLoggingOut ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />} Đăng xuất</button>
                  <button type="button" onClick={() => setDeleteDialogOpen(true)} disabled={deletingAccount} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-red-700 disabled:opacity-50"><Trash2 size={13} /> Xóa tài khoản</button>
                </div>
              </section>
            </section>
          )}

          {section === 'privacy' && (
            <section className="space-y-5">
              {socialLoading ? (
                <div className="grid min-h-48 place-items-center"><Loader2 size={24} className="animate-spin text-ink/35" /></div>
              ) : social ? (
                <>
                  <div className="grid gap-5 lg:grid-cols-2">
                    <SettingsCard icon={Shield} title="Quyền riêng tư">
                      <form key={`${social.me.id}-${social.me.invitePolicy}-${social.me.defaultVisibility}`} onSubmit={(event) => void savePrivacy(event)}>
                        <label className="block text-xs font-bold text-ink/55">Ai được gửi lời mời?
                          <select name="invitePolicy" defaultValue={social.me.invitePolicy} className={fieldClass}>
                            <option value="known">Bạn chung hoặc có mã mời</option>
                            <option value="code">Chỉ người có mã mời</option>
                            <option value="everyone">Mọi người</option>
                          </select>
                        </label>
                        <label className="mt-4 block text-xs font-bold text-ink/55">Quyền xem outfit mặc định
                          <select name="defaultVisibility" defaultValue={social.me.defaultVisibility} className={fieldClass}>
                            <option value="private">Chỉ mình tôi</option>
                            <option value="friends">Bạn bè</option>
                          </select>
                        </label>
                        <Feedback message={socialMessage} />
                        <button type="submit" disabled={socialBusy} className={`${buttonClass} mt-4`}>{socialBusy && <Loader2 size={13} className="animate-spin" />} Lưu quyền riêng tư</button>
                      </form>
                    </SettingsCard>

                    <SettingsCard icon={UserX} title="Danh sách đã chặn">
                      {social.blocked.length === 0 ? (
                        <p className="text-sm text-ink/40">Chưa chặn ai.</p>
                      ) : (
                        <div className="divide-y divide-black/[0.06]">
                          {social.blocked.map(person => (
                            <div key={person.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                              <Avatar name={person.name} src={person.avatar} className="size-10 text-xs" />
                              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{person.name}</p><p className="truncate text-xs text-ink/40">@{person.username}</p></div>
                              <button type="button" disabled={socialBusy} onClick={() => void socialAct('unblock', { targetId: person.id })} className="rounded-full border border-black/[0.09] bg-white px-3 py-1.5 text-xs font-bold text-ink/60 hover:bg-sage-50">Bỏ chặn</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </SettingsCard>
                  </div>
                </>
              ) : null}
              {!social && <Feedback message={socialMessage} />}
            </section>
          )}

          {section === 'appearance' && (
            <section className="space-y-5">
              <SettingsCard icon={darkMode ? Moon : Sun} title="Giao diện">
                <div className="divide-y divide-black/[0.06]">
                  <div className="flex items-center justify-between gap-4 py-2">
                    <p className="text-sm font-bold text-ink">Chế độ tối</p>
                    <button type="button" role="switch" aria-checked={darkMode} onClick={() => onDarkModeChange(!darkMode)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${darkMode ? 'bg-sage-700' : 'bg-black/15'}`}><span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-transform ${darkMode ? 'translate-x-6' : 'translate-x-1'}`} /></button>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-4">
                    <p className="text-sm font-bold text-ink">Hướng dẫn ban đầu</p>
                    <button type="button" onClick={onReplayOnboarding} className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3.5 py-2 text-xs font-bold text-ink transition hover:bg-sage-50"><RotateCcw size={13} /> Mở lại</button>
                  </div>
                </div>
              </SettingsCard>
            </section>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Xóa vĩnh viễn tài khoản?"
        description="Hồ sơ, tủ đồ, outfit, ảnh thử đồ và nội dung đã đăng sẽ bị xóa. Giao dịch bắt buộc lưu theo quy định sẽ được ẩn danh. Hành động này không thể hoàn tác."
        confirmLabel="Xóa tài khoản"
        isBusy={deletingAccount}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={() => void deleteAccount()}
      />
    </main>
  )
}

function SettingsCard({ icon: Icon, title, children, className = '' }: { icon: typeof Settings; title: string; children: ReactNode; className?: string }) {
  return (
    <article className={`rounded-[26px] border border-black/[0.06] bg-panel p-5 shadow-xs sm:p-6 ${className}`}>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-sage-100 text-sage-800"><Icon size={18} /></span>
        <h2 className="font-display text-base font-bold text-ink">{title}</h2>
      </div>
      {children}
    </article>
  )
}
