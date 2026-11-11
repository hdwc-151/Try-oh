import { Activity, ArrowLeft, Ban, CheckCircle2, Coins, Crown, Download, EyeOff, Flag, Loader2, Save, Search, ShieldCheck, UserCog, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { AdminAuditEntry, AdminSummary, AdminUser, SubscriptionPlanId, UserRole, UserStatus } from '../../../server/admin/types'
import type { ModerationReport } from '../../../server/social/social-service'
import type { AppView } from '../../navigation'
import { adminApi, type ModerationDecision } from '../../services/admin-api'
import type { AuthUser } from '../../types/auth'

type AdminTab='overview'|'users'|'moderation'|'audit'
const roleLabels:Record<UserRole,string>={user:'Người dùng',koc:'KOC',moderator:'Kiểm duyệt',admin:'Quản trị'}
const planLabels:Record<SubscriptionPlanId,string>={free:'Free',plus:'Plus',pro:'Pro',max:'Max'}

export function AdminPage({user,onNavigate}:{user:AuthUser;onNavigate:(view:AppView)=>void}){
  const authorized=user.role==='admin'||user.role==='moderator'
  const [tab,setTab]=useState<AdminTab>('overview')
  const [summary,setSummary]=useState<AdminSummary|null>(null)
  const [users,setUsers]=useState<AdminUser[]>([])
  const [audit,setAudit]=useState<AdminAuditEntry[]>([])
  const [reports,setReports]=useState<ModerationReport[]>([])
  const [query,setQuery]=useState('')
  const [role,setRole]=useState<UserRole|''>('')
  const [status,setStatus]=useState<UserStatus|''>('')
  const [loading,setLoading]=useState(true)
  const [busyId,setBusyId]=useState('')
  const [error,setError]=useState('')

  const refresh=useCallback(async()=>{
    setLoading(true);setError('')
    try{
      const [nextSummary,nextUsers,nextReports,nextAudit]=await Promise.all([
        adminApi.summary(),
        adminApi.users({q:query.trim(),role,status}),
        adminApi.moderationReports(),
        user.role==='admin'?adminApi.audit():Promise.resolve([]),
      ])
      setSummary(nextSummary);setUsers(nextUsers);setReports(nextReports);setAudit(nextAudit)
    }catch(cause){setError(cause instanceof Error?cause.message:'Không thể tải trang quản trị.')}
    finally{setLoading(false)}
  },[query,role,status,user.role])

  useEffect(()=>{if(!authorized){setLoading(false);return}const timer=window.setTimeout(()=>void refresh(),query?300:0);return()=>window.clearTimeout(timer)},[authorized,refresh,query])

  const update=async(target:AdminUser,changes:{role?:UserRole;status?:UserStatus;creditBalance?:number;subscriptionPlan?:SubscriptionPlanId})=>{
    setBusyId(target.id);setError('')
    try{await adminApi.updateUser(target.id,changes);await refresh()}
    catch(cause){setError(cause instanceof Error?cause.message:'Không thể cập nhật người dùng.')}
    finally{setBusyId('')}
  }

  const resolveReport=async(id:string,decision:ModerationDecision)=>{
    setBusyId(id);setError('')
    try{await adminApi.resolveModerationReport(id,decision);setReports(current=>current.filter(report=>report.id!==id))}
    catch(cause){setError(cause instanceof Error?cause.message:'Không thể xử lý báo cáo.')}
    finally{setBusyId('')}
  }

  if(!authorized)return <AccessDenied onBack={()=>onNavigate('feed')}/>

  return(
    <main className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <section className="overflow-hidden rounded-[30px] bg-[linear-gradient(135deg,#17211d,#2f4937)] p-6 text-white shadow-xl sm:p-8">
        <button onClick={()=>onNavigate('profile')} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-xs font-semibold text-white/75 hover:bg-white/15"><ArrowLeft size={14}/>Về tài khoản</button>
        <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200"><ShieldCheck size={14}/>Khu vực được bảo vệ</div><h1 className="mt-2 font-display text-3xl font-bold">Quản trị Fitsy</h1><p className="mt-2 text-sm text-white/55">Người dùng, phân quyền và lịch sử thay đổi hệ thống.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3"><p className="text-[10px] uppercase tracking-wider text-white/45">Đang đăng nhập</p><p className="mt-1 text-sm font-bold">{user.email}</p><p className="text-[10px] text-emerald-200">{roleLabels[user.role]}</p></div>
        </div>
      </section>

      <nav className="mt-5 flex gap-2 overflow-x-auto rounded-[22px] border border-black/[0.06] bg-panel p-2 shadow-sm" aria-label="Quản trị">
        {([{id:'overview',label:'Tổng quan',icon:Activity},{id:'users',label:'Người dùng',icon:Users},{id:'moderation',label:`Báo cáo${reports.length?` (${reports.length})`:''}`,icon:Flag},...(user.role==='admin'?[{id:'audit',label:'Audit log',icon:ShieldCheck}]:[])] as Array<{id:AdminTab;label:string;icon:typeof Users}>).map(item=>{const Icon=item.icon;return <button key={item.id} onClick={()=>setTab(item.id)} className={`inline-flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-bold transition ${tab===item.id?'bg-ink text-white shadow':'text-ink/50 hover:bg-black/[0.04]'}`}><Icon size={15}/>{item.label}</button>})}
      </nav>

      {error&&<div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading&&!summary?<div className="grid min-h-64 place-items-center text-ink/35"><Loader2 className="animate-spin"/></div>:(
        <div key={tab} className="app-page-transition mt-5">
          {tab==='overview'&&summary&&<Overview summary={summary} onUsers={()=>setTab('users')} canExportPayments={user.role==='admin'}/>}
          {tab==='users'&&<UsersPanel currentUser={user} users={users} query={query} role={role} status={status} busyId={busyId} onQuery={setQuery} onRole={setRole} onStatus={setStatus} onUpdate={update}/>}
          {tab==='moderation'&&<ModerationPanel reports={reports} busyId={busyId} canSuspend={user.role==='admin'} onResolve={resolveReport}/>}
          {tab==='audit'&&user.role==='admin'&&<AuditPanel entries={audit}/>}
        </div>
      )}
    </main>
  )
}

function ModerationPanel({reports,busyId,canSuspend,onResolve}:{reports:ModerationReport[];busyId:string;canSuspend:boolean;onResolve:(id:string,decision:ModerationDecision)=>void}){
  return <section className="rounded-[28px] border border-black/[0.06] bg-panel p-5 shadow-sm sm:p-6"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sage-700">Nội dung cộng đồng</p><h2 className="mt-1 font-display text-xl font-bold text-ink">Báo cáo chờ xử lý</h2><div className="mt-5 space-y-3">{reports.length===0?<p className="rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-ink/40">Không có báo cáo nào đang chờ.</p>:reports.map(report=><article key={report.id} className="rounded-2xl border border-black/[0.06] bg-white/70 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-start"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-700"><Flag size={16}/></span><div className="min-w-0 flex-1"><p className="text-sm font-bold text-ink">{report.targetName||'Người dùng bị báo cáo'}</p><p className="mt-1 text-xs text-ink/45">Người báo cáo: {report.fromName||report.from}</p><p className="mt-3 whitespace-pre-wrap rounded-xl bg-black/[0.025] p-3 text-sm text-ink/70">{report.reason}</p><p className="mt-2 text-[10px] text-ink/30">{new Date(report.createdAt).toLocaleString('vi-VN')} · ID đối tượng: {report.target}</p></div><div className="flex shrink-0 flex-wrap gap-2 sm:flex-col"><button type="button" disabled={busyId===report.id} onClick={()=>onResolve(report.id,{status:'resolved'})} className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{busyId===report.id?<Loader2 size={13} className="animate-spin"/>:<CheckCircle2 size={13}/>}Đã xử lý</button><button type="button" disabled={busyId===report.id} onClick={()=>onResolve(report.id,{status:'resolved',hidePosts:true})} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-xs font-bold text-red-700 disabled:opacity-50"><EyeOff size={13}/>Ẩn bài đăng</button>{canSuspend&&<button type="button" disabled={busyId===report.id} onClick={()=>onResolve(report.id,{status:'resolved',suspend:true})} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Ban size={13}/>Khoá tài khoản</button>}<button type="button" disabled={busyId===report.id} onClick={()=>onResolve(report.id,{status:'dismissed'})} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-ink/50 hover:bg-black/[0.04] disabled:opacity-50">Bỏ qua</button></div></div></article>)}</div></section>
}

