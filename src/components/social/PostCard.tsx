import { MoreHorizontal, Trash2 } from 'lucide-react'
import type { SocialPost } from '../../../server/social/types'
import { Avatar } from './Avatar'

const privacyName = { private:'Chỉ mình tôi', friends:'Bạn bè', groups:'Nhóm', public:'Công khai' }

export function PostCard({ post, me, onZoom, onDelete }: { post:SocialPost; me:string; onZoom:(src:string)=>void; onDelete?:(id:string)=>void }) {
  return <article className="mb-5 overflow-hidden rounded-[24px] border border-black/[0.07] bg-white shadow-sm">
    <header className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <Avatar name={post.owner.name} src={post.owner.avatar} className="size-10"/>
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-bold">{post.owner.name}</h2><p className="text-[11px] text-ink/45">{privacyName[post.visibility]} · {new Date(post.createdAt).toLocaleString('vi-VN')}</p></div>
      {post.owner.id===me&&<button onClick={()=>onDelete?.(post.id)} className="grid size-9 place-items-center rounded-full text-ink/40 hover:bg-red-50 hover:text-red-600" aria-label="Xoá bài đăng"><Trash2 size={17}/></button>}
      {post.owner.id!==me&&<MoreHorizontal size={18} className="text-ink/30"/>}
    </header>
    <div className={`grid gap-0.5 bg-black/[0.04] ${post.imageUrls.length>1?'grid-cols-2':'grid-cols-1'}`}>{post.imageUrls.map((src,index)=><button key={src} onClick={()=>onZoom(src)} className="min-w-0 bg-sage-50"><img src={src} alt={`Outfit ${index+1} của ${post.owner.name}`} loading="lazy" decoding="async" className={`w-full object-contain ${post.imageUrls.length===1?'max-h-[680px]':'h-72 sm:h-96'}`}/></button>)}</div>
    {post.caption&&<p className="px-4 py-4 text-sm leading-6 sm:px-5"><b>{post.owner.username}</b>{' '}{post.caption}</p>}
  </article>
}
