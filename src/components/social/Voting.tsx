import { useState } from 'react'
import { Check, Clock, ChevronRight, Trophy, Users, Send, X, Plus } from 'lucide-react'
import type { SharedOutfit, SocialPoll, SocialSnapshot } from '../../../server/social/types'
import { Avatar } from './Avatar'
import type { Act } from './SocialPage'

const btnBase = 'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition'
const btnPrimary = `${btnBase} bg-[#16171b] text-white hover:bg-black shadow-sm`
const btnGhost = `${btnBase} border border-black/[0.09] bg-white/70 text-ink/60 hover:bg-white hover:text-ink`
const btnSuccess = `${btnBase} border border-sage-300 bg-sage-50 text-sage-800 hover:bg-sage-100`

export function PollComposer({ data, outfits, act, onDone, onCreateOutfit }: { data: SocialSnapshot; outfits: SharedOutfit[]; act: Act; onDone: () => void; onCreateOutfit: () => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [hours, setHours] = useState(24)
  const [title, setTitle] = useState('')
  const [review, setReview] = useState(false)
  const recipients = data.friends.filter(f => people.includes(f.id))

  return (
    <div className="mb-6 rounded-[22px] border border-black/[0.07] bg-white/80 p-5 shadow-sm backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">Hỏi những người hiểu gu của bạn</h2>
        <button onClick={onDone} className="grid size-7 place-items-center rounded-full text-ink/35 hover:bg-black/[0.06] transition" aria-label="Đóng">
          <X size={15} />
        </button>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-ink/45">Chọn 1–3 outfit. Người nhận thấy tên và lựa chọn của nhau sau khi bỏ phiếu.</p>

      {review ? (
        <div className="space-y-3">
          <div className="rounded-2xl bg-sage-50 border border-sage-200 p-4 text-sm">
            <h3 className="font-bold text-ink mb-1">{title || 'Mình nên chọn bộ nào?'}</h3>
            <p className="text-xs text-ink/50">{selected.length} outfit · {hours} giờ</p>
            <p className="mt-2 text-xs"><span className="font-semibold text-ink">Chỉ những người này được xem: </span>{recipients.map(p => p.name).join(', ')}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void act('poll-create', { outfitIds: selected, recipientIds: recipients.map(p => p.id), title, hours }).then(ok => { if (ok) onDone() })} className={btnPrimary}>
              <Send size={13} /> Gửi bình chọn
            </button>
            <button className={btnGhost} onClick={() => setReview(false)}>Sửa lại</button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-ink/50 mb-1">Câu hỏi</label>
            <input value={title} maxLength={120} placeholder="Mình nên chọn bộ nào?" onChange={e => setTitle(e.target.value)} className="w-full rounded-xl border border-black/[0.09] bg-white px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-sage-400 placeholder:text-ink/25" />
          </div>

          {/* Outfit grid */}
          <div>
            <label className="block text-xs font-medium text-ink/50 mb-2">Chọn outfit (tối đa 3)</label>
            {outfits.length === 0 ? (
              <button onClick={onCreateOutfit} className={`${btnGhost} w-full justify-center py-6 border-dashed`}>
                <Plus size={14} /> Tạo outfit mới trong Phòng thử
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {outfits.map((o, i) => {
                  const checked = selected.includes(o.id)
                  const disabled = !checked && selected.length >= 3
                  return (
                    <label
                      key={o.id}
                      aria-disabled={disabled || undefined}
                      className={`group relative overflow-hidden rounded-2xl border-2 transition-all duration-200 ${
                        checked
                          ? 'cursor-pointer border-sage-700 bg-sage-50 shadow-[0_10px_24px_rgba(55,88,65,0.16)] ring-4 ring-sage-200/80'
                          : disabled
                            ? 'cursor-not-allowed border-black/[0.05] bg-black/[0.025] opacity-45'
                            : 'cursor-pointer border-black/[0.08] bg-sage-50/40 hover:-translate-y-0.5 hover:border-sage-400 hover:shadow-md'
                      }`}
                    >
                      <input type="checkbox" aria-label={`Outfit ${i + 1}`} checked={checked} disabled={disabled} className="sr-only" onChange={() => setSelected(checked ? selected.filter(id => id !== o.id) : [...selected, o.id])} />
                      <img
                        src={o.frontImageUrl}
                        alt={`Outfit ${i + 1}`}
                        loading="lazy"
                        decoding="async"
                        className={`h-40 w-full object-contain transition-transform duration-200 ${checked ? 'scale-[0.97]' : 'group-hover:scale-[1.02]'}`}
                      />
                      {checked && (
                        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-sage-800 px-2.5 py-1 text-[10px] font-bold text-white shadow-lg ring-2 ring-white/90">
                          <Check size={12} strokeWidth={3} />
                          Đã chọn
                        </span>
                      )}
                      <p className={`border-t py-2 text-center text-[11px] font-bold transition-colors ${checked ? 'border-sage-700 bg-sage-800 text-white' : 'border-black/[0.05] text-ink/50'}`}>
                        Outfit {i + 1}{checked ? ' · Đang chọn' : ''}
                      </p>
                    </label>
                  )
                })}
              </div>
            )}
            {outfits.length > 0 && (
              <button className={`mt-2 ${btnGhost} text-[10px]`} onClick={onCreateOutfit}><Plus size={11} /> Thêm outfit mới</button>
            )}
          </div>

          {/* Recipients */}
          <div>
            <h3 className="text-xs font-medium text-ink/50 mb-2">Người nhận</h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <button className={btnGhost} onClick={() => setPeople(data.friends.map(f => f.id))}>Tất cả bạn bè</button>
              <button className={btnGhost} onClick={() => setPeople([])}>Bỏ chọn</button>
              {data.groups.length > 0 && (
                <select defaultValue="" onChange={e => { const group = data.groups.find(g => g.id === e.target.value); if (group) setPeople(group.members.filter(m => data.friends.some(f => f.id === m.id)).map(m => m.id)) }} className="rounded-full border border-black/[0.09] bg-white px-3 py-1.5 text-xs font-semibold text-ink/60 outline-none">
                  <option value="">Chọn nhóm…</option>
                  {data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              )}
            </div>
            <div className="flex flex-col gap-0.5 max-h-40 overflow-auto">
              {data.friends.length === 0
                ? <p className="text-xs text-ink/40">Bạn cần <a href="/ban-be" className="font-semibold underline underline-offset-3">kết bạn</a> trước khi gửi.</p>
                : data.friends.map(f => (
                    <label key={f.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-sage-50 transition">
                      <input type="checkbox" checked={people.includes(f.id)} onChange={() => setPeople(people.includes(f.id) ? people.filter(id => id !== f.id) : [...people, f.id])} className="accent-sage-700" />
                      <Avatar name={f.name} src={f.avatar} className="size-7 text-[9px]" />
                      <span className="text-sm font-medium text-ink">{f.name}</span>
                    </label>
                  ))
              }
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-ink/35">
              Ai được xem: {recipients.map(p => p.name).join(', ') || 'chưa chọn'}
            </p>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-xs font-medium text-ink/50 mb-1">Thời hạn</label>
            <select value={hours} onChange={e => setHours(Number(e.target.value))} className="rounded-xl border border-black/[0.09] bg-white px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-sage-400">
              <option value={1}>1 giờ</option>
              <option value={24}>24 giờ</option>
              <option value={72}>72 giờ</option>
            </select>
          </div>

          <button disabled={!selected.length || !recipients.length} onClick={() => setReview(true)} className={btnPrimary}>
            <ChevronRight size={14} /> Xem lại người nhận
          </button>
        </div>
      )}
    </div>
  )
}

export function PollCard({ poll, me, act, onZoom }: { poll: SocialPoll; me: string; act: Act; onZoom: (url: string) => void }) {
  const owner = poll.owner.id === me
  const show = owner || !!poll.myVote || poll.closed
  const total = poll.votes.length
  const maximum = Math.max(0, ...poll.outfits.map(o => poll.votes.filter(v => v.outfitId === o.id).length))
  const remaining = Math.max(0, Math.ceil((poll.expiresAt - Date.now()) / 60000))

  const remainingText = remaining >= 60
    ? `${Math.floor(remaining / 60)} giờ ${remaining % 60} phút`
    : `${remaining} phút`
  const status = poll.closed
    ? 'Đã kết thúc'
    : owner
      ? 'Đang bình chọn'
      : poll.myVote
        ? 'Đã bình chọn'
        : 'Chờ bạn chọn'

  return (
    <article id={`poll-${poll.id}`} className="social-poll mb-6 overflow-hidden rounded-[26px] border border-black/[0.07] bg-white/85 shadow-[0_14px_36px_rgba(40,54,47,0.06)] backdrop-blur-sm">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-black/[0.055] px-5 py-4 sm:px-6">
        <Avatar name={poll.owner.name} src={poll.owner.avatar} className="size-11 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{poll.owner.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink/40">
            <Clock size={11} />
            {poll.closed ? 'Bình chọn đã đóng' : `Còn ${remainingText}`}
            <span aria-hidden="true">·</span>
            {total} lượt chọn
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold ${
          poll.closed ? 'bg-black/[0.055] text-ink/55' : poll.myVote ? 'bg-sage-100 text-sage-700' : owner ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-600'
        }`}>
          {status}
        </span>
      </header>

      <div className="px-5 pb-6 pt-5 sm:px-6">
        <h2 className="mb-4 font-display text-lg font-bold leading-snug text-ink sm:text-xl">{poll.title}</h2>

        {/* Vote strip */}
        <div className="social-vote-strip">
          {poll.outfits.map((o, i) => {
          const voters = poll.votes.filter(v => v.outfitId === o.id)
          const percent = total ? Math.round(voters.length / total * 100) : 0
          const isWinner = poll.winnerId === o.id
          const isSelected = poll.myVote === o.id

            return (
              <section key={o.id} className={`social-vote-option min-w-0 rounded-[20px] border p-3 transition ${isSelected ? 'border-sage-500 bg-sage-50/60 ring-2 ring-sage-200/60' : 'border-black/[0.07] bg-[#fafaf7]'}`}>
              {/* Images */}
              <div className="social-image-pair mb-3 rounded-xl overflow-hidden">
                <button className="flex-1 border-0 bg-transparent p-0" onClick={() => onZoom(o.frontImageUrl)}>
                  <img src={o.frontImageUrl} alt={`Outfit ${i + 1} mặt trước`} loading="lazy" decoding="async" className="h-52 w-full object-contain bg-[#f1f0eb] rounded-xl hover:opacity-90 transition" />
                </button>
                {o.backImageUrl && (
                  <button className="flex-1 border-0 bg-transparent p-0" onClick={() => onZoom(o.backImageUrl!)}>
                    <img src={o.backImageUrl} alt={`Outfit ${i + 1} mặt sau`} loading="lazy" decoding="async" className="h-52 w-full object-contain bg-[#f1f0eb] rounded-xl hover:opacity-90 transition" />
                  </button>
                )}
              </div>

              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-bold text-ink">Phương án {i + 1}</h3>
                {isWinner && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"><Trophy size={9} /> Chính thức</span>}
              </div>

              {!owner && !poll.closed && (
                <button
                  aria-pressed={isSelected}
                  onClick={() => void act('vote', { id: poll.id, outfitId: o.id })}
                  className={isSelected ? btnSuccess : btnGhost}
                >
                  {isSelected ? '✓ Đang chọn' : 'Chọn bộ này'}
                </button>
              )}

              {show && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs font-semibold text-ink/60">
                    <span>{percent}%</span>
                    <span>{voters.length} phiếu</span>
                  </div>
                  <progress value={voters.length} max={Math.max(total, 1)} aria-label={`Kết quả phương án ${i + 1}`} className="w-full accent-sage-600 h-1.5 rounded-full" />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {voters.map(v => (
                      <span key={v.user.id} title={v.user.username} className="flex items-center gap-1 rounded-full border border-black/[0.06] bg-white px-2 py-0.5 text-[10px] text-ink/60">
                        <Avatar name={v.user.name} src={v.user.avatar} className="size-4 text-[6px]" /> {v.user.name}
                      </span>
                    ))}
                  </div>
                  {owner && poll.closed && maximum > 0 && voters.length === maximum && (
                    <button className={`mt-2 ${btnSuccess}`} onClick={() => void act('poll-winner', { id: poll.id, outfitId: o.id })}>
                      <Trophy size={11} /> Lưu làm outfit chính thức
                    </button>
                  )}
                </div>
              )}
              </section>
            )
          })}
        </div>

        {!show && (
          <p className="mt-3 text-center text-xs text-ink/40">Chọn một bộ để xem kết quả. Bạn có thể đổi lựa chọn trước khi hết hạn.</p>
        )}

        <footer className="mt-5 flex flex-col gap-2 border-t border-black/[0.055] pt-4 sm:flex-row sm:items-start sm:justify-between">
          <details className="text-xs">
            <summary className="cursor-pointer list-none font-semibold text-ink/45 transition hover:text-ink">
              <span className="flex items-center gap-1.5"><Users size={12} /> {poll.recipients.length} người được xem</span>
            </summary>
            <p className="mt-2 max-w-xl leading-relaxed text-ink/40">{poll.recipients.map(p => p.name).join(', ')}</p>
          </details>

          {owner && (
            <details className="text-xs sm:text-right">
              <summary className="cursor-pointer list-none font-semibold text-ink/45 transition hover:text-ink">Quản lý</summary>
              <div className="mt-2 flex flex-wrap gap-2 sm:justify-end">
                {!poll.closed && (
                  <button onClick={() => void act('poll-close', { id: poll.id })} className={btnGhost}>Đóng bình chọn</button>
                )}
                <button className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100" onClick={() => void act('poll-delete', { id: poll.id })}>
                  Xoá bình chọn
                </button>
              </div>
            </details>
          )}
        </footer>
      </div>
    </article>
  )
}