function Overview({summary,onUsers,canExportPayments}:{summary:AdminSummary;onUsers:()=>void;canExportPayments:boolean}){
  const cards=[['Tổng người dùng',summary.users,Users],['Đang hoạt động',summary.activeUsers,CheckCircle2],['Tài khoản KOC',summary.kocUsers,Crown],['Đang bị khoá',summary.suspendedUsers,Ban]] as const
  return <div className="space-y-5"><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value,Icon])=><article key={label} className="rounded-[24px] border border-black/[0.06] bg-panel p-5 shadow-sm"><span className="grid size-10 place-items-center rounded-2xl bg-sage-100 text-sage-700"><Icon size={18}/></span><p className="mt-5 text-3xl font-bold text-ink">{value}</p><p className="mt-1 text-xs font-semibold text-ink/45">{label}</p></article>)}</section><section className="rounded-[28px] border border-black/[0.06] bg-panel p-6 shadow-sm"><h2 className="font-display text-xl font-bold text-ink">Phân quyền hiện tại</h2><div className="mt-5 grid gap-3 sm:grid-cols-3"><Stat label="Quản trị viên" value={summary.admins}/><Stat label="Kiểm duyệt viên" value={summary.moderators}/><Stat label="KOC" value={summary.kocUsers}/></div><div className="mt-5 flex flex-wrap gap-2"><button onClick={onUsers} className="rounded-full bg-ink px-5 py-2.5 text-xs font-bold text-white">Quản lý người dùng</button>{canExportPayments&&<a href="/api/billing/ledger.xlsx" download className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-2.5 text-xs font-bold text-ink hover:bg-black/[0.03]"><Download size={14}/>Tải sổ giao dịch Excel</a>}</div></section></div>
}
function Stat({label,value}:{label:string;value:number}){return <div className="rounded-2xl bg-black/[0.025] p-4"><p className="text-xl font-bold text-ink">{value}</p><p className="mt-1 text-xs text-ink/40">{label}</p></div>}

