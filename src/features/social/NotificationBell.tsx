import { Bell, Check, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SocialNotification } from '../../../server/social/types'
import { socialApi } from '../../services/social-api'

const notificationHref = (notification: SocialNotification) =>
  notification.kind === 'request'
    ? '/ban-be?tab=requests'
    : `/bang-tin?poll=${encodeURIComponent(notification.targetId)}`

const notificationLabel: Record<SocialNotification['kind'], string> = {
  request: 'Bạn bè',
  poll: 'Xin ý kiến',
  result: 'Kết quả',
}

const formatTime = (value: number) => new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
}).format(new Date(value))

export function NotificationBell() {
  const [notifications, setNotifications] = useState<SocialNotification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const unreadCount = notifications.filter((notification) => !notification.read).length

  const load = async (showLoading = false) => {
    if (showLoading) setIsLoading(true)
    try {
      const data = await socialApi.snapshot()
      setNotifications(data.notifications)
      setError('')
    } catch {
      setError('Không thể tải thông báo.')
    } finally {
      if (showLoading) setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const data = await socialApi.snapshot({ force: true })
        if (active) {
          setNotifications(data.notifications)
          setError('')
        }
      } catch {
        if (active) setError('Không thể tải thông báo.')
      } finally {
        if (active) setIsLoading(false)
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeWithKeyboard)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeWithKeyboard)
    }
  }, [isOpen])

  const openNotification = async (notification: SocialNotification) => {
    const href = notificationHref(notification)
    if (!notification.read) {
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item))
      try {
        await socialApi.act('notification-read', { id: notification.id })
      } catch {
        // Navigation still succeeds; a later refresh restores server state if needed.
      }
    }
    window.location.assign(href)
  }

  const markAllAsRead = async () => {
    if (unreadCount === 0) return
    const previous = notifications
    setNotifications((current) => current.map((item) => ({ ...item, read: true })))
    try {
      await socialApi.act('notification-read', {})
    } catch {
      setNotifications(previous)
      setError('Không thể đánh dấu đã đọc.')
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button type="button" title="Thông báo bạn bè" aria-label={`Thông báo bạn bè, ${unreadCount} chưa đọc`} aria-expanded={isOpen} aria-haspopup="dialog" onClick={() => { setIsOpen((open) => !open); if (!isOpen) void load(true) }} className="relative grid size-8 place-items-center rounded-full text-ink/60 transition hover:bg-sage-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500">
        <Bell size={17} aria-hidden="true" />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-sage-700 px-1 text-[9px] font-bold leading-4 text-white ring-2 ring-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {isOpen && (
        <section role="dialog" aria-label="Danh sách thông báo" className="fixed left-3 right-3 top-[74px] z-50 overflow-hidden rounded-[22px] border border-black/[0.08] bg-white/95 shadow-[0_24px_70px_rgba(25,35,29,0.22)] backdrop-blur-xl sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+14px)] sm:w-[380px]">
          <header className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3.5">
            <div><h2 className="text-sm font-bold text-ink">Thông báo</h2><p className="mt-0.5 text-[10px] text-ink/45">{unreadCount} thông báo chưa đọc</p></div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && <button type="button" onClick={() => void markAllAsRead()} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-bold text-sage-800 transition hover:bg-sage-100"><Check size={13} aria-hidden="true" /> Đã đọc hết</button>}
              <button type="button" onClick={() => setIsOpen(false)} className="grid size-7 place-items-center rounded-full text-ink/40 transition hover:bg-black/[0.05] hover:text-ink" aria-label="Đóng thông báo"><X size={15} aria-hidden="true" /></button>
            </div>
          </header>

          <div className="max-h-[min(430px,calc(100dvh-150px))] overflow-y-auto overscroll-contain">
            {isLoading ? (
              <div className="grid min-h-40 place-items-center text-ink/35" role="status"><LoaderCircle size={22} className="animate-spin" aria-label="Đang tải thông báo" /></div>
            ) : error && notifications.length === 0 ? (
              <div className="px-5 py-8 text-center"><p className="text-xs text-red-600">{error}</p><button type="button" onClick={() => void load(true)} className="mt-3 text-xs font-bold text-sage-800 underline underline-offset-4">Thử lại</button></div>
            ) : notifications.length === 0 ? (
              <div className="px-6 py-10 text-center"><span className="mx-auto grid size-11 place-items-center rounded-full bg-sage-50 text-sage-700"><Bell size={19} /></span><p className="mt-3 text-sm font-semibold text-ink">Chưa có thông báo</p><p className="mt-1 text-xs leading-5 text-ink/45">Lời mời kết bạn và bình chọn mới sẽ xuất hiện ở đây.</p></div>
            ) : (
              <ul className="divide-y divide-black/[0.055]">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button type="button" onClick={() => void openNotification(notification)} className={`relative flex w-full gap-3 px-4 py-3.5 text-left transition hover:bg-sage-50/80 ${notification.read ? 'bg-white' : 'bg-sage-50/55'}`}>
                      <span className={`mt-1 size-2 shrink-0 rounded-full ${notification.read ? 'bg-transparent' : 'bg-sage-600'}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1"><span className="flex items-start justify-between gap-3"><span className={`text-xs leading-5 text-ink ${notification.read ? 'font-medium' : 'font-bold'}`}>{notification.text}</span><span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-1 text-[8px] font-bold uppercase tracking-wide text-ink/45">{notificationLabel[notification.kind]}</span></span><span className="mt-1 block text-[10px] text-ink/40">{formatTime(notification.createdAt)}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <a href="/bang-tin" className="block border-t border-black/[0.06] px-4 py-3 text-center text-[11px] font-bold text-sage-800 transition hover:bg-sage-50">Xem tất cả ở Bảng tin</a>
        </section>
      )}
    </div>
  )
}
