import Database from 'better-sqlite3'
import { randomBytes, randomUUID } from 'node:crypto'
import { AuthError } from '../auth/auth-service.js'
import type { SqliteUserDataRepository } from '../storage/sqlite-user-data-repository.js'
import type { SocialPerson, SocialProfile, SocialPoll, SocialSnapshot, OutfitPolicy, SocialPost, SocialVisibility } from './types.js'
import { prepareSocialSearch, socialSearchScore } from './search.js'

type Profile = Omit<SocialProfile, 'name'>
type RequestRow = { id: string; from: string; to: string; createdAt: number }
type Group = { id: string; ownerId: string; name: string; members: string[] }
type Poll = { id: string; ownerId: string; title: string; outfitIds: string[]; imageOptions?: { id: string; imageUrl: string }[]; visibility?: SocialVisibility; groupIds?: string[]; recipients: string[]; votes: Record<string, string>; createdAt: number; expiresAt: number; closed: boolean; winnerId: string | null; notified: boolean }
type Post = { id: string; ownerId: string; caption: string; imageUrls: string[]; visibility: SocialVisibility; groupIds: string[]; createdAt: number }
type Notice = { id: string; userId: string; actor: string; kind: 'request' | 'poll' | 'result'; targetId: string; read: boolean; createdAt: number }
type State = { profiles: Profile[]; friends: [string, string][]; requests: RequestRow[]; groups: Group[]; polls: Poll[]; posts: Post[]; follows: [string, string][]; blocks: [string, string][]; reports: { id: string; from: string; target: string; reason: string; createdAt: number }[]; notices: Notice[]; policies: (OutfitPolicy & { ownerId: string })[]; temporaryImages: { key: string; ownerId: string; createdAt?: number }[] }
const fresh = (): State => ({ profiles: [], friends: [], requests: [], groups: [], polls: [], posts: [], follows: [], blocks: [], reports: [], notices: [], policies: [], temporaryImages: [] })
const fail = (message: string, code = 400): never => { throw new AuthError(code, message) }
const str = (v: unknown, max = 120): string => typeof v === 'string' && v.trim().length <= max ? v.trim() : fail('Dữ liệu văn bản không hợp lệ.')
const ids = (v: unknown, max = 100): string[] => Array.isArray(v) && v.length <= max && v.every(x => typeof x === 'string' && x.length < 150) ? [...new Set(v as string[])] : fail('Danh sách không hợp lệ.')
const imageKeyFromUrl = (value: string): string | null => {
  if (!value.startsWith('/uploads/')) return null
  try { return decodeURIComponent(value.slice('/uploads/'.length)) } catch { return null }
}

