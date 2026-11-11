import type { AdminAuditEntry, AdminSummary, AdminUser, SubscriptionPlanId, UserRole, UserStatus } from '../../server/admin/types'
import type { ModerationReport } from '../../server/social/social-service'
import { apiFetch } from './api-client'

const request=async<T>(path:string,init:RequestInit={}):Promise<T>=>{
  const response=await apiFetch('/api/admin'+path,init)
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error((data as {message?:string}).message??'Không thể tải dữ liệu quản trị.')
  return data as T
}

export type ModerationDecision={status:'resolved'|'dismissed';note?:string;hidePosts?:boolean;suspend?:boolean}

export const adminApi={
  summary:()=>request<AdminSummary>('/summary',{cache:'no-store'}),
  users:(filters:{q?:string;role?:UserRole|'';status?:UserStatus|''})=>{
    const params=new URLSearchParams()
    if(filters.q)params.set('q',filters.q)
    if(filters.role)params.set('role',filters.role)
    if(filters.status)params.set('status',filters.status)
    return request<AdminUser[]>('/users?'+params.toString(),{cache:'no-store'})
  },
  updateUser:(id:string,changes:{role?:UserRole;status?:UserStatus;creditBalance?:number;subscriptionPlan?:SubscriptionPlanId})=>request<AdminUser>('/users/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)}),
  audit:()=>request<AdminAuditEntry[]>('/audit',{cache:'no-store'}),
  moderationReports:()=>request<{items:ModerationReport[]}>('/moderation/reports',{cache:'no-store'}).then(result=>result.items),
  resolveModerationReport:async(id:string,decision:ModerationDecision)=>{
    const response=await apiFetch('/api/admin/moderation/reports/'+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(decision)})
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error((data as {message?:string}).message??'Không thể xử lý báo cáo.')}
  },
}
