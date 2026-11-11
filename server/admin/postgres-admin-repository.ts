import type { PublicUser } from '../auth/auth-store.js'
import { withTransaction, type PostgresPool } from '../storage/postgres.js'
import type { AdminRepository } from './admin-repository.js'
import type { AdminAuditEntry, AdminSummary, AdminUser, SubscriptionPlanId, UserRole, UserStatus } from './types.js'

type UserRow={id:string;email:string;display_name:string;role:UserRole;status:UserStatus;credit_balance:number;subscription_plan:SubscriptionPlanId;created_at:Date|string;last_seen_at:Date|string|null}
const fromRow=(row:UserRow):AdminUser=>({id:row.id,email:row.email,displayName:row.display_name,role:row.role,status:row.status,creditBalance:row.credit_balance,subscriptionPlan:row.subscription_plan,createdAt:new Date(row.created_at).toISOString(),lastSeenAt:row.last_seen_at?new Date(row.last_seen_at).toISOString():null})

export class PostgresAdminRepository implements AdminRepository{
  constructor(private readonly pool:PostgresPool){}
  async syncUser(user:PublicUser,bootstrapAdmin:boolean):Promise<AdminUser>{const result=await this.pool.query<UserRow>(`WITH synced AS (
    INSERT INTO profiles(id,email,display_name,created_at,role,status,last_seen_at)
    VALUES($1,$2,$3,$4,$5,'active',now())
    -- email and display_name of an existing profile are kept in sync by the
    -- auth.users trigger (migration 001). They are not copied from the access
    -- token here: a token issued before a rename still carries the old name for
    -- up to an hour and would keep writing it back over the new one.
    ON CONFLICT(id) DO UPDATE SET
      last_seen_at=CASE WHEN profiles.last_seen_at IS NULL OR profiles.last_seen_at < now()-interval '10 minutes' THEN now() ELSE profiles.last_seen_at END,
      role=CASE WHEN $6 THEN 'admin' ELSE profiles.role END
    WHERE profiles.last_seen_at IS NULL
       OR profiles.last_seen_at < now()-interval '10 minutes'
       OR ($6 AND profiles.role <> 'admin')
    RETURNING id,email,display_name,role,status,credit_balance,subscription_plan,created_at,last_seen_at
  )
  SELECT * FROM synced
  UNION ALL
  SELECT id,email,display_name,role,status,credit_balance,subscription_plan,created_at,last_seen_at FROM profiles
  WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM synced)
  LIMIT 1`,[user.id,user.email,user.displayName,user.createdAt,bootstrapAdmin?'admin':user.role,bootstrapAdmin]);return fromRow(result.rows[0]!)}
  async listUsers(query:{search?:string;role?:UserRole;status?:UserStatus}):Promise<AdminUser[]>{const values:string[]=[],clauses:string[]=[];if(query.search){values.push('%'+query.search.toLowerCase()+'%');clauses.push('(lower(email) LIKE $'+values.length+' OR lower(display_name) LIKE $'+values.length+')')}if(query.role){values.push(query.role);clauses.push('role=$'+values.length)}if(query.status){values.push(query.status);clauses.push('status=$'+values.length)}const sql='SELECT id,email,display_name,role,status,credit_balance,subscription_plan,created_at,last_seen_at FROM profiles '+(clauses.length?'WHERE '+clauses.join(' AND '):'')+' ORDER BY created_at DESC LIMIT 200';const result=await this.pool.query<UserRow>(sql,values);return result.rows.map(fromRow)}
  async getUser(id:string):Promise<AdminUser|null>{const result=await this.pool.query<UserRow>('SELECT id,email,display_name,role,status,credit_balance,subscription_plan,created_at,last_seen_at FROM profiles WHERE id=$1',[id]);return result.rows[0]?fromRow(result.rows[0]):null}
  async updateUser(id:string,changes:{role?:UserRole;status?:UserStatus;creditBalance?:number;subscriptionPlan?:SubscriptionPlanId},actorId?:string):Promise<AdminUser|null>{
    // Credit changes are recorded as a ledger delta in the same transaction, so the
    // balance is never silently overwritten without an auditable entry.
    return withTransaction(this.pool,async client=>{
      const before=await client.query<{credit_balance:number}>('SELECT credit_balance FROM profiles WHERE id=$1 FOR UPDATE',[id])
      if(!before.rows[0])return null
      const result=await client.query<UserRow>('UPDATE profiles SET role=COALESCE($2,role),status=COALESCE($3,status),credit_balance=COALESCE($4,credit_balance),subscription_plan=COALESCE($5,subscription_plan),subscription_expires_at=CASE WHEN $5::text IS NULL THEN subscription_expires_at ELSE NULL END WHERE id=$1 RETURNING id,email,display_name,role,status,credit_balance,subscription_plan,created_at,last_seen_at',[id,changes.role??null,changes.status??null,changes.creditBalance??null,changes.subscriptionPlan??null])
      const row=result.rows[0]
      if(!row)return null
      const delta=row.credit_balance-before.rows[0].credit_balance
      if(delta!==0)await client.query("INSERT INTO credit_ledger(user_id,delta,balance_after,event_type,actor_id) VALUES($1,$2,$3,'admin_adjustment',$4)",[id,delta,row.credit_balance,actorId??null])
      return fromRow(row)
    })
  }
  async countAdmins():Promise<number>{const result=await this.pool.query<{count:string}>("SELECT count(*)::text AS count FROM profiles WHERE role='admin' AND status='active'");return Number(result.rows[0]?.count??0)}
  async summary():Promise<AdminSummary>{const result=await this.pool.query<{role:UserRole;status:UserStatus;count:string}>('SELECT role,status,count(*)::text AS count FROM profiles GROUP BY role,status');const count=(fn:(row:typeof result.rows[number])=>boolean)=>result.rows.filter(fn).reduce((sum,row)=>sum+Number(row.count),0);return{users:count(()=>true),activeUsers:count(row=>row.status==='active'),suspendedUsers:count(row=>row.status==='suspended'),kocUsers:count(row=>row.role==='koc'),moderators:count(row=>row.role==='moderator'),admins:count(row=>row.role==='admin')}}
  async addAudit(entry:AdminAuditEntry):Promise<void>{await this.pool.query('INSERT INTO admin_audit_logs(id,actor_id,actor_email,action,target_id,details,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[entry.id,entry.actorId,entry.actorEmail,entry.action,entry.targetId,JSON.stringify(entry.details),entry.createdAt])}
  async listAudit(limit:number):Promise<AdminAuditEntry[]>{const result=await this.pool.query<{id:string;actor_id:string;actor_email:string;action:AdminAuditEntry['action'];target_id:string;details:Record<string,string>;created_at:Date|string}>('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT $1',[limit]);return result.rows.map(row=>({id:row.id,actorId:row.actor_id,actorEmail:row.actor_email,action:row.action,targetId:row.target_id,details:row.details,createdAt:new Date(row.created_at).toISOString()}))}
  async close():Promise<void>{}
}
