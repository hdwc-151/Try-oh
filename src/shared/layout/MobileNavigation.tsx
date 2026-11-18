import { BadgeDollarSign, Camera, Home, MessageSquare, Plus, Shirt, Sparkles, Users, X } from 'lucide-react'
import type { AppView } from '../../navigation'

export function MobileNavigation({ activeView, onNavigate, onQuickAction }: { activeView: AppView; onNavigate: (view: AppView) => void; onQuickAction: () => void }) {
  const items: Array<{ view: AppView; label: string; icon: typeof Home }> = [
    { view: 'feed', label: 'Trang chủ', icon: Home },
    { view: 'wardrobe', label: 'Tủ đồ', icon: Shirt },
    { view: 'fitting', label: 'Phòng thử', icon: Sparkles },
    { view: 'friends', label: 'Bạn bè', icon: Users },
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[70] border-t border-black/10 bg-panel/95 px-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-12px_35px_rgba(23,33,29,0.1)] backdrop-blur-xl lg:hidden" aria-label="Điều hướng di động">
      <div className="mx-auto grid max-w-md grid-cols-5 items-end">
        {items.slice(0, 2).map(item => <NavItem key={item.view} {...item} active={activeView === item.view} onClick={() => onNavigate(item.view)} />)}
        <button onClick={onQuickAction} className="-mt-7 mx-auto grid size-16 touch-manipulation place-items-center rounded-full border-4 border-canvas bg-ink text-white shadow-lg transition active:scale-95" aria-label="Tạo mới"><Plus size={25} /></button>
        {items.slice(2).map(item => <NavItem key={item.view} {...item} active={activeView === item.view} onClick={() => onNavigate(item.view)} />)}
      </div>
    </nav>
  )
}

function NavItem({ label, icon: Icon, active, onClick }: { label: string; icon: typeof Home; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`flex min-h-12 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1 text-[10px] font-semibold leading-tight transition active:scale-95 ${active ? 'text-sage-700' : 'text-ink/40'}`} aria-current={active ? 'page' : undefined}><Icon size={20} strokeWidth={active ? 2.5 : 1.8} /><span>{label}</span></button>
}

export function QuickActionSheet({ open, onClose, onUpload, onOutfit, onPoll, onKoc }: { open: boolean; onClose: () => void; onUpload: () => void; onOutfit: () => void; onPoll: () => void; onKoc: () => void }) {
  if (!open) return null
  const actions = [
    { title: 'Thêm món đồ', description: 'Chụp hoặc chọn ảnh trang phục', icon: Camera, action: onUpload },
    { title: 'Tạo outfit', description: 'Phối đồ trong phòng thử', icon: Sparkles, action: onOutfit },
    { title: 'Tải outfit', description: 'Đăng ảnh hoặc tạo bình chọn', icon: MessageSquare, action: onPoll },
    { title: 'KOL/KOC', description: 'Xem người sáng tạo bạn theo dõi', icon: BadgeDollarSign, action: onKoc },
  ]
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/35 p-0 backdrop-blur-sm sm:p-3 lg:items-center lg:justify-center" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Tạo mới" className="max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-[28px] bg-panel px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:max-w-md sm:rounded-[28px] sm:p-5" onClick={event => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sage-700">Tạo mới</p><h2 className="mt-1 font-display text-xl font-bold text-ink">Bạn muốn làm gì?</h2></div><button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-black/[0.05] text-ink/50"><X size={17} /></button></div>
        <div className="space-y-2">{actions.map(({ title, description, icon: Icon, action }) => <button key={title} onClick={() => { onClose(); action() }} className="flex w-full items-center gap-4 rounded-2xl border border-black/[0.06] bg-white/70 p-4 text-left transition hover:border-sage-300 hover:bg-sage-50"><span className="grid size-11 place-items-center rounded-2xl bg-sage-100 text-sage-700"><Icon size={19} /></span><span><span className="block text-sm font-bold text-ink">{title}</span><span className="mt-0.5 block text-xs text-ink/45">{description}</span></span></button>)}</div>
      </section>
    </div>
  )
}
