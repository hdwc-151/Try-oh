import { useEffect, useRef, useState } from 'react'
import { Search, UserPlus, Users, Link2, QrCode, Loader2, Check, X } from 'lucide-react'
import type { SocialSnapshot, SocialPerson } from '../../../server/social/types'
import { socialApi } from '../../services/social-api'
import { Avatar } from '../../shared/components/Avatar'
import type { Act } from './SocialPage'

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[22px] border border-black/[0.07] bg-white/80 p-5 backdrop-blur-sm shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function PersonRow({ person, action }: { person: SocialPerson; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-black/[0.05] last:border-0">
      <Avatar name={person.name} src={person.avatar} className="size-10 text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{person.name}</p>
        <p className="truncate text-xs text-ink/40">@{person.username}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

export function FriendsPanel({ data, tab, act, onProfile }: { data: SocialSnapshot; tab: string; act: Act; onProfile: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SocialPerson[]>([])
  const [error, setError] = useState('')
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('invite') ?? '')
  const [qr, setQr] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const searchVersion = useRef(0)
  const link = location.origin + '/ban-be?invite=' + encodeURIComponent(data.me.inviteCode)

  useEffect(() => {
    let active = true
    void import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(link, { width: 200, margin: 2 }))
      .then((value) => { if (active) setQr(value) })
      .catch(() => { if (active) setError('Không thể tạo QR.') })
    return () => { active = false }
  }, [link])

  const runSearch = async (value: string, version: number) => {
    const normalized = value.trim().replace(/^@/, '').trim()
    if (normalized.length < 2 || version !== searchVersion.current) return
    setSearching(true)
    try {
      const next = await socialApi.search(value)
      if (version !== searchVersion.current) return
      setResults(next)
      setSearched(true)
      setError('')
    } catch (e) {
      if (version !== searchVersion.current) return
      setResults([])
      setSearched(true)
      setError(e instanceof Error ? e.message : 'Không thể tìm bạn lúc này.')
    } finally {
      if (version === searchVersion.current) setSearching(false)
    }
  }

  useEffect(() => {
    const value = query.trim()
    const normalized = value.replace(/^@/, '').trim()
    const version = ++searchVersion.current
    if (normalized.length < 2) {
      setResults([])
      setSearched(false)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => { void runSearch(value, version) }, 350)
    return () => window.clearTimeout(timer)
  }, [query])

  const submitSearch = () => {
    const version = ++searchVersion.current
    void runSearch(query, version)
  }

  const resultAction = (person: SocialPerson) => {
    if (data.friends.some(friend => friend.id === person.id)) {
      return <button onClick={() => onProfile(person.id)} className={btnGhost}>Xem hồ sơ</button>
    }
    const incoming = data.incoming.find(request => request.from.id === person.id)
    if (incoming) {
      return (
        <button onClick={() => void act('request-response', { id: incoming.id, decision: 'accept' })} className={btnPrimary}>
          <Check size={12} /> Chấp nhận
        </button>
      )
    }
    if (data.outgoing.some(request => request.to.id === person.id)) {
      return <span className={btnBase + ' bg-sage-50 text-sage-800'}><Check size={12} /> Đã gửi</span>
    }
    return (
      <button onClick={() => void act('request', { targetId: person.id })} className={btnPrimary}>
        <UserPlus size={12} /> Kết bạn
      </button>
    )
  }

  const invite = async () => {
    try {
      let value = code.trim()
      if (value.includes('?')) value = new URL(value).searchParams.get('invite') ?? value
      const person = await socialApi.invite(value)
      await act('request', { targetId: person.id, inviteCode: value })
      setError('')
    } catch (e) { setError(String(e)) }
  }

  const btnBase = 'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition'
  const btnPrimary = `${btnBase} bg-[#16171b] text-white hover:bg-black shadow-sm`
  const btnGhost = `${btnBase} border border-black/[0.09] bg-white text-ink/60 hover:bg-sage-50 hover:text-ink`
  const btnDanger = `${btnBase} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100`

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>
      )}

      {/* FRIENDS tab */}
      {tab === 'friends' && (
        <>
          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
              <Search size={15} className="text-ink/40" /> Tìm bạn bè
            </h2>
            <p id="friend-search-help" className="mb-3 text-xs leading-5 text-ink/40">
              Nhập tên hiển thị hoặc <span className="font-semibold">@username</span>. Kết quả tự cập nhật sau 2 ký tự.
            </p>
            <form className="flex gap-2" onSubmit={e => { e.preventDefault(); submitSearch() }}>
              <div className="relative min-w-0 flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/30" />
                <input
                  aria-label="Tìm bạn theo tên hoặc username"
                  aria-describedby="friend-search-help"
                  placeholder="Ví dụ: Nguyễn Nam hoặc @nam"
                  value={query}
                  maxLength={50}
                  autoComplete="off"
                  onChange={e => setQuery(e.target.value)}
                  className="w-full rounded-xl border border-black/[0.09] bg-white py-2 pl-9 pr-9 text-sm text-ink outline-none focus:ring-2 focus:ring-sage-400 placeholder:text-ink/30"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Xoá nội dung tìm kiếm"
                    className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink/35 transition hover:bg-black/[0.05] hover:text-ink"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <button type="submit" disabled={searching} className={btnPrimary}>
                {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                Tìm
              </button>
            </form>
            <div className="mt-3" aria-live="polite" aria-busy={searching}>
              {searching && results.length === 0 && (
                <div className="flex items-center justify-center gap-2 rounded-xl bg-sage-50 px-4 py-5 text-xs text-ink/45">
                  <Loader2 size={14} className="animate-spin" /> Đang tìm trong cộng đồng…
                </div>
              )}
              {!searching && searched && results.length === 0 && (
                <div className="rounded-xl border border-dashed border-black/10 px-4 py-5 text-center">
                  <p className="text-sm font-semibold text-ink/65">Không tìm thấy tài khoản phù hợp</p>
                  <p className="mt-1 text-xs leading-5 text-ink/40">Kiểm tra lại tên, thử nhập @username hoặc dùng link mời.</p>
                </div>
              )}
              {results.length > 0 && (
                <>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink/30">
                    {results.length} kết quả
                  </p>
                  <div className="divide-y divide-black/[0.05]">
                    {results.map(person => <PersonRow key={person.id} person={person} action={resultAction(person)} />)}
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-ink">
              <Users size={15} className="text-ink/40" /> Bạn bè
              <span className="ml-auto text-xs font-medium text-ink/35">{data.friends.length} người</span>
            </h2>
            {data.friends.length === 0
              ? <p className="mt-3 text-xs leading-relaxed text-ink/40">Chia sẻ mã mời để bắt đầu vòng kết nối.</p>
              : data.friends.map(p => (
                  <PersonRow key={p.id} person={p} action={
                    <button className={btnGhost} onClick={() => onProfile(p.id)}>Xem hồ sơ →</button>
                  } />
                ))
            }
          </Card>
        </>
      )}

      {/* REQUESTS tab */}
      {(tab === 'requests' || (code && tab === 'friends')) && (
        <Card>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
            <Link2 size={15} className="text-ink/40" /> Kết nối bằng mã mời
          </h2>
          <label className="block text-xs font-medium text-ink/50 mb-1">Mã mời hoặc link của bạn bè</label>
          <input value={code} onChange={e => setCode(e.target.value)} className="mb-3 w-full rounded-xl border border-black/[0.09] bg-white px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-sage-400" />
          <button disabled={!code} onClick={() => void invite()} className={btnPrimary}>Gửi lời mời</button>
        </Card>
      )}

      {tab === 'requests' && (
        <>
          <Card>
            <h2 className="mb-3 text-sm font-bold text-ink">Đã nhận · {data.incoming.length}</h2>
            {data.incoming.length === 0
              ? <p className="text-xs text-ink/40">Không có lời mời nào.</p>
              : data.incoming.map(r => (
                  <PersonRow key={r.id} person={r.from} action={
                    <div className="flex gap-1.5">
                      <button onClick={() => void act('request-response', { id: r.id, decision: 'accept' })} className={btnPrimary}><Check size={12} />Chấp nhận</button>
                      <button onClick={() => void act('request-response', { id: r.id, decision: 'decline' })} className={btnGhost}>Từ chối</button>
                    </div>
                  } />
                ))
            }
            <h2 className="mb-3 mt-5 text-sm font-bold text-ink">Đã gửi · {data.outgoing.length}</h2>
            {data.outgoing.length === 0
              ? <p className="text-xs text-ink/40">Chưa có lời mời đang chờ.</p>
              : data.outgoing.map(r => (
                  <PersonRow key={r.id} person={r.to} action={
                    <button onClick={() => void act('request-response', { id: r.id, decision: 'cancel' })} className={btnGhost}>Huỷ lời mời</button>
                  } />
                ))
            }
          </Card>
          <Card>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink"><QrCode size={15} className="text-ink/40" /> Mã mời của bạn</h2>
            {qr && <img src={qr} alt="Mã QR kết bạn" width={144} height={144} className="mx-auto mb-4 rounded-2xl border border-black/[0.07] bg-white p-2" />}
            <input aria-label="Link mời" value={link} readOnly onFocus={e => e.target.select()} className="mb-3 w-full rounded-xl border border-black/[0.09] bg-sage-50 px-3 py-2 text-xs text-ink/60 outline-none" />
            <div className="flex gap-2">
              <button onClick={() => void navigator.clipboard.writeText(link).catch(() => setError('Hãy chọn và sao chép link phía trên.'))} className={btnPrimary}><Link2 size={12} /> Sao chép</button>
              <button className={btnGhost} onClick={() => void act('rotate-invite', {})}>Đổi mã mời</button>
            </div>
          </Card>
        </>
      )}

      {/* GROUPS tab */}
      {tab === 'groups' && (
        <>
          <Card>
            <h2 className="mb-3 text-sm font-bold text-ink">{editing ? 'Chỉnh sửa nhóm' : 'Tạo nhóm riêng'}</h2>
            <form onSubmit={e => { e.preventDefault(); void act('group-save', { id: editing ?? undefined, name: groupName, memberIds: members }).then(ok => { if (ok) { setEditing(null); setGroupName(''); setMembers([]) } }) }}>
              <label className="block text-xs font-medium text-ink/50 mb-1">Tên nhóm</label>
              <input value={groupName} onChange={e => setGroupName(e.target.value)} required maxLength={60} className="mb-3 w-full rounded-xl border border-black/[0.09] bg-white px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-sage-400" />
              <p className="mb-2 text-xs text-ink/40">Thành viên là bạn bè của bạn:</p>
              <div className="flex flex-col gap-1 mb-3">
                {data.friends.map(p => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-sage-50 transition">
                    <input type="checkbox" checked={members.includes(p.id)} onChange={() => setMembers(members.includes(p.id) ? members.filter(id => id !== p.id) : [...members, p.id])} className="accent-sage-700" />
                    <Avatar name={p.name} src={p.avatar} className="size-7 text-[9px]" />
                    <span className="text-sm font-medium text-ink">{p.name}</span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button className={btnPrimary}>Lưu nhóm</button>
                {editing && <button type="button" className={btnGhost} onClick={() => { setEditing(null); setGroupName(''); setMembers([]) }}>Huỷ sửa</button>}
              </div>
            </form>
          </Card>
          {data.groups.map(g => (
            <Card key={g.id}>
              <h2 className="mb-1 text-sm font-bold text-ink">{g.name}</h2>
              <p className="mb-3 text-xs text-ink/45">{g.members.map(m => m.name).join(', ')}</p>
              <div className="flex flex-wrap gap-2">
                {g.ownerId === data.me.id && (
                  <button onClick={() => { setEditing(g.id); setGroupName(g.name); setMembers(g.members.filter(m => m.id !== data.me.id).map(m => m.id)) }} className={btnGhost}>Quản lý</button>
                )}
                <details className="inline">
                  <summary className="cursor-pointer text-xs font-semibold text-red-600 underline underline-offset-3 list-none">
                    {g.ownerId === data.me.id ? 'Giải tán nhóm' : 'Rời nhóm'}
                  </summary>
                  <p className="mt-2 mb-2 text-xs text-ink/40">Quyền chia sẻ qua nhóm sẽ bị thu hồi.</p>
                  <button onClick={() => void act('group-leave', { id: g.id })} className={btnDanger}>Xác nhận</button>
                </details>
              </div>
            </Card>
          ))}
        </>
      )}

    </div>
  )
}
