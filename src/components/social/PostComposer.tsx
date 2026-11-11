import { useEffect, useMemo, useState } from 'react'
import { BarChart3, ImagePlus, Loader2, Lock, Send, Users, X } from 'lucide-react'
import type { SocialSnapshot, SocialVisibility } from '../../../server/social/types'
import { socialApi } from '../../services/social-api'

type Props = { data: SocialSnapshot; onPublished: (snapshot: SocialSnapshot) => void; onCancel: () => void; initialVisibility?: SocialVisibility }

export function PostComposer({ data, onPublished, onCancel, initialVisibility = 'friends' }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [kind, setKind] = useState<'post'|'poll'>('post')
  const [visibility, setVisibility] = useState<SocialVisibility>(initialVisibility)
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [caption, setCaption] = useState('')
  const [hours, setHours] = useState(24)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previews = useMemo(() => files.map(file => URL.createObjectURL(file)), [files])
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews])

  const chooseFiles = (list: FileList | null) => {
    const next = Array.from(list ?? []).filter(file => file.type.startsWith('image/')).slice(0, 3)
    setFiles(next)
    setError('')
  }
  const setPostKind = (next: 'post'|'poll') => {
    setKind(next)
    if (next === 'poll' && visibility === 'private') setVisibility('friends')
  }
  const submit = async () => {
    if (!files.length || (kind === 'poll' && files.length < 2)) { setError(kind === 'poll' ? 'Bình chọn cần 2–3 ảnh.' : 'Hãy chọn ít nhất một ảnh.'); return }
    if (visibility === 'groups' && !groupIds.length) { setError('Hãy chọn ít nhất một nhóm.'); return }
    const recipientIds = visibility === 'groups'
      ? [...new Set(data.groups.filter(group => groupIds.includes(group.id)).flatMap(group => group.members.map(member => member.id)).filter(id => id !== data.me.id))]
      : data.friends.map(friend => friend.id)
    if (kind === 'poll' && visibility !== 'public' && !recipientIds.length) { setError('Bạn cần có bạn bè hoặc thành viên nhóm để tạo bình chọn.'); return }
    setBusy(true); setError('')
    try {
      const form = new FormData()
      files.forEach(file => form.append('images', file))
      form.set('kind', kind)
      form.set(kind === 'poll' ? 'title' : 'caption', caption)
      form.set('visibility', visibility)
      form.set('groupIds', JSON.stringify(groupIds))
      form.set('recipientIds', JSON.stringify(recipientIds))
      form.set('hours', String(hours))
      onPublished(await socialApi.publish(form))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đăng outfit.') }
    finally { setBusy(false) }
  }

  return <section className="mb-6 rounded-[26px] border border-black/[0.08] bg-white p-4 shadow-sm sm:p-6" aria-label="Tải outfit">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-display text-xl font-bold">Tải outfit</h2>
      <button type="button" onClick={onCancel} className="grid size-9 place-items-center rounded-full bg-black/[0.05]" aria-label="Đóng"><X size={18}/></button>
    </div>
    <label className="grid min-h-44 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-black/10 bg-sage-50/60 p-3 text-center transition hover:border-sage-500">
      <input className="sr-only" type="file" accept="image/*" multiple onChange={event => chooseFiles(event.target.files)}/>
      {previews.length ? <span className={`grid w-full gap-2 ${previews.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>{previews.map((src,index)=><img key={src} src={src} alt={`Ảnh outfit ${index+1}`} className="h-48 w-full rounded-xl object-contain"/>)}</span> : <span><ImagePlus className="mx-auto mb-2 text-sage-700"/><b className="block text-sm">Chọn 1–3 ảnh outfit</b></span>}
    </label>
    <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-black/[0.04] p-1">
      <button type="button" onClick={()=>setPostKind('post')} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${kind==='post'?'bg-white shadow-sm':'text-ink/50'}`}><ImagePlus size={16}/>Đăng ảnh</button>
      <button type="button" onClick={()=>setPostKind('poll')} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${kind==='poll'?'bg-white shadow-sm':'text-ink/50'}`}><BarChart3 size={16}/>Tạo bình chọn</button>
    </div>
    <label className="mt-4 block text-xs font-semibold text-ink/60">{kind==='poll'?'Câu hỏi':'Nội dung'}
      <textarea value={caption} onChange={event=>setCaption(event.target.value)} maxLength={kind==='poll'?120:500} rows={2} placeholder={kind==='poll'?'Mình nên chọn bộ nào?':'Viết vài dòng về outfit…'} className="mt-1 w-full resize-none rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sage-400"/>
    </label>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-ink/60">Quyền riêng tư
        <select value={visibility} onChange={event=>setVisibility(event.target.value as SocialVisibility)} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink">
          {kind==='post'&&<option value="private">Chỉ mình tôi</option>}
          <option value="friends">Bạn bè</option><option value="groups">Nhóm đã chọn</option><option value="public">Công khai</option>
        </select>
      </label>
      {kind==='poll'&&<label className="text-xs font-semibold text-ink/60">Thời hạn
        <select value={hours} onChange={event=>setHours(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm"><option value={1}>1 giờ</option><option value={24}>24 giờ</option><option value={72}>3 ngày</option></select>
      </label>}
    </div>
    {visibility==='groups'&&<div className="mt-3 flex flex-wrap gap-2">{data.groups.map(group=><label key={group.id} className="flex cursor-pointer items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-semibold"><input type="checkbox" checked={groupIds.includes(group.id)} onChange={()=>setGroupIds(current=>current.includes(group.id)?current.filter(id=>id!==group.id):[...current,group.id])}/>{group.name}</label>)}</div>}
    {error&&<p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}
    <button type="button" disabled={busy} onClick={()=>void submit()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#15251f] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy?<Loader2 className="animate-spin" size={18}/>:visibility==='private'?<Lock size={17}/>:visibility==='friends'?<Users size={17}/>:<Send size={17}/>} {busy?'Đang tải…':kind==='poll'?'Đăng bình chọn':'Đăng outfit'}</button>
  </section>
}
