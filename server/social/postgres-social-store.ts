import { randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { AuthError } from '../auth/auth-service.js'
import { withTransaction, type PostgresPool } from '../storage/postgres.js'
import type { SavedOutfitRecord } from '../domain/saved-outfit.js'
import type { ModerationReport, SocialService } from './social-service.js'
import type { OutfitPolicy, SocialPerson, SocialPoll, SocialProfile, SocialSnapshot, SocialPost, SocialVisibility } from './types.js'
import { prepareSocialSearch, socialSearchScore } from './search.js'

/*
 * Social graph on normalized PostgreSQL tables (migration 009).
 *
 * Every request loads only the neighbourhood of the users involved (their
 * friends, requests, groups, polls, posts, ...) into the same in-memory shape the
 * business rules were written against, runs those rules, and for mutations writes
 * back only the rows that changed. Writes take per-user advisory locks, so
 * unrelated users never wait on each other.
 */

type Profile = Omit<SocialProfile, 'name'>
type RequestRow = { id: string; from: string; to: string; createdAt: number }
type Group = { id: string; ownerId: string; name: string; members: string[] }
type Poll = { id: string; ownerId: string; title: string; outfitIds: string[]; imageOptions?: { id: string; imageUrl: string }[]; visibility?: SocialVisibility; groupIds?: string[]; recipients: string[]; votes: Record<string, string>; createdAt: number; expiresAt: number; closed: boolean; winnerId: string | null; notified: boolean }
type Post = { id: string; ownerId: string; caption: string; imageUrls: string[]; visibility: SocialVisibility; groupIds: string[]; createdAt: number; hidden?: boolean }
type Notice = { id: string; userId: string; actor: string; kind: 'request' | 'poll' | 'result'; targetId: string; read: boolean; createdAt: number }
type Report = { id: string; from: string; target: string; reason: string; createdAt: number }
type State = { profiles: Profile[]; friends: [string, string][]; requests: RequestRow[]; groups: Group[]; polls: Poll[]; posts: Post[]; follows: [string, string][]; blocks: [string, string][]; reports: Report[]; notices: Notice[]; policies: (OutfitPolicy & { ownerId: string })[] }
type DbOutfit = SavedOutfitRecord & { ownerId: string }
type Context = { users: { id: string; name: string; role: string }[]; outfits: DbOutfit[]; followerCounts: Map<string, number> }
type Db = PostgresPool | PoolClient
type Loaded = { state: State; context: Context }

const FEED_LIMIT = 100
const POLL_LOAD_LIMIT = 200
const POST_LOAD_LIMIT = 300
const NOTICE_LOAD_LIMIT = 200
const CREATOR_LIMIT = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fail = (message: string, code = 400): never => { throw new AuthError(code, message) }
const str = (value: unknown, max = 120): string => typeof value === 'string' && value.trim().length <= max ? value.trim() : fail('Dữ liệu văn bản không hợp lệ.')
const ids = (value: unknown, max = 100): string[] => Array.isArray(value) && value.length <= max && value.every(x => typeof x === 'string' && x.length < 150) ? [...new Set(value as string[])] : fail('Danh sách không hợp lệ.')
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const ms = (value: Date | string): number => new Date(value).getTime()
const imageKeyFromUrl = (value: string): string | null => {
  if (!value.startsWith('/uploads/')) return null
  try { return decodeURIComponent(value.slice('/uploads/'.length)) } catch { return null }
}
const urlsForKey = (key: string): string[] => [...new Set([`/uploads/${key}`, `/uploads/${encodeURIComponent(key)}`])]
const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`
const uniq = (values: Iterable<string>): string[] => [...new Set(values)]
const isUniqueViolation = (error: unknown) => typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505'
const freshState = (): State => ({ profiles: [], friends: [], requests: [], groups: [], polls: [], posts: [], follows: [], blocks: [], reports: [], notices: [], policies: [] })
const clone = <T>(value: T): T => structuredClone(value)

export class PostgresSocialStore implements SocialService {
  // Users known to have a social_profiles row; avoids an upsert per request.
  private readonly knownProfiles = new Set<string>()
  private maintenanceTimer: NodeJS.Timeout | null = null

  constructor(private readonly pool: PostgresPool) {}

  async close(): Promise<void> {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer)
    this.maintenanceTimer = null
  }

  /** Periodic background work: poll results and notification pruning. */
  startMaintenance(intervalMs = 60_000): void {
    if (this.maintenanceTimer) return
    let running = false
    let runs = 0
    this.maintenanceTimer = setInterval(() => {
      if (running) return
      running = true
      runs += 1
      void this.runMaintenance(runs % 60 === 1)
        .catch(error => console.error('[social.maintenance]', error instanceof Error ? error.message : 'Unknown error'))
        .finally(() => { running = false })
    }, intervalMs)
    this.maintenanceTimer.unref()
  }

  async runMaintenance(pruneNotifications = false): Promise<void> {
    const due = await this.pool.query<{ id: string }>(
      'SELECT id FROM social_polls WHERE NOT notified AND (closed OR expires_at <= now()) ORDER BY expires_at LIMIT 50',
    )
    if (due.rows.length) await this.processExpiredPolls(due.rows.map(row => row.id))
    if (pruneNotifications) {
      await this.pool.query("DELETE FROM social_notifications WHERE created_at < now() - interval '180 days'")
      await this.pool.query(`DELETE FROM social_notifications WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rank FROM social_notifications
        ) ranked WHERE rank > ${NOTICE_LOAD_LIMIT}
      )`)
    }
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * Creates missing social_profiles rows. Inside a transaction the cache is not
   * updated, because a rollback would leave it claiming rows that do not exist.
   */
  private async ensureProfiles(db: Db, userIds: string[], cache = true): Promise<void> {
    const missing = uniq(userIds).filter(id => isUuid(id) && !this.knownProfiles.has(id))
    if (!missing.length) return
    await db.query(
      `INSERT INTO social_profiles(user_id, username, invite_code)
       SELECT p.id, 'user_' || replace(p.id::text, '-', ''), codes.code
       FROM unnest($1::uuid[], $2::text[]) AS codes(user_id, code)
       JOIN profiles p ON p.id = codes.user_id
       ON CONFLICT DO NOTHING`,
      [missing, missing.map(() => randomBytes(24).toString('base64url'))],
    )
    const present = await db.query<{ user_id: string }>('SELECT user_id FROM social_profiles WHERE user_id = ANY($1::uuid[])', [missing])
    if (cache) for (const row of present.rows) this.knownProfiles.add(row.user_id)
  }

  private async lock(client: PoolClient, userIds: string[]): Promise<void> {
    for (const id of uniq(userIds.filter(Boolean)).sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`social:${id}`])
    }
  }

  /**
   * Loads the social neighbourhood of `focus` users. Relations are complete for
   * focus users; for everyone else only what is needed to evaluate visibility.
   */
  private async load(db: Db, focusInput: string[], extra: { postIds?: string[]; pollIds?: string[]; transactional?: boolean } = {}): Promise<Loaded> {
    const focus = uniq(focusInput.filter(isUuid))
    const state = freshState()
    if (!focus.length) return { state, context: { users: [], outfits: [], followerCounts: new Map() } }
    const cache = !extra.transactional
    await this.ensureProfiles(db, focus, cache)

    const [friendRows, requestRows, groupRows, blockRows, followRows, pollIdRows, noticeRows] = await Promise.all([
      db.query<{ user_a: string; user_b: string }>('SELECT user_a, user_b FROM friendships WHERE user_a = ANY($1::uuid[]) OR user_b = ANY($1::uuid[])', [focus]),
      db.query<{ id: string; from_id: string; to_id: string; created_at: Date }>('SELECT id, from_id, to_id, created_at FROM friend_requests WHERE from_id = ANY($1::uuid[]) OR to_id = ANY($1::uuid[])', [focus]),
      db.query<{ id: string; owner_id: string; name: string; members: string[] }>(
        `SELECT g.id, g.owner_id, g.name, array_agg(m.user_id::text ORDER BY m.position, m.user_id) AS members
         FROM friend_groups g JOIN friend_group_members m ON m.group_id = g.id
         WHERE g.id IN (SELECT group_id FROM friend_group_members WHERE user_id = ANY($1::uuid[]))
         GROUP BY g.id`, [focus]),
      db.query<{ blocker_id: string; blocked_id: string }>('SELECT blocker_id, blocked_id FROM user_blocks WHERE blocker_id = ANY($1::uuid[]) OR blocked_id = ANY($1::uuid[])', [focus]),
      db.query<{ follower_id: string; creator_id: string }>('SELECT follower_id, creator_id FROM creator_follows WHERE follower_id = ANY($1::uuid[]) OR creator_id = ANY($1::uuid[])', [focus]),
      db.query<{ id: string }>(
        `SELECT id FROM (
           SELECT id, created_at FROM social_polls WHERE owner_id = ANY($1::uuid[])
           UNION
           SELECT p.id, p.created_at FROM social_polls p JOIN social_poll_recipients r ON r.poll_id = p.id WHERE r.user_id = ANY($1::uuid[])
         ) visible ORDER BY created_at DESC LIMIT ${POLL_LOAD_LIMIT}`, [focus]),
      db.query<{ id: string; user_id: string; actor_id: string; kind: Notice['kind']; target_id: string; read: boolean; created_at: Date }>(
        `(SELECT id, user_id, actor_id, kind, target_id, read, created_at FROM social_notifications
            WHERE user_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT ${NOTICE_LOAD_LIMIT})
         UNION
         (SELECT id, user_id, actor_id, kind, target_id, read, created_at FROM social_notifications
            WHERE actor_id = ANY($1::uuid[]) AND kind = 'request' AND created_at > now() - interval '1 day')`, [focus]),
    ])

    state.friends = friendRows.rows.map(row => [row.user_a, row.user_b])
    state.requests = requestRows.rows.map(row => ({ id: row.id, from: row.from_id, to: row.to_id, createdAt: ms(row.created_at) }))
    state.groups = groupRows.rows.map(row => ({ id: row.id, ownerId: row.owner_id, name: row.name, members: row.members }))
    state.blocks = blockRows.rows.map(row => [row.blocker_id, row.blocked_id])
    state.follows = followRows.rows.map(row => [row.follower_id, row.creator_id])
    state.notices = noticeRows.rows.map(row => ({ id: row.id, userId: row.user_id, actor: row.actor_id, kind: row.kind, targetId: row.target_id, read: row.read, createdAt: ms(row.created_at) }))
      .sort((a, b) => a.createdAt - b.createdAt)

    const friendIds = uniq(state.friends.flat())
    const followedCreators = uniq(state.follows.filter(([follower]) => focus.includes(follower)).map(([, creator]) => creator))
    const myGroupIds = state.groups.map(group => group.id)
    const pollIds = uniq([...pollIdRows.rows.map(row => row.id), ...(extra.pollIds ?? []).filter(isUuid)])

    const [polls, postRows, creatorRows] = await Promise.all([
      this.loadPolls(db, pollIds),
      db.query<{ id: string; owner_id: string; caption: string; image_urls: string[]; visibility: SocialVisibility; group_ids: string[]; hidden_at: Date | null; created_at: Date }>(
        `SELECT id, owner_id, caption, image_urls, visibility, group_ids::text[] AS group_ids, hidden_at, created_at FROM (
           (SELECT * FROM social_posts WHERE owner_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT ${POST_LOAD_LIMIT})
           UNION
           (SELECT * FROM social_posts WHERE hidden_at IS NULL AND (
              (owner_id = ANY($2::uuid[]) AND visibility IN ('friends','public'))
              OR (owner_id = ANY($3::uuid[]) AND visibility = 'public')
              OR (visibility = 'groups' AND group_ids && $4::uuid[])
            ) ORDER BY created_at DESC LIMIT ${POST_LOAD_LIMIT})
           UNION
           (SELECT * FROM social_posts WHERE hidden_at IS NULL AND visibility = 'public' ORDER BY created_at DESC LIMIT ${FEED_LIMIT})
           UNION
           (SELECT * FROM social_posts WHERE id = ANY($5::uuid[]))
         ) posts`,
        [focus, friendIds, followedCreators, myGroupIds, (extra.postIds ?? []).filter(isUuid)]),
      db.query<{ id: string }>(`SELECT id FROM profiles WHERE role IN ('koc','admin') ORDER BY created_at LIMIT ${CREATOR_LIMIT}`),
    ])
    state.polls = polls
    state.posts = postRows.rows.map(row => ({
      id: row.id, ownerId: row.owner_id, caption: row.caption, imageUrls: row.image_urls, visibility: row.visibility,
      groupIds: row.group_ids, createdAt: ms(row.created_at), ...(row.hidden_at ? { hidden: true } : {}),
    }))
    const creatorIds = creatorRows.rows.map(row => row.id)

    const related = uniq([
      ...focus, ...friendIds, ...followedCreators, ...creatorIds,
      ...state.requests.flatMap(row => [row.from, row.to]),
      ...state.groups.flatMap(group => group.members),
      ...state.blocks.flat(), ...state.follows.flat(),
      ...state.polls.flatMap(poll => [poll.ownerId, ...poll.recipients, ...Object.keys(poll.votes)]),
      ...state.posts.map(post => post.ownerId),
      ...state.notices.flatMap(notice => [notice.userId, notice.actor]),
    ])
    await this.ensureProfiles(db, related, cache)
    const outfitOwners = uniq([...focus, ...state.polls.map(poll => poll.ownerId)])

    const [profileRows, pairRows, blockPairRows, followPairRows, outfitRows, policyRows, followerRows] = await Promise.all([
      db.query<{ id: string; name: string; role: string; username: string; avatar: string; birth_date: string | null; invite_code: string; invite_policy: Profile['invitePolicy']; default_visibility: Profile['defaultVisibility'] }>(
        `SELECT p.id, p.display_name AS name, p.role, s.username, s.avatar, to_char(s.birth_date, 'YYYY-MM-DD') AS birth_date,
                s.invite_code, s.invite_policy, s.default_visibility
         FROM profiles p JOIN social_profiles s ON s.user_id = p.id WHERE p.id = ANY($1::uuid[])`, [related]),
      db.query<{ user_a: string; user_b: string }>('SELECT user_a, user_b FROM friendships WHERE user_a = ANY($1::uuid[]) AND user_b = ANY($1::uuid[])', [related]),
      db.query<{ blocker_id: string; blocked_id: string }>('SELECT blocker_id, blocked_id FROM user_blocks WHERE blocker_id = ANY($1::uuid[]) AND blocked_id = ANY($1::uuid[])', [related]),
      db.query<{ follower_id: string; creator_id: string }>('SELECT follower_id, creator_id FROM creator_follows WHERE follower_id = ANY($1::uuid[]) AND creator_id = ANY($1::uuid[])', [related]),
      db.query<{ id: string; user_id: string; front_image_url: string; front_image_key: string | null; back_image_url: string | null; back_image_key: string | null; garment_ids: string[]; created_at: Date }>(
        'SELECT id, user_id, front_image_url, front_image_key, back_image_url, back_image_key, garment_ids::text[] AS garment_ids, created_at FROM saved_outfits WHERE user_id = ANY($1::uuid[]) ORDER BY created_at', [outfitOwners]),
      db.query<{ outfit_id: string; owner_id: string; visibility: OutfitPolicy['visibility']; group_ids: string[]; official: boolean }>(
        'SELECT outfit_id, owner_id, visibility, group_ids::text[] AS group_ids, official FROM outfit_policies WHERE owner_id = ANY($1::uuid[])', [outfitOwners]),
      db.query<{ creator_id: string; count: string }>('SELECT creator_id, count(*)::text AS count FROM creator_follows WHERE creator_id = ANY($1::uuid[]) GROUP BY creator_id', [creatorIds]),
    ])

    state.profiles = profileRows.rows.map(row => ({
      id: row.id, username: row.username, avatar: row.avatar, birthDate: row.birth_date,
      inviteCode: row.invite_code, invitePolicy: row.invite_policy, defaultVisibility: row.default_visibility,
    }))
    const mergePairs = (current: [string, string][], rows: [string, string][], key: (pair: [string, string]) => string) => {
      const seen = new Set(current.map(key))
      for (const pair of rows) if (!seen.has(key(pair))) { seen.add(key(pair)); current.push(pair) }
    }
    mergePairs(state.friends, pairRows.rows.map(row => [row.user_a, row.user_b]), ([a, b]) => pairKey(a, b))
    mergePairs(state.blocks, blockPairRows.rows.map(row => [row.blocker_id, row.blocked_id]), ([a, b]) => `${a}|${b}`)
    mergePairs(state.follows, followPairRows.rows.map(row => [row.follower_id, row.creator_id]), ([a, b]) => `${a}|${b}`)
    state.policies = policyRows.rows.map(row => ({ outfitId: row.outfit_id, ownerId: row.owner_id, visibility: row.visibility, groupIds: row.group_ids, official: row.official }))

    const context: Context = {
      users: profileRows.rows.map(row => ({ id: row.id, name: row.name, role: row.role })),
      outfits: outfitRows.rows.map(row => ({
        id: row.id, ownerId: row.user_id, frontImageUrl: row.front_image_url, frontImageKey: row.front_image_key,
        backImageUrl: row.back_image_url, backImageKey: row.back_image_key, garmentIds: row.garment_ids ?? [],
        createdAt: new Date(row.created_at).toISOString(),
      })),
      followerCounts: new Map(followerRows.rows.map(row => [row.creator_id, Number(row.count)])),
    }
    return { state, context }
  }

  private async loadPolls(db: Db, pollIds: string[]): Promise<Poll[]> {
    if (!pollIds.length) return []
    const [pollRows, recipientRows, voteRows, optionRows] = await Promise.all([
      db.query<{ id: string; owner_id: string; title: string; outfit_ids: string[]; visibility: SocialVisibility | null; group_ids: string[]; created_at: Date; expires_at: Date; closed: boolean; winner_id: string | null; notified: boolean }>(
        'SELECT id, owner_id, title, outfit_ids::text[] AS outfit_ids, visibility, group_ids::text[] AS group_ids, created_at, expires_at, closed, winner_id, notified FROM social_polls WHERE id = ANY($1::uuid[])', [pollIds]),
      db.query<{ poll_id: string; user_id: string }>('SELECT poll_id, user_id FROM social_poll_recipients WHERE poll_id = ANY($1::uuid[])', [pollIds]),
      db.query<{ poll_id: string; user_id: string; option_id: string }>('SELECT poll_id, user_id, option_id FROM social_poll_votes WHERE poll_id = ANY($1::uuid[]) ORDER BY voted_at', [pollIds]),
      db.query<{ id: string; poll_id: string; image_url: string }>('SELECT id, poll_id, image_url FROM social_poll_options WHERE poll_id = ANY($1::uuid[]) ORDER BY position', [pollIds]),
    ])
    return pollRows.rows.map(row => {
      const options = optionRows.rows.filter(option => option.poll_id === row.id).map(option => ({ id: option.id, imageUrl: option.image_url }))
      return {
        id: row.id, ownerId: row.owner_id, title: row.title,
        outfitIds: options.length ? options.map(option => option.id) : row.outfit_ids,
        ...(options.length ? { imageOptions: options } : {}),
        ...(row.visibility ? { visibility: row.visibility } : {}),
        groupIds: row.group_ids,
        recipients: recipientRows.rows.filter(item => item.poll_id === row.id).map(item => item.user_id),
        votes: Object.fromEntries(voteRows.rows.filter(item => item.poll_id === row.id).map(item => [item.user_id, item.option_id])),
        createdAt: ms(row.created_at), expiresAt: ms(row.expires_at), closed: row.closed, winnerId: row.winner_id, notified: row.notified,
      }
    }).sort((a, b) => a.createdAt - b.createdAt)
  }

  // ---------------------------------------------------------------------------
  // Business rules (operate on the loaded neighbourhood)
  // ---------------------------------------------------------------------------

  private person(state: State, context: Context, id: string): SocialPerson {
    const profile = state.profiles.find(item => item.id === id)
    const user = context.users.find(item => item.id === id)
    if (!profile || !user) return fail('Không tìm thấy người dùng.', 404)
    return { id, username: profile.username, avatar: profile.avatar, name: user.name, creator: user.role === 'koc' || user.role === 'admin' }
  }
  private blocked(state: State, a: string, b: string) { return state.blocks.some(([x, y]) => (x === a && y === b) || (y === a && x === b)) }
  private friend(state: State, a: string, b: string) { return !this.blocked(state, a, b) && state.friends.some(([x, y]) => (x === a && y === b) || (y === a && x === b)) }
  private friends(state: State, id: string) { return state.profiles.filter(profile => this.friend(state, id, profile.id)).map(profile => profile.id) }
  private restricted(profile: Profile) {
    if (!profile.birthDate) return true
    const date = new Date(`${profile.birthDate}T00:00:00Z`); const today = new Date()
    const age = today.getUTCFullYear() - date.getUTCFullYear() - (today.getUTCMonth() < date.getUTCMonth() || (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate()) ? 1 : 0)
    return age < 18
  }
  private notice(state: State, userId: string, actor: string, kind: Notice['kind'], targetId: string) { state.notices.push({ id: randomUUID(), userId, actor, kind, targetId, read: false, createdAt: Date.now() }) }
  private activeRecipients(state: State, poll: Poll) { return poll.recipients.filter(id => !this.blocked(state, poll.ownerId, id) && (this.friend(state, poll.ownerId, id) || Boolean(poll.imageOptions?.length && poll.visibility === 'public' && state.follows.some(([follower, creator]) => follower === id && creator === poll.ownerId)))) }
  private ownerOutfits(context: Context, ownerId: string) { return context.outfits.filter(outfit => outfit.ownerId === ownerId) }
  private visiblePoll(state: State, context: Context, poll: Poll, user: string) { return (poll.ownerId === user || this.activeRecipients(state, poll).includes(user)) && (poll.imageOptions?.length ? true : poll.outfitIds.every(id => this.ownerOutfits(context, poll.ownerId).some(outfit => outfit.id === id))) }
  private pollNeedsResult(poll: Poll) { return !poll.notified && (poll.closed || poll.expiresAt <= Date.now()) }
  private endExpired(state: State, only?: Set<string>) {
    for (const poll of state.polls) if ((!only || only.has(poll.id)) && this.pollNeedsResult(poll)) {
      poll.notified = true
      this.notice(state, poll.ownerId, poll.ownerId, 'result', poll.id)
      for (const id of this.activeRecipients(state, poll)) this.notice(state, id, poll.ownerId, 'result', poll.id)
    }
  }
  private poll(state: State, context: Context, poll: Poll, viewer: string): SocialPoll {
    const recipients = this.activeRecipients(state, poll); const showVotes = viewer === poll.ownerId || Boolean(poll.votes[viewer]) || poll.closed || poll.expiresAt <= Date.now()
    return { id: poll.id, owner: this.person(state, context, poll.ownerId), title: poll.title, createdAt: poll.createdAt, expiresAt: poll.expiresAt, closed: poll.closed || poll.expiresAt <= Date.now(),
      outfits: poll.imageOptions?.map(option => ({ id: option.id, frontImageUrl: option.imageUrl, backImageUrl: null, official: false })) ?? this.ownerOutfits(context, poll.ownerId).filter(outfit => poll.outfitIds.includes(outfit.id)).map(outfit => ({ id: outfit.id, frontImageUrl: outfit.frontImageUrl, backImageUrl: outfit.backImageUrl, official: state.policies.some(item => item.outfitId === outfit.id && item.official) })),
      recipients: recipients.filter(id => !this.blocked(state, viewer, id)).map(id => this.person(state, context, id)),
      votes: showVotes ? Object.entries(poll.votes).filter(([id]) => recipients.includes(id) && !this.blocked(state, viewer, id)).map(([id, outfitId]) => ({ user: this.person(state, context, id), outfitId })) : [], myVote: poll.votes[viewer] ?? null, winnerId: poll.winnerId }
  }
  private visiblePost(state: State, post: Post, viewer: string) { if (post.hidden) return false; if (post.ownerId === viewer) return true; if (this.blocked(state, post.ownerId, viewer)) return false; if (post.visibility === 'public') return true; if (post.visibility === 'friends') return this.friend(state, post.ownerId, viewer); if (post.visibility === 'groups') return state.groups.some(group => post.groupIds.includes(group.id) && group.members.includes(post.ownerId) && group.members.includes(viewer)); return false }
  private socialPost(state: State, context: Context, post: Post): SocialPost { const owner = this.person(state, context, post.ownerId); return { id: post.id, owner, caption: post.caption, imageUrls: post.imageUrls, visibility: post.visibility, groupIds: post.groupIds, createdAt: post.createdAt, creator: Boolean(owner.creator) } }
  private canViewOutfit(state: State, context: Context, viewer: string, owner: string, outfitId: string) { if (viewer === owner) return true; if (!this.friend(state, viewer, owner)) return false; const policy = state.policies.find(item => item.ownerId === owner && item.outfitId === outfitId); const visibility = policy?.visibility ?? state.profiles.find(profile => profile.id === owner)?.defaultVisibility ?? 'private'; if (visibility === 'friends') return true; if (policy?.visibility === 'groups' && state.groups.some(group => policy.groupIds.includes(group.id) && group.members.includes(owner) && group.members.includes(viewer))) return true; return state.polls.some(poll => poll.ownerId === owner && poll.outfitIds.includes(outfitId) && poll.recipients.includes(viewer) && this.visiblePoll(state, context, poll, viewer)) }
  private sever(state: State, a: string, b: string) { state.friends = state.friends.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a))); state.requests = state.requests.filter(row => !((row.from === a && row.to === b) || (row.from === b && row.to === a))); for (const group of state.groups) { if (group.ownerId === a) group.members = group.members.filter(id => id !== b); if (group.ownerId === b) group.members = group.members.filter(id => id !== a) } for (const poll of state.polls) { if (poll.ownerId === a) { poll.recipients = poll.recipients.filter(id => id !== b); delete poll.votes[b] } if (poll.ownerId === b) { poll.recipients = poll.recipients.filter(id => id !== a); delete poll.votes[a] } } }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Writes poll result notifications for finished polls, at most once per poll. */
  private async processExpiredPolls(pollIds: string[]): Promise<void> {
    for (const pollId of uniq(pollIds.filter(isUuid))) {
      await withTransaction(this.pool, async client => {
        const locked = await client.query<{ owner_id: string }>(
          'SELECT owner_id FROM social_polls WHERE id = $1 AND NOT notified AND (closed OR expires_at <= now()) FOR UPDATE SKIP LOCKED', [pollId])
        const ownerId = locked.rows[0]?.owner_id
        if (!ownerId) return
        const { state } = await this.load(client, [ownerId], { pollIds: [pollId], transactional: true })
        const before = clone(state)
        this.endExpired(state, new Set([pollId]))
        await this.sync(client, before, state)
      })
    }
  }

  async snapshot(user: string): Promise<SocialSnapshot> {
    if (!isUuid(user)) return fail('Không tìm thấy người dùng.', 404)
    let { state, context } = await this.load(this.pool, [user])
    const pending = state.polls.filter(poll => this.pollNeedsResult(poll) && this.visiblePoll(state, context, poll, user)).map(poll => poll.id)
    if (pending.length) {
      await this.processExpiredPolls(pending);
      ({ state, context } = await this.load(this.pool, [user]))
    }
    return this.buildSnapshot(state, context, user)
  }

  private buildSnapshot(state: State, context: Context, user: string): SocialSnapshot {
    const me = state.profiles.find(profile => profile.id === user) ?? fail('Không tìm thấy người dùng.', 404)
    const requests = state.requests.filter(row => !this.blocked(state, row.from, row.to) && (row.from === user || row.to === user)).map(row => ({ ...row, from: this.person(state, context, row.from), to: this.person(state, context, row.to) }))
    const pendingFirst = (poll: SocialPoll) => Number(!poll.closed && !poll.myVote && poll.owner.id !== user)
    return {
      me: { ...me, ...this.person(state, context, user) },
      friends: this.friends(state, user).map(id => this.person(state, context, id)),
      incoming: requests.filter(row => row.to.id === user),
      outgoing: requests.filter(row => row.from.id === user),
      groups: state.groups.filter(group => group.members.includes(user)).map(group => ({ ...group, members: group.members.filter(id => !this.blocked(state, user, id)).map(id => this.person(state, context, id)) })),
      polls: state.polls.filter(poll => this.visiblePoll(state, context, poll, user)).map(poll => this.poll(state, context, poll, user)).sort((a, b) => pendingFirst(b) - pendingFirst(a) || b.createdAt - a.createdAt),
      blocked: state.blocks.filter(([a]) => a === user).map(([, b]) => this.person(state, context, b)),
      notifications: state.notices.filter(notice => notice.userId === user && !this.blocked(state, user, notice.actor) && (notice.kind === 'request' ? state.requests.some(row => row.id === notice.targetId) : state.polls.some(poll => poll.id === notice.targetId && this.visiblePoll(state, context, poll, user)))).slice(-100).reverse().map(notice => ({ id: notice.id, kind: notice.kind, targetId: notice.targetId, read: notice.read, createdAt: notice.createdAt, text: notice.kind === 'request' ? `${this.person(state, context, notice.actor).name} gửi lời mời kết bạn` : notice.kind === 'poll' ? `${this.person(state, context, notice.actor).name} muốn xin ý kiến bạn` : 'Có kết quả bình chọn' })),
      policies: state.policies.filter(policy => policy.ownerId === user && this.ownerOutfits(context, user).some(outfit => outfit.id === policy.outfitId)).map(({ outfitId, ownerId, visibility, groupIds, official }) => ({ outfitId, ownerId, visibility, groupIds, official })),
      posts: state.posts.filter(post => !this.person(state, context, post.ownerId).creator && this.visiblePost(state, post, user)).map(post => this.socialPost(state, context, post)).sort((a, b) => b.createdAt - a.createdAt).slice(0, FEED_LIMIT),
      creatorFeed: state.posts.filter(post => this.person(state, context, post.ownerId).creator && (post.ownerId === user || state.follows.some(([follower, creator]) => follower === user && creator === post.ownerId)) && this.visiblePost(state, post, user)).map(post => this.socialPost(state, context, post)).sort((a, b) => b.createdAt - a.createdAt).slice(0, FEED_LIMIT),
      creators: context.users.filter(item => item.role === 'koc' || item.role === 'admin').map(item => this.person(state, context, item.id)).filter(person => !this.blocked(state, user, person.id)).map(person => ({ person, following: state.follows.some(([follower, creator]) => follower === user && creator === person.id), followerCount: context.followerCounts.get(person.id) ?? 0 })),
      followingIds: state.follows.filter(([follower]) => follower === user).map(([, creator]) => creator),
    }
  }

  async search(user: string, query: string): Promise<SocialPerson[]> {
    const search = prepareSocialSearch(query)
    if (!search || !isUuid(user)) return []
    const run = (pattern: string) => this.pool.query<{ id: string }>(
      `SELECT p.id FROM profiles p LEFT JOIN social_profiles s ON s.user_id = p.id
       WHERE p.id <> $1
         AND (public.vn_unaccent(coalesce(s.username, 'user_' || replace(p.id::text, '-', ''))) LIKE $2
              OR ($3 = false AND public.vn_unaccent(p.display_name) LIKE $2))
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = p.id) OR (b.blocker_id = p.id AND b.blocked_id = $1))
       LIMIT 200`, [user, pattern, search.usernameOnly])
    const escaped = search.value.replace(/[\\%_]/g, char => `\\${char}`)
    const candidates = new Set((await run(`${escaped}%`)).rows.map(row => row.id))
    if (candidates.size < 20) for (const row of (await run(`%${escaped}%`)).rows) candidates.add(row.id)
    if (!candidates.size) return []
    const people = await this.people([...candidates])
    return people
      .map(person => ({ person, score: socialSearchScore(person.username, person.name, search) }))
      .filter((result): result is { person: SocialPerson; score: number } => result.score !== null)
      .sort((a, b) => a.score - b.score || a.person.username.localeCompare(b.person.username, 'vi'))
      .slice(0, 20)
      .map(result => result.person)
  }

  private async people(userIds: string[]): Promise<SocialPerson[]> {
    await this.ensureProfiles(this.pool, userIds)
    const rows = await this.pool.query<{ id: string; name: string; role: string; username: string; avatar: string }>(
      'SELECT p.id, p.display_name AS name, p.role, s.username, s.avatar FROM profiles p JOIN social_profiles s ON s.user_id = p.id WHERE p.id = ANY($1::uuid[])', [userIds])
    return rows.rows.map(row => ({ id: row.id, username: row.username, avatar: row.avatar, name: row.name, creator: row.role === 'koc' || row.role === 'admin' }))
  }

  async resolveInvite(user: string, code: string): Promise<SocialPerson> {
    if (!code || code.length > 100) return fail('Mã mời không còn hiệu lực.', 404)
    const row = await this.pool.query<{ user_id: string }>('SELECT user_id FROM social_profiles WHERE invite_code = $1', [code])
    const target = row.rows[0]?.user_id
    if (!target) return fail('Mã mời không còn hiệu lực.', 404)
    const { state, context } = await this.load(this.pool, [user, target])
    if (this.blocked(state, user, target)) return fail('Mã mời không còn hiệu lực.', 404)
    return this.person(state, context, target)
  }

  async profile(user: string, target: string) {
    if (!isUuid(target)) return fail('Hồ sơ không khả dụng.', 404)
    const { state, context } = await this.load(this.pool, [user, target])
    if (user !== target && !this.friend(state, user, target)) return fail('Hồ sơ không khả dụng.', 404)
    return {
      person: this.person(state, context, target),
      outfits: this.ownerOutfits(context, target).filter(outfit => this.canViewOutfit(state, context, user, target, outfit.id)).map(outfit => ({ id: outfit.id, frontImageUrl: outfit.frontImageUrl, backImageUrl: outfit.backImageUrl, official: state.policies.some(policy => policy.outfitId === outfit.id && policy.official) })),
    }
  }

  async canReadImage(user: string, key: string): Promise<boolean> {
    if (!isUuid(user) || !key) return false
    const urls = urlsForKey(key)
    const direct = await this.pool.query<{ allowed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM garments WHERE user_id = $1 AND $2 IN (front_original_key, front_processed_key, back_original_key, back_processed_key))
           OR EXISTS (SELECT 1 FROM person_images WHERE user_id = $1 AND image_key = $2)
           OR EXISTS (SELECT 1 FROM try_on_images WHERE user_id = $1 AND image_key = $2)
           OR EXISTS (SELECT 1 FROM saved_outfits WHERE user_id = $1 AND (front_image_key = $2 OR back_image_key = $2))
           OR EXISTS (SELECT 1 FROM temporary_images WHERE owner_id = $1 AND image_key = $2 AND expires_at > now())
           OR EXISTS (SELECT 1 FROM social_profiles WHERE avatar = ANY($3::text[])) AS allowed`, [user, key, urls])
    if (direct.rows[0]?.allowed) return true

    const [posts, polls, outfits] = await Promise.all([
      this.pool.query<{ id: string; owner_id: string }>('SELECT id, owner_id FROM social_posts WHERE image_urls && $1::text[] AND hidden_at IS NULL LIMIT 20', [urls]),
      this.pool.query<{ poll_id: string; owner_id: string }>('SELECT o.poll_id, p.owner_id FROM social_poll_options o JOIN social_polls p ON p.id = o.poll_id WHERE o.image_url = ANY($1::text[]) LIMIT 20', [urls]),
      this.pool.query<{ id: string; user_id: string }>('SELECT id, user_id FROM saved_outfits WHERE front_image_key = $1 OR back_image_key = $1 LIMIT 20', [key]),
    ])
    if (!posts.rows.length && !polls.rows.length && !outfits.rows.length) return false
    const owners = uniq([...posts.rows.map(row => row.owner_id), ...polls.rows.map(row => row.owner_id), ...outfits.rows.map(row => row.user_id)])
    const outfitPollIds = outfits.rows.length
      ? (await this.pool.query<{ id: string }>('SELECT id FROM social_polls WHERE outfit_ids && $1::uuid[]', [outfits.rows.map(row => row.id)])).rows.map(row => row.id)
      : []
    const { state, context } = await this.load(this.pool, [user, ...owners], {
      postIds: posts.rows.map(row => row.id),
      pollIds: [...polls.rows.map(row => row.poll_id), ...outfitPollIds],
    })
    if (state.posts.some(post => post.imageUrls.some(url => imageKeyFromUrl(url) === key) && this.visiblePost(state, post, user))) return true
    if (state.polls.some(poll => poll.imageOptions?.some(option => imageKeyFromUrl(option.imageUrl) === key) && this.visiblePoll(state, context, poll, user))) return true
    return outfits.rows.some(row => this.canViewOutfit(state, context, user, row.user_id, row.id))
  }

  async trackTemporaryImage(user: string, key: string): Promise<void> {
    if (!isUuid(user) || !key) return
    await withTransaction(this.pool, async client => {
      await client.query(
        `INSERT INTO temporary_images(image_key, owner_id) VALUES($1, $2)
         ON CONFLICT (image_key) DO UPDATE SET owner_id = EXCLUDED.owner_id, created_at = now(), expires_at = now() + interval '24 hours'`, [key, user])
      // Keep at most 100 pending images per user; older ones go to the cleanup queue.
      await client.query(
        `WITH overflow AS (
           DELETE FROM temporary_images WHERE image_key IN (
             SELECT image_key FROM temporary_images WHERE owner_id = $1 ORDER BY created_at DESC OFFSET 100
           ) RETURNING image_key
         )
         INSERT INTO storage_cleanup_queue(image_key, reason) SELECT image_key, 'temporary_overflow' FROM overflow
         ON CONFLICT (image_key) DO NOTHING`, [user])
    })
  }

  /** Image keys owned by the user's social content; call before the account is deleted. */
  async listUserImageKeys(user: string): Promise<string[]> {
    if (!isUuid(user)) return []
    const rows = await this.pool.query<{ value: string; is_url: boolean }>(
      `SELECT avatar AS value, true AS is_url FROM social_profiles WHERE user_id = $1 AND avatar <> ''
       UNION ALL SELECT unnest(image_urls), true FROM social_posts WHERE owner_id = $1
       UNION ALL SELECT o.image_url, true FROM social_poll_options o JOIN social_polls p ON p.id = o.poll_id WHERE p.owner_id = $1
       UNION ALL SELECT image_key, false FROM temporary_images WHERE owner_id = $1`, [user])
    return uniq(rows.rows.map(row => row.is_url ? imageKeyFromUrl(row.value) : row.value).filter((value): value is string => Boolean(value)))
  }

  async deleteUserData(user: string): Promise<string[]> {
    if (!isUuid(user)) return []
    const keys = await this.listUserImageKeys(user)
    // Profile deletion normally cascades; delete explicitly too in case the auth
    // row was removed while the profile row survived.
    await this.pool.query('DELETE FROM social_profiles WHERE user_id = $1', [user])
    this.knownProfiles.delete(user)
    return keys
  }

  async hideUserPosts(user: string): Promise<number> {
    if (!isUuid(user)) return 0
    const result = await this.pool.query('UPDATE social_posts SET hidden_at = now() WHERE owner_id = $1 AND hidden_at IS NULL', [user])
    return result.rowCount ?? 0
  }

  async moderationReports(): Promise<ModerationReport[]> {
    const rows = await this.pool.query<{ id: string; reporter_id: string; target_id: string; reason: string; created_at: Date; from_name: string | null; target_name: string | null }>(
      `SELECT r.id, r.reporter_id, r.target_id, r.reason, r.created_at, f.display_name AS from_name, t.display_name AS target_name
       FROM user_reports r LEFT JOIN profiles f ON f.id = r.reporter_id LEFT JOIN profiles t ON t.id = r.target_id
       WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 200`)
    return rows.rows.map(row => ({ id: row.id, from: row.reporter_id, target: row.target_id, reason: row.reason, createdAt: ms(row.created_at), fromName: row.from_name ?? undefined, targetName: row.target_name ?? undefined }))
  }

  async resolveModerationReport(reportId: string, resolution: { status?: 'resolved' | 'dismissed'; note?: string; actorId?: string } = {}): Promise<boolean> {
    if (!isUuid(reportId)) return false
    const result = await this.pool.query(
      "UPDATE user_reports SET status = $2, resolution = $3, resolved_by = $4, resolved_at = now() WHERE id = $1 AND status = 'open'",
      [reportId, resolution.status ?? 'resolved', resolution.note?.slice(0, 500) ?? null, isUuid(resolution.actorId) ? resolution.actorId : null])
    return (result.rowCount ?? 0) > 0
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  async act(user: string, action: string, body: Record<string, unknown>): Promise<SocialSnapshot> {
    if (!isUuid(user)) return fail('Không tìm thấy người dùng.', 404)
    const target = typeof body.targetId === 'string' ? body.targetId : ''
    if (target && !isUuid(target) && ['request', 'unfriend', 'block', 'unblock', 'report', 'follow', 'unfollow'].includes(action)) {
      return fail(action === 'follow' || action === 'unfollow' ? 'Nhà sáng tạo không hợp lệ.' : 'Người dùng không hợp lệ.', action === 'follow' || action === 'unfollow' ? 404 : 400)
    }
    if (action === 'settings' && typeof body.username === 'string') {
      const taken = await this.pool.query('SELECT 1 FROM social_profiles WHERE username = $1 AND user_id <> $2', [body.username.trim().toLowerCase(), user])
      if (taken.rows.length) fail('Username đã được sử dụng.', 409)
    }
    const focus = [user, ...(isUuid(target) ? [target] : [])]
    await this.ensureProfiles(this.pool, focus)
    try {
      await withTransaction(this.pool, async client => {
        await this.lock(client, focus)
        const { state, context } = await this.load(client, focus, { transactional: true })
        const before = clone(state)
        this.apply(state, context, user, target, action, body)
        await this.sync(client, before, state)
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = (error as { constraint?: string }).constraint ?? ''
        if (constraint.includes('username')) fail('Username đã được sử dụng.', 409)
        if (constraint.includes('friend_requests')) fail('Đã có lời mời đang chờ.')
        fail('Thao tác vừa được thực hiện. Vui lòng tải lại.', 409)
      }
      throw error
    }
    return this.snapshot(user)
  }

  private apply(state: State, context: Context, user: string, target: string, action: string, body: Record<string, unknown>) {
    const me = state.profiles.find(profile => profile.id === user) ?? fail('Không tìm thấy người dùng.', 404)
    if (action === 'settings') {
      const username = str(body.username, 40).toLowerCase()
      if (!/^[a-z0-9_]{3,40}$/.test(username)) fail('Username cần 3–40 chữ thường, số hoặc dấu _.')
      if (body.birthDate && !me.birthDate) {
        const date = str(body.birthDate, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || Date.parse(date) > Date.now() || Date.parse(date) < Date.parse('1900-01-01')) fail('Ngày sinh không hợp lệ.')
        me.birthDate = date
      }
      const policy = body.invitePolicy
      if (policy !== 'everyone' && policy !== 'known' && policy !== 'code') fail('Quyền lời mời không hợp lệ.')
      me.username = username
      if (body.avatar !== undefined) { const avatar = str(body.avatar, 500); if (avatar && !avatar.startsWith('/uploads/')) fail('Ảnh đại diện không hợp lệ.'); me.avatar = avatar }
      me.invitePolicy = policy as SocialProfile['invitePolicy']
      if (body.defaultVisibility !== undefined) { if (body.defaultVisibility !== 'private' && body.defaultVisibility !== 'friends') fail('Quyền xem mặc định không hợp lệ.'); me.defaultVisibility = body.defaultVisibility as SocialProfile['defaultVisibility'] }
      if (this.restricted(me) && me.invitePolicy === 'everyone') me.invitePolicy = 'known'
    } else if (action === 'rotate-invite') {
      me.inviteCode = randomBytes(24).toString('base64url')
    } else if (action === 'request') {
      const other = state.profiles.find(profile => profile.id === target)
      if (!other || target === user || this.blocked(state, user, target)) return fail('Không thể gửi lời mời.')
      if (this.friend(state, user, target)) fail('Hai bạn đã kết bạn.')
      if (state.requests.some(row => (row.from === user && row.to === target) || (row.from === target && row.to === user))) fail('Đã có lời mời đang chờ.')
      const validCode = body.inviteCode === other.inviteCode
      const known = this.friends(state, user).some(id => this.friend(state, target, id))
      if (!validCode && (other.invitePolicy === 'code' || ((this.restricted(other) || other.invitePolicy === 'known') && !known))) fail('Người này chỉ nhận lời mời có mã mời hoặc từ bạn chung.', 403)
      if (state.notices.filter(notice => notice.actor === user && notice.kind === 'request' && notice.createdAt > Date.now() - 86400000).length >= 30) fail('Đã đạt giới hạn lời mời hôm nay.', 429)
      const request = { id: randomUUID(), from: user, to: target, createdAt: Date.now() }
      state.requests.push(request); this.notice(state, target, user, 'request', request.id)
    } else if (action === 'request-response') {
      const request = state.requests.find(row => row.id === body.id) ?? fail('Lời mời không còn tồn tại.', 404)
      if (body.decision === 'cancel') { if (request.from !== user) fail('Không có quyền.', 403) }
      else { if (request.to !== user) fail('Không có quyền.', 403); if (body.decision !== 'accept' && body.decision !== 'decline') fail('Thao tác không hợp lệ.') }
      if (body.decision === 'accept' && !this.blocked(state, request.from, request.to)) state.friends.push([request.from, request.to])
      state.requests = state.requests.filter(row => row.id !== request.id)
    } else if (action === 'unfriend' || action === 'block' || action === 'unblock' || action === 'report') {
      if (target === user || !state.profiles.some(profile => profile.id === target)) fail('Người dùng không hợp lệ.')
      if (action === 'unfriend' || action === 'block') this.sever(state, user, target)
      if (action === 'block' && !state.blocks.some(([a, b]) => a === user && b === target)) state.blocks.push([user, target])
      if (action === 'unblock') state.blocks = state.blocks.filter(([a, b]) => !(a === user && b === target))
      if (action === 'report') { const reason = str(body.reason, 1000); if (reason.length < 5) fail('Mô tả báo cáo ít nhất 5 ký tự.'); state.reports.push({ id: randomUUID(), from: user, target, reason, createdAt: Date.now() }) }
    } else if (action === 'group-save') {
      const name = str(body.name, 60); if (!name) fail('Cần tên nhóm.')
      const members = ids(body.memberIds)
      if (members.some(id => id !== user && !this.friend(state, user, id))) fail('Chỉ thêm bạn bè vào nhóm.')
      const existing = state.groups.find(group => group.id === body.id)
      if (body.id && !existing) fail('Nhóm không còn tồn tại.', 404)
      if (existing && existing.ownerId !== user) fail('Chỉ chủ nhóm được chỉnh sửa.', 403)
      if (existing) { existing.name = name; existing.members = [user, ...members.filter(id => id !== user)] }
      else state.groups.push({ id: randomUUID(), ownerId: user, name, members: [user, ...members.filter(id => id !== user)] })
    } else if (action === 'group-leave') {
      const group = state.groups.find(item => item.id === body.id && item.members.includes(user)) ?? fail('Nhóm không khả dụng.', 404)
      if (group.ownerId === user) state.groups = state.groups.filter(item => item.id !== group.id)
      else group.members = group.members.filter(id => id !== user)
    } else if (action === 'outfit-policy') {
      const outfitId = str(body.outfitId)
      if (!this.ownerOutfits(context, user).some(outfit => outfit.id === outfitId)) fail('Không tìm thấy outfit.', 404)
      const visibility = body.visibility
      if (visibility !== 'private' && visibility !== 'friends' && visibility !== 'groups') fail('Quyền xem không hợp lệ.')
      const groupIds = ids(body.groupIds ?? [])
      if (groupIds.some(id => !state.groups.some(group => group.id === id && group.members.includes(user)))) fail('Nhóm không hợp lệ.')
      const old = state.policies.find(policy => policy.outfitId === outfitId)
      state.policies = state.policies.filter(policy => policy.outfitId !== outfitId)
      state.policies.push({ ownerId: user, outfitId, visibility: visibility as OutfitPolicy['visibility'], groupIds, official: old?.official ?? false })
      if (visibility === 'private') state.polls = state.polls.filter(poll => !(poll.ownerId === user && poll.outfitIds.includes(outfitId)))
    } else if (action === 'post-create') {
      const imageUrls = ids(body.imageUrls, 3)
      if (!imageUrls.length || imageUrls.some(url => !url.startsWith('/uploads/'))) fail('Ảnh bài đăng không hợp lệ.')
      const visibility = body.visibility
      if (visibility !== 'private' && visibility !== 'friends' && visibility !== 'groups' && visibility !== 'public') fail('Quyền xem không hợp lệ.')
      const groupIds = ids(body.groupIds ?? [])
      if (visibility === 'groups' && (!groupIds.length || groupIds.some(id => !state.groups.some(group => group.id === id && group.members.includes(user))))) fail('Hãy chọn nhóm hợp lệ.')
      state.posts.push({ id: randomUUID(), ownerId: user, caption: str(body.caption ?? '', 500), imageUrls, visibility: visibility as SocialVisibility, groupIds: visibility === 'groups' ? groupIds : groupIds.filter(id => state.groups.some(group => group.id === id)), createdAt: Date.now() })
    } else if (action === 'post-delete') {
      const post = state.posts.find(item => item.id === body.id) ?? fail('Bài đăng không còn tồn tại.', 404)
      if (post.ownerId !== user) fail('Không có quyền xoá bài đăng.', 403)
      state.posts = state.posts.filter(item => item.id !== post.id)
    } else if (action === 'follow' || action === 'unfollow') {
      if (target === user || !state.profiles.some(profile => profile.id === target)) fail('Nhà sáng tạo không hợp lệ.', 404)
      const creator = this.person(state, context, target)
      if (!creator.creator || this.blocked(state, user, target)) fail('Nhà sáng tạo không hợp lệ.', 404)
      if (action === 'follow' && !state.follows.some(([follower, id]) => follower === user && id === target)) state.follows.push([user, target])
      if (action === 'unfollow') state.follows = state.follows.filter(([follower, id]) => !(follower === user && id === target))
    } else if (action === 'image-poll-create') {
      const imageUrls = ids(body.imageUrls, 3)
      if (imageUrls.length < 2 || imageUrls.some(url => !url.startsWith('/uploads/'))) fail('Chọn 2–3 ảnh để tạo bình chọn.')
      const hours = Number(body.hours); if (![1, 24, 72].includes(hours)) fail('Thời hạn không hợp lệ.')
      const visibility = body.visibility
      if (visibility !== 'friends' && visibility !== 'groups' && visibility !== 'public') fail('Quyền xem bình chọn không hợp lệ.')
      const groupIds = ids(body.groupIds ?? [])
      if (visibility === 'groups' && (!groupIds.length || groupIds.some(id => !state.groups.some(group => group.id === id && group.members.includes(user))))) fail('Hãy chọn nhóm hợp lệ.')
      const supplied = ids(body.recipientIds ?? [])
      if (visibility === 'friends' && supplied.some(id => !this.friend(state, user, id))) fail('Người nhận phải là bạn bè hiện tại.')
      const groupMembers = state.groups.filter(group => groupIds.includes(group.id) && group.members.includes(user)).flatMap(group => group.members).filter(id => id !== user)
      const publicFollowers = state.follows.filter(([, creator]) => creator === user).map(([follower]) => follower)
      const recipients = uniq(visibility === 'public' ? [...this.friends(state, user), ...publicFollowers] : visibility === 'groups' ? groupMembers : supplied.length ? supplied : this.friends(state, user))
      if (!recipients.length) fail('Bình chọn cần ít nhất một người nhận được.')
      const options = imageUrls.map(imageUrl => ({ id: randomUUID(), imageUrl }))
      const poll: Poll = { id: randomUUID(), ownerId: user, title: str(body.title, 120) || 'Mình nên chọn bộ nào?', outfitIds: options.map(option => option.id), imageOptions: options, visibility: visibility as SocialVisibility, groupIds: visibility === 'groups' ? groupIds : [], recipients, votes: {}, createdAt: Date.now(), expiresAt: Date.now() + hours * 3600000, closed: false, winnerId: null, notified: false }
      state.polls.push(poll); for (const id of recipients) this.notice(state, id, user, 'poll', poll.id)
    } else if (action === 'poll-create') {
      const outfitIds = ids(body.outfitIds, 3)
      if (!outfitIds.length || outfitIds.some(id => !this.ownerOutfits(context, user).some(outfit => outfit.id === id))) fail('Chọn 1–3 outfit của bạn.')
      const recipients = ids(body.recipientIds)
      if (!recipients.length || recipients.some(id => !this.friend(state, user, id))) fail('Người nhận phải là bạn bè hiện tại.')
      const hours = Number(body.hours); if (![1, 24, 72].includes(hours)) fail('Thời hạn không hợp lệ.')
      const poll: Poll = { id: randomUUID(), ownerId: user, title: str(body.title, 120) || 'Mình nên chọn bộ nào?', outfitIds, groupIds: [], recipients, votes: {}, createdAt: Date.now(), expiresAt: Date.now() + hours * 3600000, closed: false, winnerId: null, notified: false }
      state.polls.push(poll); for (const id of recipients) this.notice(state, id, user, 'poll', poll.id)
    } else if (['vote', 'poll-close', 'poll-delete', 'poll-winner'].includes(action)) {
      const poll = state.polls.find(item => item.id === body.id && this.visiblePoll(state, context, item, user)) ?? fail('Bình chọn không khả dụng.', 404)
      if (action === 'vote') {
        if (poll.ownerId === user || !this.activeRecipients(state, poll).includes(user)) fail('Bạn không nằm trong người nhận.', 403)
        if (poll.closed || poll.expiresAt <= Date.now()) fail('Bình chọn đã kết thúc.', 409)
        const id = str(body.outfitId); if (!poll.outfitIds.includes(id)) fail('Outfit không thuộc bình chọn.')
        poll.votes[user] = id
        if (!state.notices.some(notice => notice.userId === poll.ownerId && notice.kind === 'result' && notice.targetId === poll.id && !notice.read)) this.notice(state, poll.ownerId, poll.ownerId, 'result', poll.id)
      } else {
        if (poll.ownerId !== user) fail('Chỉ người tạo được thực hiện.', 403)
        if (action === 'poll-delete') state.polls = state.polls.filter(item => item.id !== poll.id)
        if (action === 'poll-close') poll.closed = true
        if (action === 'poll-winner') {
          if (!poll.closed && poll.expiresAt > Date.now()) fail('Đóng bình chọn trước khi lưu outfit thắng.')
          const counts = poll.outfitIds.map(id => ({ id, count: Object.entries(poll.votes).filter(([voter, outfit]) => outfit === id && this.friend(state, user, voter)).length }))
          const max = Math.max(...counts.map(item => item.count)); const id = str(body.outfitId)
          if (max === 0 || !counts.some(item => item.id === id && item.count === max)) fail('Hãy chọn một outfit có nhiều phiếu nhất.')
          poll.winnerId = id
          if (!poll.imageOptions?.length) { const old = state.policies.find(item => item.outfitId === id); if (old) old.official = true; else state.policies.push({ ownerId: user, outfitId: id, visibility: 'private', groupIds: [], official: true }) }
        }
      }
      this.endExpired(state, new Set([poll.id]))
    } else if (action === 'notification-read') {
      for (const notice of state.notices) if (notice.userId === user && (!body.id || notice.id === body.id)) notice.read = true
    } else fail('Thao tác không hợp lệ.')
  }

  /** Persists the difference between two loaded states. Only touched rows are written. */
  private async sync(client: PoolClient, before: State, after: State): Promise<void> {
    const byId = <T extends { id: string }>(items: T[]) => new Map(items.map(item => [item.id, item]))
    const diffKeys = <T>(a: T[], b: T[], key: (item: T) => string) => {
      const left = new Map(a.map(item => [key(item), item])); const right = new Map(b.map(item => [key(item), item]))
      return { added: [...right].filter(([k]) => !left.has(k)).map(([, v]) => v), removed: [...left].filter(([k]) => !right.has(k)).map(([, v]) => v) }
    }
    const ts = (value: number) => new Date(value).toISOString()

    // Profiles: field-level updates only.
    const oldProfiles = byId(before.profiles)
    for (const profile of after.profiles) {
      const old = oldProfiles.get(profile.id)
      if (!old) continue
      if (old.username !== profile.username || old.avatar !== profile.avatar || old.birthDate !== profile.birthDate || old.inviteCode !== profile.inviteCode || old.invitePolicy !== profile.invitePolicy || old.defaultVisibility !== profile.defaultVisibility) {
        await client.query(
          'UPDATE social_profiles SET username=$2, avatar=$3, birth_date=$4::date, invite_code=$5, invite_policy=$6, default_visibility=$7 WHERE user_id=$1',
          [profile.id, profile.username, profile.avatar, profile.birthDate, profile.inviteCode, profile.invitePolicy, profile.defaultVisibility])
      }
    }

    const friends = diffKeys(before.friends, after.friends, ([a, b]) => pairKey(a, b))
    for (const [a, b] of friends.removed) await client.query('DELETE FROM friendships WHERE user_a=$1 AND user_b=$2', a < b ? [a, b] : [b, a])
    for (const [a, b] of friends.added) await client.query('INSERT INTO friendships(user_a, user_b) VALUES($1,$2) ON CONFLICT DO NOTHING', a < b ? [a, b] : [b, a])

    const requests = diffKeys(before.requests, after.requests, row => row.id)
    for (const row of requests.removed) await client.query('DELETE FROM friend_requests WHERE id=$1', [row.id])
    for (const row of requests.added) await client.query('INSERT INTO friend_requests(id, from_id, to_id, created_at) VALUES($1,$2,$3,$4)', [row.id, row.from, row.to, ts(row.createdAt)])

    const blocks = diffKeys(before.blocks, after.blocks, ([a, b]) => `${a}|${b}`)
    for (const [a, b] of blocks.removed) await client.query('DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2', [a, b])
    for (const [a, b] of blocks.added) await client.query('INSERT INTO user_blocks(blocker_id, blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [a, b])

    const follows = diffKeys(before.follows, after.follows, ([a, b]) => `${a}|${b}`)
    for (const [a, b] of follows.removed) await client.query('DELETE FROM creator_follows WHERE follower_id=$1 AND creator_id=$2', [a, b])
    for (const [a, b] of follows.added) await client.query('INSERT INTO creator_follows(follower_id, creator_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [a, b])

    const oldGroups = byId(before.groups); const newGroups = byId(after.groups)
    for (const group of before.groups) if (!newGroups.has(group.id)) await client.query('DELETE FROM friend_groups WHERE id=$1', [group.id])
    for (const group of after.groups) {
      const old = oldGroups.get(group.id)
      if (!old) await client.query('INSERT INTO friend_groups(id, owner_id, name) VALUES($1,$2,$3)', [group.id, group.ownerId, group.name])
      else if (old.name !== group.name) await client.query('UPDATE friend_groups SET name=$2 WHERE id=$1', [group.id, group.name])
      if (!old || old.members.join() !== group.members.join()) {
        await client.query('DELETE FROM friend_group_members WHERE group_id=$1 AND NOT (user_id = ANY($2::uuid[]))', [group.id, group.members])
        await client.query(
          `INSERT INTO friend_group_members(group_id, user_id, position)
           SELECT $1, member, position - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS m(member, position)
           ON CONFLICT (group_id, user_id) DO UPDATE SET position = EXCLUDED.position`, [group.id, group.members])
      }
    }

    const oldPolls = byId(before.polls); const newPolls = byId(after.polls)
    for (const poll of before.polls) if (!newPolls.has(poll.id)) await client.query('DELETE FROM social_polls WHERE id=$1', [poll.id])
    for (const poll of after.polls) {
      const old = oldPolls.get(poll.id)
      if (!old) {
        await client.query(
          'INSERT INTO social_polls(id, owner_id, title, outfit_ids, visibility, group_ids, created_at, expires_at, closed, winner_id, notified) VALUES($1,$2,$3,$4::uuid[],$5,$6::uuid[],$7,$8,$9,$10,$11)',
          [poll.id, poll.ownerId, poll.title, poll.imageOptions?.length ? [] : poll.outfitIds, poll.visibility ?? null, poll.groupIds ?? [], ts(poll.createdAt), ts(poll.expiresAt), poll.closed, poll.winnerId, poll.notified])
        for (const [index, option] of (poll.imageOptions ?? []).entries()) {
          await client.query('INSERT INTO social_poll_options(id, poll_id, image_url, position) VALUES($1,$2,$3,$4)', [option.id, poll.id, option.imageUrl, index])
        }
      } else {
        if (old.closed !== poll.closed) await client.query('UPDATE social_polls SET closed=$2 WHERE id=$1', [poll.id, poll.closed])
        if (old.winnerId !== poll.winnerId) await client.query('UPDATE social_polls SET winner_id=$2 WHERE id=$1', [poll.id, poll.winnerId])
        if (old.notified !== poll.notified) await client.query('UPDATE social_polls SET notified=$2 WHERE id=$1', [poll.id, poll.notified])
      }
      const recipients = diffKeys(old?.recipients ?? [], poll.recipients, id => id)
      if (recipients.removed.length) await client.query('DELETE FROM social_poll_recipients WHERE poll_id=$1 AND user_id = ANY($2::uuid[])', [poll.id, recipients.removed])
      if (recipients.added.length) await client.query('INSERT INTO social_poll_recipients(poll_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [poll.id, recipients.added])
      const oldVotes = old?.votes ?? {}
      for (const voter of Object.keys(oldVotes)) if (!(voter in poll.votes)) await client.query('DELETE FROM social_poll_votes WHERE poll_id=$1 AND user_id=$2', [poll.id, voter])
      for (const [voter, option] of Object.entries(poll.votes)) if (oldVotes[voter] !== option) {
        await client.query(
          `INSERT INTO social_poll_votes(poll_id, user_id, option_id) VALUES($1,$2,$3)
           ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = now()`, [poll.id, voter, option])
      }
    }

    const posts = diffKeys(before.posts, after.posts, post => post.id)
    for (const post of posts.removed) await client.query('DELETE FROM social_posts WHERE id=$1', [post.id])
    for (const post of posts.added) {
      await client.query('INSERT INTO social_posts(id, owner_id, caption, image_urls, visibility, group_ids, created_at) VALUES($1,$2,$3,$4::text[],$5,$6::uuid[],$7)',
        [post.id, post.ownerId, post.caption, post.imageUrls, post.visibility, post.groupIds, ts(post.createdAt)])
    }

    const oldNotices = byId(before.notices); const newNotices = byId(after.notices)
    for (const notice of before.notices) if (!newNotices.has(notice.id)) await client.query('DELETE FROM social_notifications WHERE id=$1', [notice.id])
    const readIds: string[] = []
    for (const notice of after.notices) {
      const old = oldNotices.get(notice.id)
      if (!old) await client.query('INSERT INTO social_notifications(id, user_id, actor_id, kind, target_id, read, created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [notice.id, notice.userId, notice.actor, notice.kind, notice.targetId, notice.read, ts(notice.createdAt)])
      else if (old.read !== notice.read && notice.read) readIds.push(notice.id)
    }
    if (readIds.length) await client.query('UPDATE social_notifications SET read = true WHERE id = ANY($1::uuid[])', [readIds])

    const policyKey = (policy: OutfitPolicy) => `${policy.outfitId}|${policy.visibility}|${policy.groupIds.join(',')}|${policy.official}`
    const oldPolicies = new Map(before.policies.map(policy => [policy.outfitId, policy]))
    const newPolicies = new Map(after.policies.map(policy => [policy.outfitId, policy]))
    for (const [outfitId] of oldPolicies) if (!newPolicies.has(outfitId)) await client.query('DELETE FROM outfit_policies WHERE outfit_id=$1', [outfitId])
    for (const [outfitId, policy] of newPolicies) {
      const old = oldPolicies.get(outfitId)
      if (old && policyKey(old) === policyKey(policy)) continue
      await client.query(
        `INSERT INTO outfit_policies(outfit_id, owner_id, visibility, group_ids, official) VALUES($1,$2,$3,$4::uuid[],$5)
         ON CONFLICT (outfit_id) DO UPDATE SET visibility = EXCLUDED.visibility, group_ids = EXCLUDED.group_ids, official = EXCLUDED.official`,
        [outfitId, policy.ownerId, policy.visibility, policy.groupIds, policy.official])
    }

    // Images of deleted posts and image polls go to the durable cleanup queue in the
    // same transaction. The queue skips anything still referenced elsewhere.
    const orphanedKeys = uniq([
      ...posts.removed.flatMap(post => post.imageUrls),
      ...before.polls.filter(poll => !newPolls.has(poll.id)).flatMap(poll => (poll.imageOptions ?? []).map(option => option.imageUrl)),
    ].map(imageKeyFromUrl).filter((key): key is string => Boolean(key)))
    if (orphanedKeys.length) {
      await client.query(
        `INSERT INTO storage_cleanup_queue(image_key, reason) SELECT unnest($1::text[]), 'social_content_deleted'
         ON CONFLICT (image_key) DO NOTHING`, [orphanedKeys])
    }

    for (const report of diffKeys(before.reports, after.reports, report => report.id).added) {
      await client.query('INSERT INTO user_reports(id, reporter_id, target_id, reason, created_at) VALUES($1,$2,$3,$4,$5)', [report.id, report.from, report.target, report.reason, ts(report.createdAt)])
    }
  }
}
