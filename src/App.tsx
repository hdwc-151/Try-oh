import { LoaderCircle, Shirt } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Header } from './components/Header'
import { BrandMark } from './components/brand/BrandMark'
import { MobileNavigation, QuickActionSheet } from './components/MobileNavigation'
import type { PersonPanelHandle } from './components/PersonPanel'
import { useTryOnGeneration } from './hooks/useTryOnGeneration'
import { usePlanStatus } from './hooks/usePlanStatus'
import { appViewPaths, resolveAppView, type AppView } from './navigation'
import { authApi } from './services/auth-api'
import { readStoredValue, storageKeys, writeStoredValue } from './services/local-storage-keys'
import { garmentApi } from './services/garment-api'
import { personApi } from './services/person-api'
import { socialApi } from './services/social-api'
import { tryOnApi } from './services/try-on-api'
import { useFittingRoomStore } from './store/useFittingRoomStore'
import type { AuthUser } from './types/auth'
import { MAX_SELECTED_GARMENTS } from './types/fitting-room'
import { FREE_ENTITLEMENTS } from './types/plans'

const AuthPage = lazy(() => import('./components/AuthPage').then((module) => ({ default: module.AuthPage })))
const AdminPage = lazy(() => import('./components/admin/AdminPage').then((module) => ({ default: module.AdminPage })))
const KocStudioPage = lazy(() => import('./components/KocStudioPage').then((module) => ({ default: module.KocStudioPage })))
const OnboardingFlow = lazy(() => import('./components/OnboardingFlow').then((module) => ({ default: module.OnboardingFlow })))
const OutfitHistory = lazy(() => import('./components/OutfitHistory').then((module) => ({ default: module.OutfitHistory })))
const PersonPanel = lazy(() => import('./components/PersonPanel').then((module) => ({ default: module.PersonPanel })))
const ProfilePage = lazy(() => import('./components/ProfilePage').then((module) => ({ default: module.ProfilePage })))
const PlansPage = lazy(() => import('./components/PlansPage').then((module) => ({ default: module.PlansPage })))
const SettingsPage = lazy(() => import('./components/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const SocialPage = lazy(() => import('./components/social/SocialPage').then((module) => ({ default: module.SocialPage })))
const ResultStage = lazy(() => import('./components/ResultStage').then((module) => ({ default: module.ResultStage })))
const UploadGarmentModal = lazy(() => import('./components/UploadGarmentModal').then((module) => ({ default: module.UploadGarmentModal })))
const WardrobePanel = lazy(() => import('./components/WardrobePanel').then((module) => ({ default: module.WardrobePanel })))

type FittingRoomAppProps = {
  user: AuthUser
  onLoggedOut: () => void
  onUserUpdate: (user: AuthUser) => void
}

const runViewTransition = (update: () => void) => {
  update()
}

function PageFallback() {
  return (
    <div className="grid min-h-[45dvh] place-items-center" role="status" aria-live="polite">
      <div className="text-center text-ink/45">
        <LoaderCircle size={22} className="mx-auto animate-spin" />
        <p className="mt-3 text-xs font-semibold">Đang tải…</p>
      </div>
    </div>
  )
}

function FittingRoomApp({ user, onLoggedOut, onUserUpdate }: FittingRoomAppProps) {
  const personPanelRef = useRef<PersonPanelHandle>(null)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isQuickActionOpen, setIsQuickActionOpen] = useState(false)
  const [composeSignal, setComposeSignal] = useState(0)
  const [showOnboarding, setShowOnboarding] = useState(() => readStoredValue(storageKeys.onboarding(user.id)) !== 'complete')
  const [darkMode, setDarkMode] = useState(() => readStoredValue(storageKeys.theme) === 'dark')
  const [activeView, setActiveView] = useState<AppView>(() => resolveAppView(window.location.pathname) ?? 'feed')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const workspaceLoadedRef = useRef(false)
  const mountedRef = useRef(true)
  const activeCategory = useFittingRoomStore((state) => state.activeCategory)
  const garments = useFittingRoomStore((state) => state.garments)
  const outfit = useFittingRoomStore((state) => state.outfit)
  const personImage = useFittingRoomStore((state) => state.personImage)
  const privacyConsent = useFittingRoomStore((state) => state.privacyConsent)
  const setGarments = useFittingRoomStore((state) => state.setGarments)
  const addGarment = useFittingRoomStore((state) => state.addGarment)
  const setLoading = useFittingRoomStore((state) => state.setLoadingGarments)
  const setError = useFittingRoomStore((state) => state.setWardrobeError)
  const setPersonImage = useFittingRoomStore((state) => state.setPersonImage)
  const resetWorkspace = useFittingRoomStore((state) => state.resetWorkspace)
  const plan = usePlanStatus()
  const entitlements = plan.snapshot?.current.entitlements ?? FREE_ENTITLEMENTS
  const generation = useTryOnGeneration(activeView === 'fitting' || activeView === 'outfits', entitlements.savedOutfits)
  const selectedCount = [
    outfit.tops,
    outfit.outerwear,
    outfit.bottoms,
    outfit.shoes,
    ...outfit.accessories,
  ].filter(Boolean).length

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    writeStoredValue(storageKeys.theme, darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    let current = true
    socialApi.snapshot()
      .then((snapshot) => {
        if (current) setAvatarUrl(snapshot.me.avatar.startsWith('/uploads/') ? snapshot.me.avatar : null)
      })
      .catch(() => { if (current) setAvatarUrl(null) })
    return () => { current = false }
  }, [user.id])

  const navigate = useCallback((view: AppView) => {
    const nextPath = appViewPaths[view]
    if (window.location.pathname !== nextPath) window.history.pushState(null, '', nextPath)
    setActiveView(view)
    if (window.scrollY > 120) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [])

  const openGarmentUpload = () => {
    if (garments.length >= entitlements.wardrobeItems) {
      setError(`Gói hiện tại lưu tối đa ${entitlements.wardrobeItems} món trong tủ đồ.`)
      navigate('wardrobe')
      return
    }
    setError(null)
    setIsUploadOpen(true)
  }

  useEffect(() => {
    const initialView = resolveAppView(window.location.pathname)
    if (!initialView) window.history.replaceState(null, '', appViewPaths.feed)
    const handlePopState = () => {
      setActiveView(resolveAppView(window.location.pathname) ?? 'feed')
      if (window.scrollY > 120) {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const logout = async () => {
    setIsLoggingOut(true)
    try {
      await authApi.logout()
      garmentApi.clearCache()
      socialApi.clearCache()
      tryOnApi.clearCache()
      resetWorkspace()
      onLoggedOut()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Không thể đăng xuất.')
    } finally {
      setIsLoggingOut(false)
    }
  }

  const openPollComposer = () => {
    navigate('feed')
    setComposeSignal(value => value + 1)
  }

  useEffect(() => {
    const shouldLoadWorkspace = showOnboarding || activeView === 'wardrobe' || activeView === 'fitting'
    if (!shouldLoadWorkspace || workspaceLoadedRef.current) return
    workspaceLoadedRef.current = true
    const loadWardrobe = async () => {
      setLoading(true)
      setError(null)
      try {
        const [savedGarments, personImage] = await Promise.all([
          garmentApi.list(),
          personApi.get(),
        ])
        if (mountedRef.current) {
          setGarments(savedGarments)
          setPersonImage(personImage)
        }
      } catch (error) {
        workspaceLoadedRef.current = false
        if (mountedRef.current) setError(error instanceof Error ? error.message : 'Không thể tải tủ đồ.')
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    }
    void loadWardrobe()
  }, [activeView, setError, setGarments, setLoading, setPersonImage, showOnboarding])

  return (
    <div className="min-h-[100dvh] bg-canvas pb-[calc(6.5rem+env(safe-area-inset-bottom))] text-ink bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(215,223,212,0.32),transparent_70%),radial-gradient(circle_at_bottom_right,rgba(235,230,220,0.35),transparent_50%)] lg:pb-0">
      <Header
        activeView={activeView}
        historyCount={generation.history.length}
        selectedCount={selectedCount}
        onViewChange={navigate}
        user={user}
        isLoggingOut={isLoggingOut}
        onLogout={() => void logout()}
        avatarUrl={avatarUrl}
      />

      <Suspense fallback={<PageFallback />}>
      <div key={activeView} className="app-page-transition">
        {(activeView === 'feed' || activeView === 'friends') && <SocialPage mode={activeView} composeSignal={composeSignal} onCreateOutfit={() => navigate('fitting')} />}
        {activeView === 'wardrobe' && (
          <main className="mx-auto w-full max-w-[1680px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
            <WardrobePanel
              mode="page"
              onAddGarment={openGarmentUpload}
              onGoToFitting={() => navigate('fitting')}
              maxGarments={entitlements.wardrobeItems}
            />
          </main>
        )}

        {activeView === 'fitting' && (
          <main className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
            <section className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">Tạo ảnh thử đồ</h2>
                <p className="mt-1 text-xs text-ink/45 sm:text-sm">Hoàn thành lần lượt ba bước dưới đây.</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('wardrobe')}
                className="group flex items-center gap-2.5 self-start rounded-full border border-black/[0.08] bg-white/85 px-4 py-2 text-xs sm:text-sm font-semibold text-ink shadow-xs backdrop-blur-md transition-all hover:border-black/20 hover:bg-white hover:shadow-md sm:self-auto"
              >
                <Shirt size={15} className="text-ink/60 transition-transform group-hover:scale-110" />
                <span>Chọn đồ</span>
                <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-bold text-ink">
                  {selectedCount}/{MAX_SELECTED_GARMENTS}
                </span>
              </button>
            </section>

            <nav className="mb-5 grid grid-cols-3 overflow-hidden rounded-[22px] border border-black/[0.07] bg-white/75 p-1.5 shadow-xs backdrop-blur-sm" aria-label="Các bước tạo ảnh">
              <button
                type="button"
                onClick={() => document.getElementById('fitting-setup')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="flex min-w-0 items-center gap-2 rounded-2xl px-2 py-2.5 text-left transition hover:bg-black/[0.035] sm:px-4"
              >
                <span className={'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ' + (personImage && privacyConsent ? 'bg-sage-700 text-white' : 'bg-amber-100 text-amber-800')}>
                  {personImage && privacyConsent ? '✓' : '1'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-ink sm:text-xs">Ảnh của bạn</span>
                  <span className="hidden truncate text-[10px] text-ink/40 sm:block">
                    {!personImage ? 'Chưa tải ảnh' : !privacyConsent ? 'Cần xác nhận' : 'Đã sẵn sàng'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate('wardrobe')}
                className="flex min-w-0 items-center gap-2 rounded-2xl px-2 py-2.5 text-left transition hover:bg-black/[0.035] sm:px-4"
              >
                <span className={'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ' + (selectedCount > 0 ? 'bg-sage-700 text-white' : 'bg-black/[0.06] text-ink/55')}>
                  {selectedCount > 0 ? '✓' : '2'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-ink sm:text-xs">Chọn đồ</span>
                  <span className="hidden truncate text-[10px] text-ink/40 sm:block">{selectedCount}/{MAX_SELECTED_GARMENTS} món</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('generate-try-on')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="flex min-w-0 items-center gap-2 rounded-2xl px-2 py-2.5 text-left transition hover:bg-black/[0.035] sm:px-4"
              >
                <span className={'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ' + (personImage && privacyConsent && selectedCount > 0 ? 'bg-[#16171b] text-white' : 'bg-black/[0.06] text-ink/55')}>3</span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-ink sm:text-xs">Tạo ảnh</span>
                  <span className="hidden truncate text-[10px] text-ink/40 sm:block">{personImage && privacyConsent && selectedCount > 0 ? 'Sẵn sàng' : 'Chưa sẵn sàng'}</span>
                </span>
              </button>
            </nav>

            <div className="grid grid-cols-1 gap-5 lg:h-[calc(100dvh-250px)] lg:min-h-[620px] lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="order-2 min-h-0 lg:order-1">
                <ResultStage
                  states={generation.states}
                  onRegenerate={generation.regenerate}
                  onSelectImage={() => personPanelRef.current?.chooseImage()}
                />
              </div>
              <div className="order-1 min-h-0 lg:order-2">
                <PersonPanel
                  ref={personPanelRef}
                  onGenerate={generation.generateAll}
                  onClearResults={generation.clearResults}
                  isGenerating={generation.isGenerating}
                  creditStatus={generation.creditStatus}
                  onOpenPlans={() => navigate('plans')}
                />
              </div>
            </div>
          </main>
        )}

        {activeView === 'outfits' && (
          <OutfitHistory
            outfits={generation.history}
            isLoading={generation.isHistoryLoading}
            error={generation.historyError}
            onDelete={generation.deleteOutfit}
            onUpdateOutfit={generation.updateOutfit}
            onBack={() => navigate('fitting')}
            onEditInFitting={(outfit) => {
              useFittingRoomStore.getState().loadOutfitGarments(outfit.garmentIds)
              navigate('fitting')
            }}
            maxSavedOutfits={entitlements.savedOutfits}
          />
        )}

        {activeView === 'koc' && <KocStudioPage user={user} onNavigate={navigate} />}
        {activeView === 'admin' && <AdminPage user={user} onNavigate={navigate} />}
        {activeView === 'plans' && <PlansPage snapshot={plan.snapshot} loading={plan.loading} error={plan.error} onReload={() => void plan.reload()} onNavigate={navigate} />}

        {activeView === 'profile' && (
          <ProfilePage
            user={user}
            onNavigate={navigate}
            avatarUrl={avatarUrl}
            onAvatarChange={setAvatarUrl}
          />
        )}
        {activeView === 'settings' && (
          <SettingsPage
            user={user}
            isLoggingOut={isLoggingOut}
            onNavigate={navigate}
            onLogout={() => void logout()}
            darkMode={darkMode}
            onDarkModeChange={setDarkMode}
            onReplayOnboarding={() => setShowOnboarding(true)}
            onUserUpdate={onUserUpdate}
          />
        )}
      </div>
      </Suspense>

      {isUploadOpen && (
        <Suspense fallback={null}>
          <UploadGarmentModal
            open
            defaultCategory={activeCategory}
            onClose={() => setIsUploadOpen(false)}
            onSaved={addGarment}
          />
        </Suspense>
      )}
      <MobileNavigation activeView={activeView} onNavigate={navigate} onQuickAction={() => setIsQuickActionOpen(true)} />
      <QuickActionSheet
        open={isQuickActionOpen}
        onClose={() => setIsQuickActionOpen(false)}
        onUpload={openGarmentUpload}
        onOutfit={() => navigate('fitting')}
        onPoll={openPollComposer}
        onKoc={() => navigate('koc')}
      />
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingFlow
            user={user}
            hasGarments={garments.length > 0}
            onComplete={(destination) => {
              setShowOnboarding(false)
              if (destination === 'upload') openGarmentUpload()
              else navigate('fitting')
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined)
  const [startupError, setStartupError] = useState<string | null>(null)

  useEffect(() => {
    authApi.me()
      .then(setUser)
      .catch((error: unknown) => {
        setStartupError(error instanceof Error ? error.message : 'Không thể kiểm tra phiên đăng nhập.')
        setUser(null)
      })
  }, [])

  if (user === undefined) {
    return <div className="grid min-h-[100dvh] place-items-center bg-canvas"><div className="text-center text-ink/40"><BrandMark className="mx-auto mb-3 size-12" label="Fitsy" /><LoaderCircle size={20} className="mx-auto animate-spin" /><p className="mt-3 text-xs font-semibold">Đang mở phòng thử…</p></div></div>
  }

  if (!user) {
    return <><Suspense fallback={<PageFallback />}><AuthPage onAuthenticated={(authenticatedUser, portal) => { setStartupError(null); setUser(authenticatedUser); if(portal==='creator'){window.history.replaceState(null,'','/koc')} }} /></Suspense>{startupError && <div className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[120] rounded-xl bg-red-600 px-4 py-2 text-center text-xs text-white shadow-lg sm:left-1/2 sm:right-auto sm:-translate-x-1/2">{startupError}</div>}</>
  }

  return <FittingRoomApp user={user} onLoggedOut={() => setUser(null)} onUserUpdate={(updated) => setUser(updated)} />
}

export default App
