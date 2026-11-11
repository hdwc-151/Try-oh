import { randomUUID } from 'node:crypto'
import type { PublicUser } from '../auth/auth-store.js'
import { AuthError } from '../auth/auth-service.js'
import type { AdminRepository } from './admin-repository.js'
import type { AdminAuditEntry, AdminUser, UserRole, UserStatus } from './types.js'
import { MAX_MANUAL_CREDITS } from '../credits/types.js'
import { SUBSCRIPTION_PLANS, isSubscriptionPlanId } from '../plans/catalog.js'
import type { SocialService } from '../social/social-service.js'

const roles:UserRole[]=['user','koc','moderator','admin']
const statuses:UserStatus[]=['active','suspended']

type CachedUser={fingerprint:string;user:PublicUser;expiresAt:number}

export class AdminService{
  private readonly bootstrapAdmins:Set<string>
  // Short-lived cache of the database view of each authenticated user. Every API and
  // image request resolves the user, so this removes one query per request. Role and
  // suspension changes made on another instance take effect within the TTL.
  private readonly cache=new Map<string,CachedUser>()
  constructor(private readonly repository:AdminRepository,adminEmails:string[],private readonly cacheTtlMs=30_000){
    this.bootstrapAdmins=new Set(adminEmails.map(email=>email.trim().toLowerCase()).filter(Boolean))
  }
  async resolveAuthenticatedUser(user:PublicUser):Promise<PublicUser>{
    const fingerprint=`${user.email}|${user.displayName}|${user.role}|${user.hasPassword ?? ''}`
    const cached=this.cache.get(user.id)
    if(cached&&cached.fingerprint===fingerprint&&cached.expiresAt>Date.now()){
      if(cached.user.status==='suspended')throw new AuthError(403,'Tài khoản đã bị tạm khoá. Vui lòng liên hệ quản trị viên.')
      return cached.user
    }
    // app_metadata is controlled by the trusted Supabase side. Email alone must never
    // elevate a newly registered account, especially when email confirmation is disabled.
    const trustedBootstrap=user.role==='admin'&&this.bootstrapAdmins.has(user.email.toLowerCase())
    const resolved=await this.repository.syncUser(user,trustedBootstrap)
    const result:PublicUser={id:resolved.id,email:resolved.email,displayName:resolved.displayName,createdAt:resolved.createdAt,role:resolved.role,status:resolved.status,...(user.hasPassword===undefined?{}:{hasPassword:user.hasPassword})}
    if(this.cacheTtlMs>0){
      if(this.cache.size>=20_000)this.cache.delete(this.cache.keys().next().value as string)
      this.cache.delete(user.id)
      this.cache.set(user.id,{fingerprint,user:result,expiresAt:Date.now()+this.cacheTtlMs})
    }
    if(resolved.status==='suspended')throw new AuthError(403,'Tài khoản đã bị tạm khoá. Vui lòng liên hệ quản trị viên.')
    return result
  }
  /** Drops the cached view of a user after a change made through this instance. */
  invalidateUser(userId:string){this.cache.delete(userId)}
  private canRead(user:PublicUser){if(user.role!=='admin'&&user.role!=='moderator')throw new AuthError(403,'Bạn không có quyền truy cập khu vực quản trị.')}
  private requireAdmin(user:PublicUser){if(user.role!=='admin')throw new AuthError(403,'Chỉ quản trị viên được thực hiện thao tác này.')}
  async summary(actor:PublicUser){this.canRead(actor);return this.repository.summary()}
  async users(actor:PublicUser,query:{search?:string;role?:string;status?:string}){
    this.canRead(actor)
    const role=query.role&&roles.includes(query.role as UserRole)?query.role as UserRole:undefined
    const status=query.status&&statuses.includes(query.status as UserStatus)?query.status as UserStatus:undefined
    return this.repository.listUsers({search:query.search?.trim().slice(0,100),role,status})
  }
  async audit(actor:PublicUser){this.requireAdmin(actor);return this.repository.listAudit(100)}
  async updateUser(actor:PublicUser,targetId:string,input:{role?:unknown;status?:unknown;creditBalance?:unknown;subscriptionPlan?:unknown}):Promise<AdminUser>{
    this.requireAdmin(actor)
    const role=input.role===undefined?undefined:roles.includes(input.role as UserRole)?input.role as UserRole:null
    const status=input.status===undefined?undefined:statuses.includes(input.status as UserStatus)?input.status as UserStatus:null
    const creditBalance=input.creditBalance===undefined?undefined:typeof input.creditBalance==='number'&&Number.isSafeInteger(input.creditBalance)&&input.creditBalance>=0&&input.creditBalance<=MAX_MANUAL_CREDITS?input.creditBalance:null
    const subscriptionPlan=input.subscriptionPlan===undefined?undefined:isSubscriptionPlanId(input.subscriptionPlan)?input.subscriptionPlan:null
    if(actor.id===targetId&&(role!==undefined||status!==undefined))throw new AuthError(400,'Không thể tự thay đổi quyền hoặc trạng thái của chính mình.')
    if(role===null||status===null||creditBalance===null||subscriptionPlan===null||(role===undefined&&status===undefined&&creditBalance===undefined&&subscriptionPlan===undefined))throw new AuthError(400,'Thay đổi người dùng không hợp lệ.')
    const before=await this.repository.getUser(targetId)
    if(!before)throw new AuthError(404,'Không tìm thấy người dùng.')
    if(creditBalance!==undefined&&before.role==='admin')throw new AuthError(400,'Tài khoản admin có lượt tạo ảnh không giới hạn.')
    if(before.role==='admin'&&(role&&role!=='admin'||status==='suspended')&&await this.repository.countAdmins()<=1)throw new AuthError(409,'Hệ thống phải còn ít nhất một quản trị viên đang hoạt động.')
    const planCredits=subscriptionPlan===undefined?undefined:SUBSCRIPTION_PLANS[subscriptionPlan].entitlements.imageCredits
    const updated=await this.repository.updateUser(targetId,{role:role??undefined,status:status??undefined,creditBalance:creditBalance??planCredits,subscriptionPlan:subscriptionPlan??undefined},actor.id)
    if(!updated)throw new AuthError(404,'Không tìm thấy người dùng.')
    this.invalidateUser(targetId)
    const now=new Date().toISOString()
    const entries:AdminAuditEntry[]=[]
    if(role&&role!==before.role)entries.push({id:randomUUID(),actorId:actor.id,actorEmail:actor.email,action:'user.role_changed',targetId,details:{from:before.role,to:role},createdAt:now})
    if(status&&status!==before.status)entries.push({id:randomUUID(),actorId:actor.id,actorEmail:actor.email,action:'user.status_changed',targetId,details:{from:before.status,to:status},createdAt:now})
    if(creditBalance!==undefined&&creditBalance!==before.creditBalance)entries.push({id:randomUUID(),actorId:actor.id,actorEmail:actor.email,action:'user.credits_changed',targetId,details:{from:String(before.creditBalance),to:String(creditBalance)},createdAt:now})
    if(subscriptionPlan!==undefined&&subscriptionPlan!==before.subscriptionPlan)entries.push({id:randomUUID(),actorId:actor.id,actorEmail:actor.email,action:'user.plan_changed',targetId,details:{from:before.subscriptionPlan,to:subscriptionPlan},createdAt:now})
    for(const entry of entries)await this.repository.addAudit(entry)
    return updated
  }
  /**
   * Resolves or dismisses a user report, optionally hiding the reported user's posts
   * (moderators and admins) or suspending the account (admins only). Every step is
   * written to the audit log.
   */
  async moderate(actor:PublicUser,social:Pick<SocialService,'moderationReports'|'resolveModerationReport'|'hideUserPosts'>,reportId:string,input:{status?:unknown;note?:unknown;hidePosts?:unknown;suspend?:unknown}){
    this.canRead(actor)
    const status=input.status===undefined?'resolved':input.status==='resolved'||input.status==='dismissed'?input.status:null
    if(!status)throw new AuthError(400,'Trạng thái xử lý không hợp lệ.')
    const note=typeof input.note==='string'?input.note.trim().slice(0,500):undefined
    const hidePosts=input.hidePosts===true
    const suspend=input.suspend===true
    if(status==='dismissed'&&(hidePosts||suspend))throw new AuthError(400,'Báo cáo bị bỏ qua không thể kèm biện pháp xử lý.')
    if(suspend)this.requireAdmin(actor)
    const report=(await social.moderationReports()).find(item=>item.id===reportId)
    if(!report)throw new AuthError(404,'Báo cáo không còn tồn tại.')
    const now=new Date().toISOString()
    const audit=(action:AdminAuditEntry['action'],details:Record<string,string>)=>this.repository.addAudit({id:randomUUID(),actorId:actor.id,actorEmail:actor.email,action,targetId:report.target,details,createdAt:now})
    if(hidePosts){
      if(!social.hideUserPosts)throw new AuthError(501,'Chưa hỗ trợ ẩn bài đăng.')
      const hidden=await social.hideUserPosts(report.target)
      await audit('user.posts_hidden',{from:'visible',to:`hidden (${hidden})`,reportId})
    }
    if(suspend)await this.updateUser(actor,report.target,{status:'suspended'})
    const resolved=await social.resolveModerationReport(reportId,{status,note,actorId:actor.id})
    if(!resolved)throw new AuthError(404,'Báo cáo không còn tồn tại.')
    await audit(status==='dismissed'?'report.dismissed':'report.resolved',{from:'open',to:status,reportId,...(note?{note}:{})})
  }
  close(){return this.repository.close()}
}
