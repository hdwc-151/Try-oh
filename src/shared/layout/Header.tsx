import { BadgeDollarSign, Crown, Home, Images, LogOut, Settings, ShieldCheck, Shirt, UserRound, Users, WandSparkles } from 'lucide-react'
import { startTransition, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { appViewPaths, type AppView } from '../../navigation'
import type { AuthUser } from '../../types/auth'
import { BrandLogo } from '../components/BrandMark'
import { NotificationBell } from '../../features/social/NotificationBell'
import { Avatar } from '../components/Avatar'

type HeaderProps = {
  activeView: AppView
  historyCount: number
  selectedCount: number
  onViewChange: (view: AppView) => void
  user: AuthUser
  isLoggingOut: boolean
  onLogout: () => void
  avatarUrl?: string | null
}

const navigationItems: Array<{
  view: AppView
  label: string
  icon: typeof Home
}> = [
    { view: 'feed', label: 'Bảng tin', icon: Home },
    { view: 'wardrobe', label: 'Tủ đồ', icon: Shirt },
    { view: 'fitting', label: 'Phòng thử', icon: WandSparkles },
    { view: 'outfits', label: 'Bộ sưu tập', icon: Images },
    { view: 'friends', label: 'Bạn bè', icon: Users },
    { view: 'koc', label: 'KOL/KOC', icon: BadgeDollarSign },
    { view: 'profile', label: 'Hồ sơ', icon: UserRound },
  ]

export function Header({
  activeView,
  historyCount,
  selectedCount,
  onViewChange,
  user,
  isLoggingOut,
  onLogout,
  avatarUrl,
}: HeaderProps) {
  const navigationView = activeView === 'settings' || activeView === 'plans' ? 'profile' : activeView
  const targetIndex = Math.max(0, navigationItems.findIndex((item) => item.view === navigationView))

  const [slider, setSlider] = useState<{
    current: number
    from: number
    to: number
    dist: number
    isAnimating: boolean
    animKey: number
  }>({
    current: targetIndex,
    from: targetIndex,
    to: targetIndex,
    dist: 0,
    isAnimating: false,
    animKey: 0,
  })

  const prevTargetRef = useRef(targetIndex)
  useEffect(() => {
    if (prevTargetRef.current !== targetIndex) {
      const from = prevTargetRef.current
      prevTargetRef.current = targetIndex
      setSlider({
        current: targetIndex,
        from,
        to: targetIndex,
        dist: Math.abs(targetIndex - from),
        isAnimating: true,
        animKey: Date.now(),
      })
    }
  }, [targetIndex])

  const openView = (event: MouseEvent<HTMLAnchorElement>, view: AppView, index: number) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (index === slider.current && activeView === view) return

    const from = slider.current
    prevTargetRef.current = index

    setSlider({
      current: index,
      from,
      to: index,
      dist: Math.max(1, Math.abs(index - from)),
      isAnimating: true,
      animKey: Date.now(),
    })

    startTransition(() => {
      onViewChange(view)
    })
  }

  const handleAnimationEnd = () => {
    setSlider((prev) => ({
      ...prev,
      isAnimating: false,
    }))
  }

  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.055] bg-panel/90 px-3 py-2.5 backdrop-blur-xl sm:px-6 sm:py-3">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-3 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center justify-start">
          <a href={appViewPaths.feed} onClick={(event) => openView(event, 'feed', 0)} className="group flex items-center gap-3 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500">
            <BrandLogo
              markClassName="size-9 transition-transform duration-300 group-hover:scale-105 sm:size-10"
              wordmarkClassName="text-lg sm:text-xl"
            />
          </a>
        </div>

        {/* Capsule Navigation Bar - Căn chính giữa trang */}
        <nav className="hidden justify-center lg:flex" aria-label="Điều hướng chính">
          <div className="relative flex h-12 w-full max-w-[360px] items-center rounded-full border border-white/10 bg-[#16171a] p-1.5 shadow-[0_10px_35px_rgba(0,0,0,0.35)] sm:h-13 sm:w-[420px]">
            {/* Sliding translucent gray capsule box with stretch physics */}
            <span
              key={slider.animKey}
              className={'app-nav-slider ' + (slider.isAnimating ? 'is-animating' : '')}
              style={
                {
                  '--from-idx': slider.from,
                  '--to-idx': slider.to,
                  '--dist': slider.dist,
                  transform: slider.isAnimating
                    ? undefined
                    : `translate3d(${slider.current * 100}%, 0, 0)`,
                } as CSSProperties
              }
              onAnimationEnd={handleAnimationEnd}
              aria-hidden="true"
            />

            <div className="relative z-10 grid h-full w-full grid-cols-7">
              {navigationItems.map((item, index) => {
                const Icon = item.icon
                const isActive = navigationView === item.view || (slider.isAnimating && slider.to === index)
                const count = item.view === 'outfits' ? historyCount : item.view === 'fitting' ? selectedCount : 0
                return (
                  <a
                    key={item.view}
                    href={appViewPaths[item.view]}
                    onClick={(event) => openView(event, item.view, index)}
                    title={item.label}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={
                      'group flex h-full w-full items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ' +
                      (isActive
                        ? 'text-white'
                        : 'text-white/45 hover:text-white/80')
                    }
                  >
                    <span className="relative flex items-center justify-center">
                      <Icon
                        size={20}
                        strokeWidth={isActive ? 2.4 : 1.8}
                        className={
                          'transition-all duration-200 ' +
                          (isActive
                            ? 'scale-110 drop-shadow-[0_1px_4px_rgba(255,255,255,0.35)]'
                            : 'group-hover:scale-105')
                        }
                        aria-hidden="true"
                      />
                      {count > 0 && (
                        <span
                          className={
                            'absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold shadow-xs transition-transform duration-300 ' +
                            (isActive
                              ? 'bg-white text-[#16171a] ring-2 ring-[#16171a]'
                              : 'bg-white/90 text-[#16171a] ring-1 ring-[#16171a]')
                          }
                        >
                          {count}
                        </span>
                      )}
                    </span>
                    <span className="sr-only">{item.label}</span>
                  </a>
                )
              })}
            </div>
          </div>
        </nav>

        <div className="flex items-center justify-end">
          <div className="flex items-center gap-1 rounded-full border border-black/[0.06] bg-white/80 py-1 pl-1 pr-1.5 shadow-sm backdrop-blur-md sm:gap-2.5 sm:pl-1.5 sm:pr-2">
            <NotificationBell />
            {(user.role === 'admin' || user.role === 'moderator') && (
              <button type="button" onClick={() => onViewChange('admin')} className="grid size-8 place-items-center rounded-full bg-amber-50 text-amber-800 transition hover:bg-amber-100" aria-label="Mở trang quản trị" title="Quản trị">
                <ShieldCheck size={15} />
              </button>
            )}
            <button type="button" onClick={() => onViewChange('profile')} className="relative shrink-0 rounded-full transition hover:scale-105" aria-label="Mở hồ sơ">
              <Avatar name={user.displayName} src={avatarUrl} className="size-8 text-[10px] shadow-xs" />
              <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500" />
            </button>
            <div className="hidden min-w-0 pr-1 sm:block">
              <p className="max-w-28 truncate text-[11px] font-bold text-ink leading-tight">{user.displayName}</p>
              <p className="max-w-28 truncate text-[8.5px] font-medium text-ink/40">{user.email}</p>
            </div>
            <button type="button" onClick={() => onViewChange('plans')} className={`grid size-9 shrink-0 place-items-center rounded-full transition sm:size-7 ${activeView === 'plans' ? 'bg-amber-100 text-amber-800' : 'text-ink/35 hover:bg-amber-50 hover:text-amber-700'}`} aria-label="Xem gói đăng ký" title="Gói đăng ký"><Crown size={13} /></button>
            <button type="button" onClick={() => onViewChange('settings')} className={`grid size-9 shrink-0 place-items-center rounded-full transition sm:size-7 ${activeView === 'settings' ? 'bg-sage-100 text-sage-800' : 'text-ink/35 hover:bg-sage-50 hover:text-ink/70'}`} aria-label="Mở cài đặt" title="Cài đặt"><Settings size={13} /></button>
            <button type="button" onClick={onLogout} disabled={isLoggingOut} className="grid size-9 shrink-0 place-items-center rounded-full text-ink/35 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40 sm:size-7" aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={13} /></button>
          </div>
        </div>
      </div>
    </header>
  )
}
