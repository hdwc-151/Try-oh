import { ArrowLeft, Loader2, Plus, Sparkles, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SocialSnapshot } from '../../server/social/types'
import type { AppView } from '../navigation'
import { socialApi } from '../services/social-api'
import type { AuthUser } from '../types/auth'
import { ImageLightbox } from './ImageLightbox'
import { Avatar } from './social/Avatar'
import { PostCard } from './social/PostCard'
import { PostComposer } from './social/PostComposer'
import { PollCard } from './social/Voting'

export function KocStudioPage({ user, onNavigate }: { user: AuthUser; onNavigate: (view: AppView) => void }) {
  const isCreator = user.role === 'koc' || user.role === 'admin'
  const [data, setData] = useState<SocialSnapshot | null>(null)
  const [error, setError] = useState('')
  const [compose, setCompose] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  const [busyId, setBusyId] = useState('')
  useEffect(() => { let active=true;socialApi.snapshot().then(value=>{if(active)setData(value)}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Không thể tải KOL/KOC.')});return()=>{active=false} }, [])
  const act = async (action:string, body:Record<string,unknown>, busyKey='') => { setBusyId(busyKey);setError('');try{setData(await socialApi.act(action,body));return true}catch(cause){setError(cause instanceof Error?cause.message:'Thao tác thất bại.');return false}finally{setBusyId('')} }
  const creatorPosts = data?.creatorFeed.filter(post=>post.owner.id===user.id) ?? []
  const creatorPolls = data?.polls.filter(poll=>poll.owner.id===user.id || (poll.owner.creator && data.followingIds.includes(poll.owner.id))) ?? []
  const followers = data?.creators.find(item=>item.person.id===user.id)?.followerCount ?? 0

  return <main className="mx-auto w-full max-w-[1120px] px-3 py-5 sm:px-6 sm:py-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><button onClick={()=>onNavigate('feed')} className="grid size-10 place-items-center rounded-full border border-black/10 bg-white" aria-label="Quay lại"><ArrowLeft size={18}/></button><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-sage-700">Fitsy creator</p><h1 className="font-display text-2xl font-bold sm:text-3xl">{isCreator?'Không gian KOL/KOC':'KOL/KOC bạn theo dõi'}</h1></div></div>
      {isCreator&&<button onClick={()=>setCompose(current=>!current)} className="flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white"><Plus size={16}/>Tải outfit</button>}
    </header>
    {error&&<p role="alert" className="mb-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {!data?<div className="grid min-h-64 place-items-center text-ink/40"><Loader2 className="animate-spin"/></div>:<>
      {isCreator&&<>
        <section className="mb-6 grid grid-cols-2 gap-3"><div className="rounded-3xl bg-[#15251f] p-5 text-white"><Users className="mb-5 text-sage-300"/><b className="text-3xl">{followers}</b><p className="text-xs text-white/55">Người theo dõi</p></div><div className="rounded-3xl bg-sage-100 p-5"><Sparkles className="mb-5 text-sage-700"/><b className="text-3xl">{creatorPosts.length}</b><p className="text-xs text-ink/55">Bài đã đăng</p></div></section>
        {compose&&<PostComposer data={data} initialVisibility="public" onPublished={snapshot=>{setData(snapshot);setCompose(false)}} onCancel={()=>setCompose(false)}/>}
      </>}
      {!isCreator&&<section className="mb-6 overflow-x-auto pb-2"><div className="flex min-w-max gap-3">{data.creators.length?data.creators.map(item=><article key={item.person.id} className="w-56 rounded-3xl border border-black/[0.07] bg-white p-4"><Avatar name={item.person.name} src={item.person.avatar} className="size-12"/><h2 className="mt-3 truncate font-bold">{item.person.name}</h2><p className="truncate text-xs text-ink/45">@{item.person.username} · {item.followerCount} theo dõi</p><button disabled={busyId===item.person.id} onClick={()=>void act(item.following?'unfollow':'follow',{targetId:item.person.id},item.person.id)} className={`mt-4 w-full rounded-full px-3 py-2 text-xs font-bold ${item.following?'border border-black/10 bg-white':'bg-ink text-white'}`}>{item.following?'Đang theo dõi':'Theo dõi'}</button></article>):<p className="text-sm text-ink/45">Chưa có tài khoản KOL/KOC nào.</p>}</div></section>}
      <section>
        <h2 className="mb-4 font-display text-xl font-bold">{isCreator?'Bài đăng của bạn':'Bài mới từ KOL/KOC'}</h2>
        {(isCreator?creatorPosts:data.creatorFeed).length?(isCreator?creatorPosts:data.creatorFeed).map(post=><PostCard key={post.id} post={post} me={data.me.id} onZoom={setZoom} onDelete={id=>void act('post-delete',{id})}/>):<div className="rounded-3xl border border-dashed border-black/10 bg-white/60 p-10 text-center text-sm text-ink/45">{isCreator?'Tải outfit đầu tiên để bắt đầu.':'Theo dõi KOL/KOC để xem ảnh mới tại đây.'}</div>}
        {creatorPolls.map(poll=><PollCard key={poll.id} poll={poll} me={data.me.id} act={act} onZoom={setZoom}/>)}
      </section>
    </>}
    <ImageLightbox open={Boolean(zoom)} src={zoom??''} alt="Outfit KOL/KOC" onClose={()=>setZoom(null)}/>
  </main>
}