/** Local SQLite implementation. All mutations use a transaction; no content or images in logs. */
export class SocialStore {
  private db: Database.Database
  constructor(databasePath: string, private outfits: SqliteUserDataRepository) {
    this.db = new Database(databasePath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec('CREATE TABLE IF NOT EXISTS social_state (id INTEGER PRIMARY KEY CHECK(id = 1), data TEXT NOT NULL)')
    this.db.prepare('INSERT OR IGNORE INTO social_state VALUES (1, ?)').run(JSON.stringify(fresh()))
  }
  close() { this.db.close() }
  private load(): State {
    const state = JSON.parse((this.db.prepare('SELECT data FROM social_state WHERE id = 1').get() as { data: string }).data) as State
    state.posts ??= []
    state.follows ??= []
    const now = Date.now()
    state.temporaryImages = (state.temporaryImages ?? [])
      .map(image => ({ ...image, createdAt: image.createdAt ?? now }))
      .filter(image => image.createdAt >= now - 24 * 60 * 60 * 1000)
    return state
  }
  private write(s: State) { this.db.prepare('UPDATE social_state SET data = ? WHERE id = 1').run(JSON.stringify(s)) }
  private change<T>(f: (s: State) => T): T { return this.db.transaction(() => { const s = this.load(); const result = f(s); this.write(s); return result })() }
  private users() { return this.db.prepare('SELECT id, display_name AS name, role FROM users').all() as { id: string; name: string; role: string }[] }
  private seed(s: State) {
    const users = this.users()
    this.removeDeletedUsers(s, new Set(users.map(user => user.id)))
    for (const u of users) if (!s.profiles.some(p => p.id === u.id)) s.profiles.push({ id: u.id, username: `user_${u.id.replace(/-/g, '')}`, avatar: '', birthDate: null, invitePolicy: 'known', inviteCode: randomBytes(24).toString('base64url'), defaultVisibility: 'private' })
    for (const profile of s.profiles) if (profile.defaultVisibility !== 'friends') profile.defaultVisibility = 'private'
  }
  private removeDeletedUsers(s: State, live: Set<string>) {
    const pairIsLive = ([first, second]: [string, string]) => live.has(first) && live.has(second)
    s.profiles = s.profiles.filter(profile => live.has(profile.id))
    s.friends = s.friends.filter(pairIsLive)
    s.requests = s.requests.filter(request => live.has(request.from) && live.has(request.to))
    s.groups = s.groups
      .filter(group => live.has(group.ownerId))
      .map(group => ({ ...group, members: [group.ownerId, ...group.members.filter(id => id !== group.ownerId && live.has(id))] }))
    s.polls = s.polls
      .filter(poll => live.has(poll.ownerId))
      .map(poll => ({
        ...poll,
        recipients: poll.recipients.filter(id => live.has(id)),
        votes: Object.fromEntries(Object.entries(poll.votes).filter(([id]) => live.has(id))),
      }))
    s.posts = s.posts.filter(post => live.has(post.ownerId))
    s.follows = s.follows.filter(pairIsLive)
    s.blocks = s.blocks.filter(pairIsLive)
    s.reports = s.reports.filter(report => live.has(report.from) && live.has(report.target))
    s.notices = s.notices.filter(notice => live.has(notice.userId) && live.has(notice.actor))
    s.policies = s.policies.filter(policy => live.has(policy.ownerId))
    s.temporaryImages = s.temporaryImages.filter(image => live.has(image.ownerId))
  }
  private person(s: State, id: string): SocialPerson {
    const p = s.profiles.find(p => p.id === id)
    const u = this.users().find(u => u.id === id)
    if (!p || !u) return fail('Không tìm thấy người dùng.', 404)
    return { id, username: p.username, avatar: p.avatar, name: u.name, creator: u.role === 'koc' || u.role === 'admin' }
  }
  private blocked(s: State, a: string, b: string) { return s.blocks.some(([x,y]) => (x === a && y === b) || (y === a && x === b)) }
  private friend(s: State, a: string, b: string) { return !this.blocked(s,a,b) && s.friends.some(([x,y]) => (x === a && y === b) || (y === a && x === b)) }
  private friends(s: State, id: string) { return s.profiles.filter(p => this.friend(s,id,p.id)).map(p => p.id) }
  private restricted(p: Profile) {
    if (!p.birthDate) return true
    const date = new Date(p.birthDate + 'T00:00:00Z'); const today = new Date()
    const age = today.getUTCFullYear() - date.getUTCFullYear() - (today.getUTCMonth() < date.getUTCMonth() || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate()) ? 1 : 0)
    return age < 18
  }
  private notice(s: State, userId: string, actor: string, kind: Notice['kind'], targetId: string) { s.notices.push({ id: randomUUID(), userId, actor, kind, targetId, read: false, createdAt: Date.now() }) }
  private activeRecipients(s: State, p: Poll) { return p.recipients.filter(id => !this.blocked(s,p.ownerId,id) && (this.friend(s,p.ownerId,id) || Boolean(p.imageOptions?.length && p.visibility === 'public' && s.follows.some(([follower,creator])=>follower===id&&creator===p.ownerId)))) }
  private visiblePoll(s: State, p: Poll, user: string) { return (p.ownerId === user || this.activeRecipients(s,p).includes(user)) && (p.imageOptions?.length ? true : p.outfitIds.every(id => this.outfits.listSavedOutfits(p.ownerId).some(o => o.id === id))) }
  private endExpired(s: State) {
    for (const p of s.polls) if (!p.notified && (p.closed || p.expiresAt <= Date.now())) {
      p.notified = true
      this.notice(s,p.ownerId,p.ownerId,'result',p.id)
      for (const id of this.activeRecipients(s,p)) this.notice(s,id,p.ownerId,'result',p.id)
    }
  }
  private poll(s: State, p: Poll, viewer: string): SocialPoll {
    const recipients = this.activeRecipients(s,p)
    const showVotes = viewer === p.ownerId || Boolean(p.votes[viewer]) || p.closed || p.expiresAt <= Date.now()
    return { id: p.id, owner: this.person(s,p.ownerId), title: p.title, createdAt:p.createdAt, expiresAt:p.expiresAt, closed:p.closed || p.expiresAt <= Date.now(),
      outfits: p.imageOptions?.map(option => ({ id:option.id,frontImageUrl:option.imageUrl,backImageUrl:null,official:false })) ?? this.outfits.listSavedOutfits(p.ownerId).filter(o => p.outfitIds.includes(o.id)).map(o => ({ id:o.id,frontImageUrl:o.frontImageUrl,backImageUrl:o.backImageUrl,official:s.policies.some(x => x.outfitId === o.id && x.official) })),
      recipients: recipients.filter(id => !this.blocked(s,viewer,id)).map(id => this.person(s,id)),
      votes: showVotes ? Object.entries(p.votes).filter(([id]) => recipients.includes(id) && !this.blocked(s,viewer,id)).map(([id,outfitId]) => ({ user:this.person(s,id),outfitId })) : [],
      myVote: p.votes[viewer] ?? null, winnerId:p.winnerId }
  }
  private visiblePost(s: State, post: Post, viewer: string) {
    if (post.ownerId === viewer) return true
    if (this.blocked(s, post.ownerId, viewer)) return false
    if (post.visibility === 'public') return true
    if (post.visibility === 'friends') return this.friend(s, post.ownerId, viewer)
    if (post.visibility === 'groups') return s.groups.some(group => post.groupIds.includes(group.id) && group.members.includes(post.ownerId) && group.members.includes(viewer))
    return false
  }
  private socialPost(s: State, post: Post): SocialPost {
    const owner = this.person(s, post.ownerId)
    return { id:post.id,owner,caption:post.caption,imageUrls:post.imageUrls,visibility:post.visibility,groupIds:post.groupIds,createdAt:post.createdAt,creator:Boolean(owner.creator) }
  }
  snapshot(user: string): SocialSnapshot {
    return this.change(s => {
      this.seed(s); this.endExpired(s)
      const me = s.profiles.find(p => p.id === user)!
      const requests = s.requests.filter(r => !this.blocked(s,r.from,r.to)).map(r => ({ ...r, from:this.person(s,r.from),to:this.person(s,r.to) }))
      return { me:{ ...me,...this.person(s,user) }, friends:this.friends(s,user).map(id => this.person(s,id)), incoming:requests.filter(r => r.to.id === user), outgoing:requests.filter(r => r.from.id === user),
        groups:s.groups.filter(g => g.members.includes(user)).map(g => ({ ...g,members:g.members.filter(id => !this.blocked(s,user,id)).map(id => this.person(s,id)) })),
        polls:s.polls.filter(p => this.visiblePoll(s,p,user)).map(p => this.poll(s,p,user)).sort((a,b) => Number(!a.closed && !a.myVote && a.owner.id !== user) > Number(!b.closed && !b.myVote && b.owner.id !== user) ? -1 : Number(!a.closed && !a.myVote && a.owner.id !== user) < Number(!b.closed && !b.myVote && b.owner.id !== user) ? 1 : b.createdAt-a.createdAt),
        blocked:s.blocks.filter(([a]) => a === user).map(([,b]) => this.person(s,b)),
        notifications:s.notices.filter(n => n.userId === user && !this.blocked(s,user,n.actor) && (n.kind === 'request' ? s.requests.some(r => r.id === n.targetId) : s.polls.some(p => p.id === n.targetId && this.visiblePoll(s,p,user)))).slice(-100).reverse().map(n => ({ id:n.id,kind:n.kind,targetId:n.targetId,read:n.read,createdAt:n.createdAt,text:n.kind === 'request' ? `${this.person(s,n.actor).name} gửi lời mời kết bạn` : n.kind === 'poll' ? `${this.person(s,n.actor).name} muốn xin ý kiến bạn` : 'Có kết quả bình chọn' })),
        policies:s.policies.filter(p => p.ownerId === user && this.outfits.listSavedOutfits(user).some(o => o.id === p.outfitId)),
        posts:s.posts.filter(post => !this.person(s,post.ownerId).creator && this.visiblePost(s,post,user)).map(post=>this.socialPost(s,post)).sort((a,b)=>b.createdAt-a.createdAt),
        creatorFeed:s.posts.filter(post => this.person(s,post.ownerId).creator && (post.ownerId===user || s.follows.some(([follower,creator])=>follower===user&&creator===post.ownerId)) && this.visiblePost(s,post,user)).map(post=>this.socialPost(s,post)).sort((a,b)=>b.createdAt-a.createdAt),
        creators:s.profiles.map(profile=>this.person(s,profile.id)).filter(person=>person.creator&&!this.blocked(s,user,person.id)).map(person=>({person,following:s.follows.some(([follower,creator])=>follower===user&&creator===person.id),followerCount:s.follows.filter(([,creator])=>creator===person.id).length})),
        followingIds:s.follows.filter(([follower])=>follower===user).map(([,creator])=>creator) }
    })
  }
  search(user: string, query: string) {
    const search = prepareSocialSearch(query)
    if (!search) return []
    return this.change(s => {
      this.seed(s)
      return s.profiles
        .filter(p => p.id !== user && !this.blocked(s,user,p.id))
        .map(p => {
          const person = this.person(s,p.id)
          return { person, score: socialSearchScore(person.username, person.name, search) }
        })
        .filter((result): result is { person: SocialPerson; score: number } => result.score !== null)
        .sort((a,b) => a.score-b.score || a.person.username.localeCompare(b.person.username, 'vi'))
        .slice(0,20)
        .map(result => result.person)
    })
  }
  resolveInvite(user: string, code: string) { const s = this.load(); const p = s.profiles.find(p => p.inviteCode === code && !this.blocked(s,user,p.id)); return p ? this.person(s,p.id) : fail('Mã mời không còn hiệu lực.',404) }
  private canViewOutfit(s: State, viewer: string, owner: string, outfitId: string) {
    if (viewer === owner) return true
    if (!this.friend(s,viewer,owner)) return false
    const policy = s.policies.find(p => p.ownerId === owner && p.outfitId === outfitId)
    const visibility = policy?.visibility ?? s.profiles.find(p => p.id === owner)?.defaultVisibility ?? 'private'
    if (visibility === 'friends') return true
    if (policy?.visibility === 'groups' && s.groups.some(g => policy.groupIds.includes(g.id) && g.members.includes(owner) && g.members.includes(viewer))) return true
    return s.polls.some(p => p.ownerId === owner && p.outfitIds.includes(outfitId) && p.recipients.includes(viewer) && this.visiblePoll(s,p,viewer))
  }
  profile(user: string, target: string) {
    const s = this.load()
    if (user !== target && !this.friend(s,user,target)) return fail('Hồ sơ không khả dụng.',404)
    return { person:this.person(s,target), outfits:this.outfits.listSavedOutfits(target).filter(o => this.canViewOutfit(s,user,target,o.id)).map(o => ({ id:o.id,frontImageUrl:o.frontImageUrl,backImageUrl:o.backImageUrl,official:s.policies.some(p => p.outfitId === o.id && p.official) })) }
  }
  trackTemporaryImage(user: string, key: string) { this.change(s => { s.temporaryImages=s.temporaryImages.filter(item=>item.key!==key);s.temporaryImages.push({ownerId:user,key,createdAt:Date.now()}) }) }
  private userImageKeys(s: State, user: string): string[] {
    const keys = new Set<string>()
    const addUrl = (url: string) => { const key = imageKeyFromUrl(url); if (key) keys.add(key) }
    const profile = s.profiles.find(item => item.id === user)
    if (profile?.avatar) addUrl(profile.avatar)
    for (const image of s.temporaryImages) if (image.ownerId === user) keys.add(image.key)
    for (const post of s.posts) if (post.ownerId === user) post.imageUrls.forEach(addUrl)
    for (const poll of s.polls) if (poll.ownerId === user) poll.imageOptions?.forEach(option => addUrl(option.imageUrl))
    return [...keys]
  }
  listUserImageKeys(user: string): string[] { return this.userImageKeys(this.load(), user) }
  deleteUserData(user: string): string[] {
    return this.change(s => {
      const keys = this.userImageKeys(s, user)
      const live = new Set(this.users().map(item => item.id).filter(id => id !== user))
      this.removeDeletedUsers(s, live)
      return keys
    })
  }
  moderationReports() {
    const state=this.load()
    const users=this.users()
    return [...state.reports].sort((a,b)=>b.createdAt-a.createdAt).map(report=>({
      ...report,
      fromName:users.find(user=>user.id===report.from)?.name,
      targetName:users.find(user=>user.id===report.target)?.name,
    }))
  }
  hideUserPosts(user: string): number { return this.change(s => { const before = s.posts.length; s.posts = s.posts.filter(post => post.ownerId !== user); return before - s.posts.length }) }
  resolveModerationReport(reportId: string) { return this.change(s=>{const before=s.reports.length;s.reports=s.reports.filter(report=>report.id!==reportId);return s.reports.length<before}) }
  canReadImage(user: string, key: string): boolean {
    const s = this.load()
    if (s.profiles.some(profile => imageKeyFromUrl(profile.avatar) === key)) return true
    if (s.temporaryImages.some(x => x.ownerId === user && x.key === key)) return true
    if (s.posts.some(post => post.imageUrls.some(url => imageKeyFromUrl(url) === key) && this.visiblePost(s,post,user))) return true
    if (s.polls.some(poll => poll.imageOptions?.some(option => imageKeyFromUrl(option.imageUrl) === key) && this.visiblePoll(s,poll,user))) return true
    const own = this.db.prepare(`SELECT 1 FROM garments WHERE user_id = ? AND (front_original_key = ? OR front_processed_key = ? OR back_original_key = ? OR back_processed_key = ?)`).get(user,key,key,key,key)
    if (own || this.outfits.getPersonImage(user)?.imageKey === key || this.outfits.listTryOnResults(user).some(o => o.imageKey === key)) return true
    for (const u of this.users()) for (const o of this.outfits.listSavedOutfits(u.id)) if ((o.frontImageKey === key || o.backImageKey === key) && this.canViewOutfit(s,user,u.id,o.id)) return true
    return false
  }
  private sever(s: State, a: string, b: string) {
    s.friends = s.friends.filter(([x,y]) => !((x === a && y === b) || (x === b && y === a)))
    s.requests = s.requests.filter(r => !((r.from === a && r.to === b) || (r.from === b && r.to === a)))
    for (const g of s.groups) { if(g.ownerId === a) g.members=g.members.filter(id=>id!==b); if(g.ownerId===b) g.members=g.members.filter(id=>id!==a) }
    for (const p of s.polls) { if(p.ownerId===a){p.recipients=p.recipients.filter(id=>id!==b);delete p.votes[b]} if(p.ownerId===b){p.recipients=p.recipients.filter(id=>id!==a);delete p.votes[a]} }
  }
  act(user: string, action: string, body: Record<string, unknown>) {
    this.change(s => {
      this.seed(s)
      const me = s.profiles.find(p => p.id === user)!
      const target = typeof body.targetId === 'string' ? body.targetId : ''
      if (action === 'settings') {
        const username = str(body.username,40).toLowerCase()
        if (!/^[a-z0-9_]{3,40}$/.test(username)) fail('Username cần 3–40 chữ thường, số hoặc dấu _.')
        if(s.profiles.some(p=>p.id!==user&&p.username===username)) fail('Username đã được sử dụng.',409)
        if (body.birthDate && !me.birthDate) { const d=str(body.birthDate,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d||Date.parse(d)>Date.now()||Date.parse(d)<Date.parse('1900-01-01')) fail('Ngày sinh không hợp lệ.'); me.birthDate=d }
        const policy = body.invitePolicy
        if(policy!=='everyone'&&policy!=='known'&&policy!=='code') fail('Quyền lời mời không hợp lệ.')
        me.username=username
        if (body.avatar !== undefined) {
          const avatar = str(body.avatar, 500)
          if (avatar && !avatar.startsWith('/uploads/')) fail('Ảnh đại diện không hợp lệ.')
          me.avatar = avatar
        }
        me.invitePolicy=policy as SocialProfile['invitePolicy']
        if (body.defaultVisibility !== undefined) {
          if (body.defaultVisibility !== 'private' && body.defaultVisibility !== 'friends') fail('Quyền xem mặc định không hợp lệ.')
          me.defaultVisibility = body.defaultVisibility as SocialProfile['defaultVisibility']
        }
        if(this.restricted(me)&&me.invitePolicy==='everyone') me.invitePolicy='known'
      } else if(action==='rotate-invite') { me.inviteCode=randomBytes(24).toString('base64url')
      } else if(action==='request') {
        const other=s.profiles.find(p=>p.id===target); if(!other||target===user||this.blocked(s,user,target)) fail('Không thể gửi lời mời.')
        if(this.friend(s,user,target)) fail('Hai bạn đã kết bạn.')
        if(s.requests.some(r=>(r.from===user&&r.to===target)||(r.from===target&&r.to===user))) fail('Đã có lời mời đang chờ.')
        const validCode=body.inviteCode===other!.inviteCode
        const known=this.friends(s,user).some(id=>this.friend(s,target,id))
        if(!validCode&&(other!.invitePolicy==='code'||((this.restricted(other!)||other!.invitePolicy==='known')&&!known))) fail('Người này chỉ nhận lời mời có mã mời hoặc từ bạn chung.',403)
        if(s.notices.filter(n=>n.actor===user&&n.kind==='request'&&n.createdAt>Date.now()-86400000).length>=30) fail('Đã đạt giới hạn lời mời hôm nay.',429)
        const r={id:randomUUID(),from:user,to:target,createdAt:Date.now()};s.requests.push(r);this.notice(s,target,user,'request',r.id)
      } else if(action==='request-response') {
        const r=s.requests.find(r=>r.id===body.id); if(!r) fail('Lời mời không còn tồn tại.',404)
        if(body.decision==='cancel'){if(r!.from!==user)fail('Không có quyền.',403)}else{if(r!.to!==user)fail('Không có quyền.',403);if(body.decision!=='accept'&&body.decision!=='decline')fail('Thao tác không hợp lệ.')}
        if(body.decision==='accept'&&!this.blocked(s,r!.from,r!.to)) s.friends.push([r!.from,r!.to])
        s.requests=s.requests.filter(x=>x.id!==r!.id)
      } else if(action==='unfriend'||action==='block'||action==='unblock'||action==='report') {
        if(target===user||!s.profiles.some(p=>p.id===target))fail('Người dùng không hợp lệ.')
        if(action==='unfriend'||action==='block')this.sever(s,user,target)
        if(action==='block'&&!s.blocks.some(([a,b])=>a===user&&b===target))s.blocks.push([user,target])
        if(action==='unblock')s.blocks=s.blocks.filter(([a,b])=>!(a===user&&b===target))
        if(action==='report'){const reason=str(body.reason,1000);if(reason.length<5)fail('Mô tả báo cáo ít nhất 5 ký tự.');s.reports.push({id:randomUUID(),from:user,target,reason,createdAt:Date.now()})}
      } else if(action==='group-save') {
        const name=str(body.name,60);if(!name)fail('Cần tên nhóm.')
        const members=ids(body.memberIds);if(members.some(id=>id!==user&&!this.friend(s,user,id)))fail('Chỉ thêm bạn bè vào nhóm.')
        const existing=s.groups.find(g=>g.id===body.id)
        if(body.id&&!existing)fail('Nhóm không còn tồn tại.',404)
        if(existing&&existing.ownerId!==user)fail('Chỉ chủ nhóm được chỉnh sửa.',403)
        if(existing){existing.name=name;existing.members=[user,...members.filter(id=>id!==user)]}else s.groups.push({id:randomUUID(),ownerId:user,name,members:[user,...members.filter(id=>id!==user)]})
      } else if(action==='group-leave') {
        const g=s.groups.find(g=>g.id===body.id&&g.members.includes(user));if(!g)fail('Nhóm không khả dụng.',404)
        // Owner leaving dissolves the group, revoking group-based sharing.
        if(g!.ownerId===user)s.groups=s.groups.filter(x=>x.id!==g!.id);else g!.members=g!.members.filter(id=>id!==user)
      } else if(action==='outfit-policy') {
        const outfitId=str(body.outfitId);if(!this.outfits.listSavedOutfits(user).some(o=>o.id===outfitId))fail('Không tìm thấy outfit.',404)
        const visibility=body.visibility;if(visibility!=='private'&&visibility!=='friends'&&visibility!=='groups')fail('Quyền xem không hợp lệ.')
        const groupIds=ids(body.groupIds??[]);if(groupIds.some(id=>!s.groups.some(g=>g.id===id&&g.members.includes(user))))fail('Nhóm không hợp lệ.')
        const old=s.policies.find(p=>p.outfitId===outfitId);s.policies=s.policies.filter(p=>p.outfitId!==outfitId)
        s.policies.push({ownerId:user,outfitId,visibility:visibility as OutfitPolicy['visibility'],groupIds,official:old?.official??false})
        if(visibility==='private') s.polls=s.polls.filter(p=>!(p.ownerId===user&&p.outfitIds.includes(outfitId)))
      } else if(action==='post-create') {
        const imageUrls=ids(body.imageUrls,3);if(!imageUrls.length||imageUrls.some(url=>!url.startsWith('/uploads/')))fail('Ảnh bài đăng không hợp lệ.')
        const visibility=body.visibility;if(visibility!=='private'&&visibility!=='friends'&&visibility!=='groups'&&visibility!=='public')fail('Quyền xem không hợp lệ.')
        const groupIds=ids(body.groupIds??[]);if(visibility==='groups'&&(!groupIds.length||groupIds.some(id=>!s.groups.some(group=>group.id===id&&group.members.includes(user)))))fail('Hãy chọn nhóm hợp lệ.')
        s.posts.push({id:randomUUID(),ownerId:user,caption:str(body.caption??'',500),imageUrls,visibility:visibility as SocialVisibility,groupIds,createdAt:Date.now()})
      } else if(action==='post-delete') {
        const post=s.posts.find(item=>item.id===body.id);if(!post)fail('Bài đăng không còn tồn tại.',404);if(post!.ownerId!==user)fail('Không có quyền xoá bài đăng.',403);s.posts=s.posts.filter(item=>item.id!==post!.id)
      } else if(action==='follow'||action==='unfollow') {
        const creator=this.person(s,target);if(target===user||!creator.creator||this.blocked(s,user,target))fail('Nhà sáng tạo không hợp lệ.',404)
        if(action==='follow'&&!s.follows.some(([follower,id])=>follower===user&&id===target))s.follows.push([user,target])
        if(action==='unfollow')s.follows=s.follows.filter(([follower,id])=>!(follower===user&&id===target))
      } else if(action==='image-poll-create') {
        const imageUrls=ids(body.imageUrls,3);if(imageUrls.length<2||imageUrls.some(url=>!url.startsWith('/uploads/')))fail('Chọn 2–3 ảnh để tạo bình chọn.')
        const hours=Number(body.hours);if(![1,24,72].includes(hours))fail('Thời hạn không hợp lệ.')
        const visibility=body.visibility;if(visibility!=='friends'&&visibility!=='groups'&&visibility!=='public')fail('Quyền xem bình chọn không hợp lệ.');const groupIds=ids(body.groupIds??[]);if(visibility==='groups'&&(!groupIds.length||groupIds.some(id=>!s.groups.some(group=>group.id===id&&group.members.includes(user)))))fail('Hãy chọn nhóm hợp lệ.')
        const supplied=ids(body.recipientIds??[]);if(visibility==='friends'&&supplied.some(id=>!this.friend(s,user,id)))fail('Người nhận phải là bạn bè hiện tại.');const groupMembers=s.groups.filter(group=>groupIds.includes(group.id)&&group.members.includes(user)).flatMap(group=>group.members).filter(id=>id!==user);const publicFollowers=s.follows.filter(([,creator])=>creator===user).map(([follower])=>follower);const recipients=[...new Set(visibility==='public'?[...this.friends(s,user),...publicFollowers]:visibility==='groups'?groupMembers:supplied.length?supplied:this.friends(s,user))];if(!recipients.length)fail('Bình chọn cần ít nhất một người nhận được.')
        const options=imageUrls.map(imageUrl=>({id:randomUUID(),imageUrl}));const p:Poll={id:randomUUID(),ownerId:user,title:str(body.title,120)||'Mình nên chọn bộ nào?',outfitIds:options.map(option=>option.id),imageOptions:options,visibility:visibility as SocialVisibility,groupIds,recipients,votes:{},createdAt:Date.now(),expiresAt:Date.now()+hours*3600000,closed:false,winnerId:null,notified:false};s.polls.push(p);for(const id of recipients)this.notice(s,id,user,'poll',p.id)
      } else if(action==='poll-create') {
        const outfitIds=ids(body.outfitIds,3);if(!outfitIds.length||outfitIds.some(id=>!this.outfits.listSavedOutfits(user).some(o=>o.id===id)))fail('Chọn 1–3 outfit của bạn.')
        const recipients=ids(body.recipientIds);if(!recipients.length||recipients.some(id=>!this.friend(s,user,id)))fail('Người nhận phải là bạn bè hiện tại.')
        const hours=Number(body.hours);if(![1,24,72].includes(hours))fail('Thời hạn không hợp lệ.')
        const p:Poll={id:randomUUID(),ownerId:user,title:str(body.title,120)||'Mình nên chọn bộ nào?',outfitIds,recipients,votes:{},createdAt:Date.now(),expiresAt:Date.now()+hours*3600000,closed:false,winnerId:null,notified:false};s.polls.push(p)
        for(const id of recipients)this.notice(s,id,user,'poll',p.id)
      } else if(['vote','poll-close','poll-delete','poll-winner'].includes(action)) {
        const p=s.polls.find(p=>p.id===body.id&&this.visiblePoll(s,p,user));if(!p)fail('Bình chọn không khả dụng.',404)
        if(action==='vote') {
          if(p!.ownerId===user||!this.activeRecipients(s,p!).includes(user))fail('Bạn không nằm trong người nhận.',403)
          if(p!.closed||p!.expiresAt<=Date.now())fail('Bình chọn đã kết thúc.',409)
          const id=str(body.outfitId);if(!p!.outfitIds.includes(id))fail('Outfit không thuộc bình chọn.')
          p!.votes[user]=id
          if(!s.notices.some(n=>n.userId===p!.ownerId&&n.kind==='result'&&n.targetId===p!.id&&!n.read))this.notice(s,p!.ownerId,p!.ownerId,'result',p!.id)
        } else {
          if(p!.ownerId!==user)fail('Chỉ người tạo được thực hiện.',403)
          if(action==='poll-delete')s.polls=s.polls.filter(x=>x.id!==p!.id)
          if(action==='poll-close')p!.closed=true
          if(action==='poll-winner') {
            if(!p!.closed&&p!.expiresAt>Date.now())fail('Đóng bình chọn trước khi lưu outfit thắng.')
            const counts=p!.outfitIds.map(id=>({id,count:Object.entries(p!.votes).filter(([u,o])=>o===id&&this.friend(s,user,u)).length}))
            const max=Math.max(...counts.map(c=>c.count));const id=str(body.outfitId)
            if(max===0||!counts.some(c=>c.id===id&&c.count===max))fail('Hãy chọn một outfit có nhiều phiếu nhất.')
            p!.winnerId=id;if(!p!.imageOptions?.length){const old=s.policies.find(x=>x.outfitId===id);if(old)old.official=true;else s.policies.push({ownerId:user,outfitId:id,visibility:'private',groupIds:[],official:true})}
          }
        }
        this.endExpired(s)
      } else if(action==='notification-read') {
        for(const n of s.notices)if(n.userId===user&&(!body.id||n.id===body.id))n.read=true
      } else fail('Thao tác không hợp lệ.')
    })
    return this.snapshot(user)
  }
}