function UsersPanel({currentUser,users,query,role,status,busyId,onQuery,onRole,onStatus,onUpdate}:{currentUser:AuthUser;users:AdminUser[];query:string;role:UserRole|'';status:UserStatus|'';busyId:string;onQuery:(value:string)=>void;onRole:(value:UserRole|'')=>void;onStatus:(value:UserStatus|'')=>void;onUpdate:(user:AdminUser,changes:{role?:UserRole;status?:UserStatus;creditBalance?:number;subscriptionPlan?:SubscriptionPlanId})=>void}){
  return <section className="rounded-[28px] border border-black/[0.06] bg-panel p-5 shadow-sm sm:p-6"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sage-700">Tài khoản</p><h2 className="mt-1 font-display text-xl font-bold text-ink">Quản lý người dùng</h2></div><div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]"><label className="relative"><span className="sr-only">Tìm người dùng</span><Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/30"/><input value={query} onChange={event=>onQuery(event.target.value)} placeholder="Tên hoặc email…" className="w-full rounded-2xl border border-black/10 bg-white py-2.5 pl-10 pr-3 text-sm text-ink outline-none focus:ring-2 focus:ring-sage-400"/></label><select aria-label="Lọc role" value={role} onChange={event=>onRole(event.target.value as UserRole|'')} className="rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink"><option value="">Tất cả role</option>{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select aria-label="Lọc trạng thái" value={status} onChange={event=>onStatus(event.target.value as UserStatus|'')} className="rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm text-ink"><option value="">Tất cả trạng thái</option><option value="active">Đang hoạt động</option><option value="suspended">Đã khoá</option></select></div>
    <div className="mt-5 space-y-3">{users.length===0?<p className="rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-ink/40">Không tìm thấy người dùng.</p>:users.map(target=><article key={target.id} className="flex flex-col gap-4 rounded-2xl border border-black/[0.06] bg-white/70 p-4 xl:flex-row xl:items-center"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-sage-100 font-bold text-sage-800">{target.displayName.slice(0,1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{target.displayName}{target.id===currentUser.id&&<span className="ml-2 text-[9px] text-sage-700">(Bạn)</span>}</p><p className="truncate text-xs text-ink/40">{target.email}</p><p className="mt-1 text-[10px] text-ink/30">Hoạt động: {target.lastSeenAt?new Date(target.lastSeenAt).toLocaleString('vi-VN'):'Chưa ghi nhận'}</p></div><select aria-label={`Gói của ${target.email}`} value={target.subscriptionPlan} disabled={currentUser.role!=='admin'||target.role==='admin'||busyId===target.id} onChange={event=>onUpdate(target,{subscriptionPlan:event.target.value as SubscriptionPlanId})} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-bold text-ink disabled:opacity-50">{Object.entries(planLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><CreditEditor target={target} disabled={currentUser.role!=='admin'||busyId===target.id} onSave={creditBalance=>onUpdate(target,{creditBalance})}/><div className="flex flex-wrap gap-2"><select aria-label={`Role của ${target.email}`} value={target.role} disabled={currentUser.role!=='admin'||target.id===currentUser.id||busyId===target.id} onChange={event=>onUpdate(target,{role:event.target.value as UserRole})} className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs text-ink disabled:opacity-50">{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button disabled={currentUser.role!=='admin'||target.id===currentUser.id||busyId===target.id} onClick={()=>onUpdate(target,{status:target.status==='active'?'suspended':'active'})} className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40 ${target.status==='active'?'bg-red-50 text-red-700':'bg-emerald-50 text-emerald-700'}`}>{busyId===target.id?<Loader2 size={13} className="animate-spin"/>:target.status==='active'?<Ban size={13}/>:<CheckCircle2 size={13}/>} {target.status==='active'?'Khoá':'Mở khoá'}</button></div></article>)}</div>
  </section>
}

function CreditEditor({target,disabled,onSave}:{target:AdminUser;disabled:boolean;onSave:(value:number)=>void}){
  const [value,setValue]=useState(String(target.creditBalance))
  useEffect(()=>setValue(String(target.creditBalance)),[target.creditBalance])
  if(target.role==='admin')return <div className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800"><Coins size={14}/>Không giới hạn</div>
  const parsed=Number(value)
  const valid=Number.isSafeInteger(parsed)&&parsed>=0&&parsed<=1_000_000
  return <div className="flex items-center gap-1.5 rounded-xl border border-black/[0.07] bg-white p-1.5"><Coins size={14} className="ml-1 text-amber-600"/><label><span className="sr-only">Credit của {target.email}</span><input type="number" min="0" max="1000000" step="1" value={value} disabled={disabled} onChange={event=>setValue(event.target.value)} className="w-16 bg-transparent px-1 text-center text-xs font-bold text-ink outline-none disabled:opacity-50"/></label><button type="button" aria-label={`Lưu credit của ${target.email}`} disabled={disabled||!valid||parsed===target.creditBalance} onClick={()=>onSave(parsed)} className="grid size-7 place-items-center rounded-lg bg-ink text-white transition hover:bg-black disabled:bg-black/10 disabled:text-ink/25"><Save size={12}/></button></div>
}

const auditLabels:Record<AdminAuditEntry['action'],string>={'user.role_changed':'Thay đổi role','user.status_changed':'Thay đổi trạng thái','user.credits_changed':'Thay đổi credit','user.plan_changed':'Thay đổi gói','user.posts_hidden':'Ẩn bài đăng','report.resolved':'Xử lý báo cáo','report.dismissed':'Bỏ qua báo cáo'}
function AuditPanel({entries}:{entries:AdminAuditEntry[]}){return <section className="rounded-[28px] border border-black/[0.06] bg-panel p-5 shadow-sm sm:p-6"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sage-700">Bảo mật</p><h2 className="mt-1 font-display text-xl font-bold text-ink">Lịch sử thao tác</h2><div className="mt-5 space-y-2">{entries.length===0?<p className="rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-ink/40">Chưa có thay đổi quản trị.</p>:entries.map(entry=><article key={entry.id} className="flex gap-3 rounded-2xl bg-black/[0.025] p-4"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sage-100 text-sage-700"><UserCog size={15}/></span><div className="min-w-0"><p className="text-xs font-bold text-ink">{auditLabels[entry.action]}</p><p className="mt-1 text-xs text-ink/45">{entry.actorEmail} · {entry.details.from} → {entry.details.to}</p><p className="mt-1 text-[10px] text-ink/30">Đối tượng {entry.targetId} · {new Date(entry.createdAt).toLocaleString('vi-VN')}</p></div></article>)}</div></section>}
function AccessDenied({onBack}:{onBack:()=>void}){return <main className="grid min-h-[70vh] place-items-center p-6"><div className="max-w-md rounded-[28px] border border-black/[0.06] bg-panel p-8 text-center shadow-soft"><ShieldCheck size={34} className="mx-auto text-ink/20"/><h1 className="mt-4 text-xl font-bold text-ink">Không có quyền truy cập</h1><p className="mt-2 text-sm text-ink/45">Tài khoản này không thuộc nhóm quản trị hoặc kiểm duyệt.</p><button onClick={onBack} className="mt-6 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white">Về trang chủ</button></div></main>}
