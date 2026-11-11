import Database from 'better-sqlite3'
import type { PublicUser } from '../auth/auth-store.js'
import type { AdminRepository } from './admin-repository.js'
import type { AdminAuditEntry, AdminSummary, AdminUser, SubscriptionPlanId, UserRole, UserStatus } from './types.js'

type UserRow = { id:string;email:string;display_name:string;role:string;status:string;credit_balance:number;subscription_plan:SubscriptionPlanId;created_at:string;last_seen_at:string|null }
type AuditRow = { id:string;actor_id:string;actor_email:string;action:AdminAuditEntry['action'];target_id:string;details:string;created_at:string }
const fromUserRow=(row:UserRow):AdminUser=>({id:row.id,email:row.email,displayName:row.display_name,role:row.role as UserRole,status:row.status as UserStatus,creditBalance:row.credit_balance,subscriptionPlan:row.subscription_plan,createdAt:row.created_at,lastSeenAt:row.last_seen_at})

export class SqliteAdminRepository implements AdminRepository {
  private readonly database:Database.Database
  constructor(databasePath:string){
    this.database=new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    const columns=this.database.pragma('table_info(users)') as Array<{name:string}>
    if(!columns.some(column=>column.name==='role'))this.database.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    if(!columns.some(column=>column.name==='status'))this.database.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    if(!columns.some(column=>column.name==='last_seen_at'))this.database.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT')
    if(!columns.some(column=>column.name==='credit_balance'))this.database.exec('ALTER TABLE users ADD COLUMN credit_balance INTEGER NOT NULL DEFAULT 10')
    if(!columns.some(column=>column.name==='subscription_plan'))this.database.exec("ALTER TABLE users ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'free'")
    if(!columns.some(column=>column.name==='subscription_expires_at'))this.database.exec('ALTER TABLE users ADD COLUMN subscription_expires_at TEXT')
    this.database.exec("CREATE TABLE IF NOT EXISTS admin_audit_logs (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,actor_email TEXT NOT NULL,action TEXT NOT NULL,target_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_logs(created_at DESC)")
  }
  syncUser(user:PublicUser,bootstrapAdmin:boolean):AdminUser{
    this.database.prepare("UPDATE users SET email=?,display_name=?,last_seen_at=?,role=CASE WHEN ?=1 THEN 'admin' ELSE role END WHERE id=?").run(user.email,user.displayName,new Date().toISOString(),bootstrapAdmin?1:0,user.id)
    const current=this.getUser(user.id);if(!current)throw new Error('Không thể đồng bộ người dùng admin.');return current
  }
  listUsers(query:{search?:string;role?:UserRole;status?:UserStatus}):AdminUser[]{
    const clauses:string[]=[],params:string[]=[]
    if(query.search){clauses.push('(lower(email) LIKE ? OR lower(display_name) LIKE ?)');const value='%'+query.search.toLowerCase()+'%';params.push(value,value)}
    if(query.role){clauses.push('role=?');params.push(query.role)}
    if(query.status){clauses.push('status=?');params.push(query.status)}
    const sql='SELECT id,email,display_name,role,status,credit_balance,subscription_plan,created_at,last_seen_at FROM users '+(clauses.length?'WHERE '+clauses.join(' AND '):'')+' ORDER BY created_at DESC LIMIT 200'
    return (this.database.prepare(sql).all(...params) as UserRow[]).map(fromUserRow)
  }
  getUser(id:string):AdminUser|null{const row=this.database.prepare('SELECT id,email,display_name,role,status,credit_balance,subscription_plan,created_at,last_seen_at FROM users WHERE id=?').get(id) as UserRow|undefined;return row?fromUserRow(row):null}
  updateUser(id:string,changes:{role?:UserRole;status?:UserStatus;creditBalance?:number;subscriptionPlan?:SubscriptionPlanId}):AdminUser|null{
    return this.database.transaction(()=>{
      const before=this.database.prepare('SELECT credit_balance FROM users WHERE id=?').get(id) as {credit_balance:number}|undefined
      if(!before)return null
      this.database.prepare('UPDATE users SET role=COALESCE(?,role),status=COALESCE(?,status),credit_balance=COALESCE(?,credit_balance),subscription_plan=COALESCE(?,subscription_plan),subscription_expires_at=CASE WHEN ? IS NULL THEN subscription_expires_at ELSE NULL END WHERE id=?').run(changes.role??null,changes.status??null,changes.creditBalance??null,changes.subscriptionPlan??null,changes.subscriptionPlan??null,id)
      const after=this.getUser(id)
      const delta=after?after.creditBalance-before.credit_balance:0
      if(after&&delta!==0){
        this.database.exec("CREATE TABLE IF NOT EXISTS credit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,delta INTEGER NOT NULL,balance_after INTEGER NOT NULL,event_type TEXT NOT NULL,payment_order_id TEXT,created_at TEXT NOT NULL)")
        this.database.prepare("INSERT INTO credit_ledger(user_id,delta,balance_after,event_type,created_at) VALUES(?,?,?,'admin_adjustment',?)").run(id,delta,after.creditBalance,new Date().toISOString())
      }
      return after
    })()
  }
  countAdmins():number{return (this.database.prepare("SELECT count(*) AS count FROM users WHERE role='admin' AND status='active'").get() as {count:number}).count}
  summary():AdminSummary{const rows=this.database.prepare('SELECT role,status,count(*) AS count FROM users GROUP BY role,status').all() as Array<{role:UserRole;status:UserStatus;count:number}>;const count=(fn:(row:typeof rows[number])=>boolean)=>rows.filter(fn).reduce((sum,row)=>sum+row.count,0);return{users:count(()=>true),activeUsers:count(row=>row.status==='active'),suspendedUsers:count(row=>row.status==='suspended'),kocUsers:count(row=>row.role==='koc'),moderators:count(row=>row.role==='moderator'),admins:count(row=>row.role==='admin')}}
  addAudit(entry:AdminAuditEntry):void{this.database.prepare('INSERT INTO admin_audit_logs VALUES (?,?,?,?,?,?,?)').run(entry.id,entry.actorId,entry.actorEmail,entry.action,entry.targetId,JSON.stringify(entry.details),entry.createdAt)}
  listAudit(limit:number):AdminAuditEntry[]{return(this.database.prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT ?').all(limit) as AuditRow[]).map(row=>({id:row.id,actorId:row.actor_id,actorEmail:row.actor_email,action:row.action,targetId:row.target_id,details:JSON.parse(row.details) as Record<string,string>,createdAt:row.created_at}))}
  close():void{this.database.close()}
}
