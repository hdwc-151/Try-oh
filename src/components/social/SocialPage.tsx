import { useCallback, useEffect, useState } from 'react'
import { ImageIcon, Loader2, AlertCircle, Upload } from 'lucide-react'
import type { SocialSnapshot, SocialPerson, SharedOutfit } from '../../../server/social/types'
import { socialApi } from '../../services/social-api'
import { FriendsPanel } from './FriendsPanel'
import { Avatar } from './Avatar'
import { PollCard } from './Voting'
import { PostComposer } from './PostComposer'
import { PostCard } from './PostCard'
import { ImageLightbox } from '../ImageLightbox'
import './social.css'

export type Act = (action: string, body: Record<string, unknown>) => Promise<boolean>

export function SocialPage({ mode, composeSignal = 0 }: { mode: 'feed' | 'friends'; onCreateOutfit: () => void; composeSignal?: number }) {
  const [data, setData] = useState<SocialSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(location.search).get('tab')
    return requested === 'requests' || requested === 'groups' ? requested : 'friends'
  })
  const [compose, setCompose] = useState(() => new URLSearchParams(location.search).get('compose') === '1')
  const pollId = new URLSearchParams(location.search).get('poll')
  const [profile, setProfile] = useState<{ person: SocialPerson; outfits: SharedOutfit[] } | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [reportText, setReportText] = useState('')

  useEffect(() => {
    if (composeSignal > 0 && mode === 'feed') setCompose(true)
  }, [composeSignal, mode])

  const refresh = useCallback(async () => {
    try { setData(await socialApi.snapshot()); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải dữ liệu.') }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setZoom(null); setProfile(null) } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])

  useEffect(() => {
    if (!profile) return
    const previous = document.activeElement as HTMLElement | null
    const dialogs = document.querySelectorAll<HTMLElement>('.social-overlay')
    const dialog = dialogs[dialogs.length - 1]
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialog) return
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea,select,summary,[tabindex="0"]'))
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); previous?.focus() }
  }, [!!profile])

  useEffect(() => {
    if (data && location.hash.startsWith('#poll-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [data?.polls.length])

  useEffect(() => { if (profile && data && !data.friends.some(p => p.id === profile.person.id)) { setProfile(null); setZoom(null) } }, [data, profile])

  useEffect(() => {
    if (!profile) return
    let active = true
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void socialApi.profile(profile.person.id).then(value => { if (active) setProfile(value) }).catch(() => { if (active) { setProfile(null); setZoom(null) } })
    }, 30_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [profile?.person.id])

  const act: Act = async (action, body) => {
    if (busy) return false
    setBusy(true); setError('')
    try { setData(await socialApi.act(action, body)); return true } catch (e) { setError(e instanceof Error ? e.message : 'Thao tác thất bại.'); return false } finally { setBusy(false) }
  }

  const openProfile = async (id: string) => { try { setProfile(await socialApi.profile(id)) } catch (e) { setError(String(e)) } }

  const friendsTabs = [
    { id: 'friends', label: 'Bạn bè', badge: 0 },
    { id: 'requests', label: 'Lời mời', badge: data?.incoming.length ?? 0 },
    { id: 'groups', label: 'Nhóm', badge: 0 },
  ]

  return (
    <main className={`social-page mx-auto px-3 pb-6 pt-4 text-ink sm:px-6 sm:pb-20 sm:pt-8 ${mode === 'feed' ? 'max-w-[1080px]' : 'max-w-[1320px]'}`}>
      {/* Page header */}
      <header className="mb-5 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {mode === 'feed' ? 'Bảng tin' : 'Bạn bè'}
          </h1>
        </div>
        {mode === 'feed' && (
          <button
            onClick={() => setCompose(!compose)}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#16171b] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-black hover:scale-[1.02]"
          >
            <Upload size={16} />
            Tải outfit
          </button>
        )}
      </header>

      {error && data && (
        <div role="alert" className="mb-5 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {!data && error ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-[22px] border border-red-200 bg-white/70 p-8 text-center" role="status">
          <AlertCircle size={28} className="text-red-500" />
          <div>
            <p className="font-bold text-ink">Chưa tải được bảng tin</p>
            <p className="mt-1 text-sm text-ink/50">Kết nối hoặc dữ liệu tài khoản đang có vấn đề.</p>
          </div>
          <button onClick={() => { setError(''); void refresh() }} className="rounded-full bg-[#16171b] px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-black">
            Thử lại
          </button>
        </div>
      ) : !data ? (
        <div className="flex min-h-64 items-center justify-center text-ink/35" role="status">
          <div className="text-center">
            <Loader2 size={28} className="mx-auto mb-3 animate-spin" />
            <p className="text-sm font-medium">Đang tải vòng kết nối…</p>
          </div>
        </div>
      ) : (
        <fieldset disabled={busy} className="block">
          <div className="min-w-0">
            {mode === 'friends' ? (
              <>
                {/* Tab bar */}
                <nav className="mb-5 flex flex-wrap gap-2" aria-label="Bạn bè">
                  {friendsTabs.map(({ id, label, badge }) => (
                    <button
                      key={id}
                      aria-pressed={tab === id}
                      onClick={() => setTab(id)}
                      className={`rounded-full px-4 py-2 text-xs font-semibold transition ${tab === id ? 'bg-[#16171b] text-white shadow-md' : 'bg-white/70 text-ink/60 border border-black/[0.08] hover:bg-white hover:text-ink'}`}
                    >
                      {label}
                      {badge > 0 && <span className="ml-1.5 rounded-full bg-sage-600 px-1.5 py-0.5 text-[9px] text-white">{badge}</span>}
                    </button>
                  ))}
                </nav>
                <FriendsPanel data={data} tab={tab} act={act} onProfile={id => void openProfile(id)} />
              </>
            ) : (
              <>
                {compose && <PostComposer data={data} onPublished={snapshot => { setData(snapshot); setCompose(false) }} onCancel={() => setCompose(false)} />}

                {data.posts.length === 0 && data.polls.length === 0 && (
                  <div className="flex flex-col items-center gap-4 rounded-[22px] border border-black/[0.07] bg-white/70 p-8 text-center backdrop-blur-sm sm:p-12">
                    <span className="grid size-14 place-items-center rounded-2xl bg-sage-50 text-sage-600">
                      <ImageIcon size={26} strokeWidth={1.5} />
                    </span>
                    <div>
                      <h2 className="font-bold text-ink">Chưa có outfit nào</h2>
                      <p className="mt-1 text-xs leading-5 text-ink/45">Tải ảnh để chia sẻ với bạn bè hoặc tạo bình chọn.</p>
                    </div>
                    <button
                      onClick={() => setCompose(true)}
                      className="inline-flex items-center gap-2 rounded-full bg-[#16171b] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-black"
                    >
                      <Upload size={15} /> Tải outfit đầu tiên
                    </button>
                  </div>
                )}

                {!pollId && data.posts.map(post => <PostCard key={post.id} post={post} me={data.me.id} onZoom={setZoom} onDelete={id=>void act('post-delete',{id})}/>)}

                {pollId && (
                  <p className="mb-4">
                    <a href="/bang-tin" className="inline-flex items-center gap-1 text-xs font-semibold text-sage-700 underline underline-offset-4">
                      ← Tất cả bình chọn
                    </a>
                  </p>
                )}
                {pollId && !data.polls.some(p => p.id === pollId) && (
                  <div className="rounded-[22px] border border-black/[0.07] bg-white/70 px-6 py-8 text-center text-sm text-ink/50">
                    Bình chọn đã bị xoá hoặc bạn không còn quyền xem.
                  </div>
                )}

                {data.polls.filter(p => !pollId || p.id === pollId).map(p => (
                  <PollCard key={p.id} poll={p} me={data.me.id} act={act} onZoom={setZoom} />
                ))}
              </>
            )}
          </div>
        </fieldset>
      )}

      {/* Profile overlay */}
      {profile && (
        <div className="social-overlay fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setProfile(null)}>
          <section
            role="dialog" aria-modal="true" aria-label="Hồ sơ bạn bè"
            className="relative max-h-[92dvh] w-full max-w-lg overflow-auto rounded-t-[28px] bg-white p-5 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:p-6"
            onClick={e => e.stopPropagation()}
          >
            <button autoFocus onClick={() => setProfile(null)} className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-black/[0.06] text-ink/50 hover:bg-black/10 transition" aria-label="Đóng">✕</button>
            <div className="mb-5 flex items-center gap-3">
              <Avatar name={profile.person.name} src={profile.person.avatar} className="size-12 text-sm" />
              <div>
                <h2 className="font-bold text-ink text-lg">{profile.person.name}</h2>
                <p className="text-xs text-ink/40">@{profile.person.username}</p>
              </div>
            </div>
            {profile.outfits.length > 0 ? (
              <>
                <p className="mb-3 text-xs text-ink/45">Chỉ những outfit đã chia sẻ với bạn.</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {profile.outfits.map(o => (
                    <button key={o.id} onClick={() => setZoom(o.frontImageUrl)} className="group relative overflow-hidden rounded-2xl border border-black/[0.07] bg-sage-50 p-0 transition hover:shadow-md">
                      <img src={o.frontImageUrl} alt="Outfit đã chia sẻ" loading="lazy" decoding="async" className="h-44 w-full object-contain" />
                      {o.official && <span className="absolute bottom-2 left-2 rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-bold text-white">★ Chính thức</span>}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <ImageIcon size={28} className="text-ink/20" />
                <p className="text-sm text-ink/40">Chưa có outfit được chia sẻ.</p>
              </div>
            )}
            <details className="mt-5 rounded-2xl border border-black/[0.07] bg-black/[0.02] p-4 text-sm">
              <summary className="cursor-pointer font-semibold text-ink/60 hover:text-ink transition">Quản lý kết nối</summary>
              <p className="mt-2 mb-3 text-xs leading-5 text-ink/40">Huỷ kết bạn/chặn sẽ thu hồi bài và ảnh chia sẻ, không gửi thông báo.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                <button onClick={() => void act('unfriend', { targetId: profile.person.id })} className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition">Huỷ kết bạn</button>
                <button onClick={() => void act('block', { targetId: profile.person.id })} className="rounded-full border border-black/10 bg-black/[0.04] px-3 py-1.5 text-xs font-semibold text-ink/60 hover:bg-black/[0.08] transition">Chặn</button>
              </div>
              <form onSubmit={e => { e.preventDefault(); const reason = new FormData(e.currentTarget).get('reason'); void act('report', { targetId: profile.person.id, reason }).then(ok => { if (ok) setProfile(null) }) }}>
                <label className="block text-xs font-medium text-ink/50 mb-1">Lý do báo cáo</label>
                <textarea name="reason" required minLength={5} maxLength={1000} value={reportText} onChange={e => setReportText(e.target.value)} className="w-full rounded-xl border border-black/[0.09] bg-white px-3 py-2 text-xs text-ink outline-none focus:ring-2 focus:ring-sage-400 resize-none" rows={3} />
                <button className="mt-2 rounded-full bg-red-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-700 transition">Gửi báo cáo riêng tư</button>
              </form>
            </details>
          </section>
        </div>
      )}

      <ImageLightbox
        open={Boolean(zoom)}
        src={zoom ?? ''}
        alt="Chi tiết outfit"
        onClose={() => setZoom(null)}
      />
    </main>
  )
}
