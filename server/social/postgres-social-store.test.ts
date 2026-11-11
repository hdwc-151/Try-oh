// @vitest-environment node
// Mirrors social-store.test.ts against the normalized PostgreSQL implementation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../__tests__/pglite-pool.js'
import { PostgresSocialStore } from './postgres-social-store.js'

const names = ['alice', 'bob', 'carol', 'outsider', 'creator', 'viet'] as const
type Name = typeof names[number]
const uid = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
const U = Object.fromEntries(names.map((name, index) => [name, uid(index)])) as Record<Name, string>
const OUTFIT = { one: 'aaaaaaaa-0000-4000-8000-000000000001', two: 'aaaaaaaa-0000-4000-8000-000000000002' }

describe('PostgresSocialStore', () => {
  let test: TestDatabase
  let social: PostgresSocialStore

  beforeEach(async () => {
    test = await createTestDatabase()
    for (const name of names.filter(item => item !== 'viet')) await test.createUser(U[name], `${name}@test.local`, name)
    await test.db.query("update profiles set role='koc' where id=$1", [U.creator])
    social = new PostgresSocialStore(test.pool)
    await social.snapshot(U.alice)
    for (const [key, id] of Object.entries(OUTFIT)) {
      await test.db.query('insert into saved_outfits(id,user_id,front_image_url,front_image_key) values($1,$2,$3,$4)', [id, U.alice, `/uploads/${key}.png`, `${key}.png`])
    }
  })
  afterEach(async () => { vi.useRealTimers(); await social.close(); await test.close() })

  const connect = async (a: Name, b: Name) => {
    const code = (await social.snapshot(U[b])).me.inviteCode
    await social.act(U[a], 'request', { targetId: U[b], inviteCode: code })
    const request = (await social.snapshot(U[b])).incoming.find(row => row.from.id === U[a])!
    await social.act(U[b], 'request-response', { id: request.id, decision: 'accept' })
  }
  const poll = async () => {
    await connect('alice', 'bob'); await connect('alice', 'carol')
    return (await social.act(U.alice, 'poll-create', { outfitIds: [OUTFIT.one, OUTFIT.two], recipientIds: [U.bob, U.carol], hours: 1, title: 'Chọn giúp mình' })).polls[0]!
  }

  it('requires invite codes for unknown ages and protects private profile data', async () => {
    expect((await social.snapshot(U.alice)).me.defaultVisibility).toBe('private')
    await expect(social.act(U.bob, 'request', { targetId: U.alice })).rejects.toThrow()
    await connect('alice', 'bob')
    const person = (await social.profile(U.bob, U.alice)).person
    expect(person).not.toHaveProperty('birthDate'); expect(person).not.toHaveProperty('inviteCode')
    expect((await social.profile(U.bob, U.alice)).outfits).toHaveLength(0)
    await expect(social.profile(U.outsider, U.alice)).rejects.toThrow()
  })

  it('applies the profile default visibility only when an outfit has no explicit policy', async () => {
    await connect('alice', 'bob')
    expect((await social.profile(U.bob, U.alice)).outfits).toHaveLength(0)
    await social.act(U.alice, 'settings', { username: 'alice_style', invitePolicy: 'known', defaultVisibility: 'friends' })
    expect((await social.profile(U.bob, U.alice)).outfits).toHaveLength(2)
    await social.act(U.alice, 'outfit-policy', { outfitId: OUTFIT.one, visibility: 'private', groupIds: [] })
    expect((await social.profile(U.bob, U.alice)).outfits.map(outfit => outfit.id)).toEqual([OUTFIT.two])
  })

  it('only recipients vote; vote changes replace rather than accumulate', async () => {
    const p = await poll()
    expect((await social.snapshot(U.outsider)).polls).toHaveLength(0)
    await expect(social.act(U.outsider, 'vote', { id: p.id, outfitId: OUTFIT.one })).rejects.toThrow()
    await social.act(U.bob, 'vote', { id: p.id, outfitId: OUTFIT.one })
    expect((await social.snapshot(U.carol)).polls[0]!.votes).toHaveLength(0)
    await social.act(U.bob, 'vote', { id: p.id, outfitId: OUTFIT.two })
    await social.act(U.carol, 'vote', { id: p.id, outfitId: OUTFIT.one })
    expect((await social.snapshot(U.bob)).polls[0]!.votes).toHaveLength(2)
    expect((await social.snapshot(U.alice)).polls[0]!.votes.find(v => v.user.id === U.bob)?.outfitId).toBe(OUTFIT.two)
  })

  it('revokes poll and media access on unfriend, even after reconnect', async () => {
    const p = await poll()
    expect(await social.canReadImage(U.bob, 'one.png')).toBe(true)
    expect(await social.canReadImage(U.outsider, 'one.png')).toBe(false)
    await social.act(U.alice, 'unfriend', { targetId: U.bob })
    expect((await social.snapshot(U.bob)).polls).toHaveLength(0)
    expect(await social.canReadImage(U.bob, 'one.png')).toBe(false)
    await connect('alice', 'bob')
    await expect(social.act(U.bob, 'vote', { id: p.id, outfitId: OUTFIT.one })).rejects.toThrow()
  })

  it('blocks requests and removes notifications without notifying blocked user', async () => {
    await poll(); await social.act(U.alice, 'block', { targetId: U.bob })
    expect((await social.snapshot(U.bob)).notifications).toHaveLength(0)
    expect(await social.search(U.bob, `user_${U.alice.replace(/-/g, '')}`)).toHaveLength(0)
    const code = (await social.snapshot(U.alice)).me.inviteCode
    await expect(social.act(U.bob, 'request', { targetId: U.alice, inviteCode: code })).rejects.toThrow()
  })

  it('searches by display name or username and ranks exact usernames first', async () => {
    await test.createUser(U.viet, 'viet@test.local', 'Nguyễn Nam')
    await social.act(U.alice, 'settings', { username: 'alice_style', invitePolicy: 'known' })
    await social.act(U.carol, 'settings', { username: 'alice_style_daily', invitePolicy: 'known' })
    expect((await social.search(U.bob, '@ALICE_STYLE')).map(person => person.id)).toEqual([U.alice, U.carol])
    expect((await social.search(U.bob, 'ice')).map(person => person.id)).toContain(U.alice)
    expect((await social.search(U.bob, 'nguyen nam')).map(person => person.id)).toContain(U.viet)
    expect(await social.search(U.alice, 'alice')).not.toContainEqual(expect.objectContaining({ id: U.alice }))
    expect(await social.search(U.bob, 'a')).toEqual([])
    await expect(social.act(U.bob, 'settings', { username: 'alice_style', invitePolicy: 'known' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('group membership gates media; leaving revokes access', async () => {
    await connect('alice', 'bob'); await connect('alice', 'carol')
    const group = (await social.act(U.alice, 'group-save', { name: 'Close', memberIds: [U.bob] })).groups[0]!
    await social.act(U.alice, 'outfit-policy', { outfitId: OUTFIT.one, visibility: 'groups', groupIds: [group.id] })
    expect(await social.canReadImage(U.bob, 'one.png')).toBe(true)
    expect(await social.canReadImage(U.carol, 'one.png')).toBe(false)
    await expect(social.act(U.bob, 'group-save', { id: group.id, name: 'Steal', memberIds: [] })).rejects.toThrow()
    await social.act(U.bob, 'group-leave', { id: group.id })
    expect(await social.canReadImage(U.bob, 'one.png')).toBe(false)
  })

  it('expiration prevents votes and emits results once; owner saves winning outfit', async () => {
    const p = await poll(); await social.act(U.bob, 'vote', { id: p.id, outfitId: OUTFIT.two })
    await expect(social.act(U.alice, 'poll-winner', { id: p.id, outfitId: OUTFIT.two })).rejects.toThrow()
    await test.db.query("update social_polls set expires_at = now() - interval '1 second' where id = $1", [p.id])
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(p.expiresAt + 1)
    await expect(social.act(U.bob, 'vote', { id: p.id, outfitId: OUTFIT.one })).rejects.toThrow()
    const count = (await social.snapshot(U.bob)).notifications.length
    expect((await social.snapshot(U.bob)).notifications).toHaveLength(count)
    await social.runMaintenance()
    expect((await social.snapshot(U.bob)).notifications).toHaveLength(count)
    await expect(social.act(U.alice, 'poll-winner', { id: p.id, outfitId: OUTFIT.one })).rejects.toThrow()
    expect((await social.act(U.alice, 'poll-winner', { id: p.id, outfitId: OUTFIT.two })).policies.find(o => o.outfitId === OUTFIT.two)?.official).toBe(true)
  })

  it('private reset and deletion revoke prior poll media access', async () => {
    await poll()
    await social.act(U.alice, 'outfit-policy', { outfitId: OUTFIT.one, visibility: 'private' })
    expect((await social.snapshot(U.bob)).polls).toHaveLength(0)
    expect(await social.canReadImage(U.bob, 'one.png')).toBe(false)
  })

  it('rejects more than 3 outfits, invalid audience and changes to others polls', async () => {
    const p = await poll()
    await expect(social.act(U.alice, 'poll-create', { outfitIds: [OUTFIT.one, OUTFIT.two, 'three', 'four'], recipientIds: [U.bob], hours: 24 })).rejects.toThrow()
    await expect(social.act(U.alice, 'poll-create', { outfitIds: [OUTFIT.one], recipientIds: [U.outsider], hours: 24 })).rejects.toThrow()
    await expect(social.act(U.bob, 'poll-delete', { id: p.id })).rejects.toThrow()
  })

  it('stores reports and limits minor invitation settings', async () => {
    const result = await social.act(U.alice, 'settings', { username: 'alice_1', birthDate: '2015-01-01', invitePolicy: 'everyone' })
    expect(result.me.invitePolicy).toBe('known')
    await expect(social.act(U.bob, 'report', { targetId: U.alice, reason: 'Unsafe content' })).resolves.toBeTruthy()
    expect((await social.moderationReports()).map(report => report.reason)).toEqual(['Unsafe content'])
    const code = result.me.inviteCode; await social.act(U.alice, 'rotate-invite', {})
    await expect(social.resolveInvite(U.bob, code)).rejects.toThrow()
  })

  it('accepts only stored image URLs for avatars and grants authenticated image access', async () => {
    await expect(social.act(U.alice, 'settings', { username: 'alice_style', avatar: '🌿', invitePolicy: 'known' })).rejects.toThrow()
    await social.act(U.alice, 'settings', { username: 'alice_style', avatar: '/uploads/avatar.webp', invitePolicy: 'known' })
    expect(await social.canReadImage(U.bob, 'avatar.webp')).toBe(true)
  })

  it('applies post privacy to both the feed and protected image route', async () => {
    await connect('alice', 'bob')
    await social.act(U.alice, 'post-create', { imageUrls: ['/uploads/private.webp'], caption: 'Riêng tư', visibility: 'private', groupIds: [] })
    expect((await social.snapshot(U.bob)).posts).toHaveLength(0)
    expect(await social.canReadImage(U.bob, 'private.webp')).toBe(false)
    await social.act(U.alice, 'post-create', { imageUrls: ['/uploads/friends.webp'], caption: 'Bạn bè', visibility: 'friends', groupIds: [] })
    expect((await social.snapshot(U.bob)).posts.map(post => post.caption)).toContain('Bạn bè')
    expect(await social.canReadImage(U.bob, 'friends.webp')).toBe(true)
    expect((await social.snapshot(U.outsider)).posts).toHaveLength(0)
  })

  it('shows creator posts only after following', async () => {
    await social.act(U.creator, 'post-create', { imageUrls: ['/uploads/creator.webp'], caption: 'Look mới', visibility: 'public', groupIds: [] })
    expect((await social.snapshot(U.alice)).creatorFeed).toHaveLength(0)
    const followed = await social.act(U.alice, 'follow', { targetId: U.creator })
    expect(followed.creatorFeed[0]?.caption).toBe('Look mới')
    expect(followed.creators.find(item => item.person.id === U.creator)?.followerCount).toBe(1)
    expect(await social.canReadImage(U.alice, 'creator.webp')).toBe(true)
    const created = (await social.act(U.creator, 'image-poll-create', { imageUrls: ['/uploads/koc-a.webp', '/uploads/koc-b.webp'], title: 'Chọn look', hours: 24, visibility: 'public' })).polls[0]!
    expect((await social.snapshot(U.alice)).polls.some(item => item.id === created.id)).toBe(true)
    await expect(social.act(U.alice, 'vote', { id: created.id, outfitId: created.outfits[0]!.id })).resolves.toBeTruthy()
  })

  it('creates a poll directly from uploaded images', async () => {
    await connect('alice', 'bob')
    const result = await social.act(U.alice, 'image-poll-create', { imageUrls: ['/uploads/a.webp', '/uploads/b.webp'], recipientIds: [U.bob], title: 'Chọn ảnh', hours: 24, visibility: 'friends' })
    const created = result.polls.find(item => item.title === 'Chọn ảnh')!
    expect(created.outfits.map(item => item.frontImageUrl)).toEqual(['/uploads/a.webp', '/uploads/b.webp'])
    expect(await social.canReadImage(U.bob, 'a.webp')).toBe(true)
    expect(await social.canReadImage(U.outsider, 'a.webp')).toBe(false)
  })

  it('removes orphaned social data when an account is deleted', async () => {
    await social.act(U.creator, 'post-create', { imageUrls: ['/uploads/deleted.webp'], caption: 'Tài khoản cũ', visibility: 'public', groupIds: [] })
    await social.act(U.alice, 'follow', { targetId: U.creator })
    expect(await social.listUserImageKeys(U.creator)).toEqual(['deleted.webp'])
    await test.db.query('delete from auth.users where id = $1', [U.creator])
    const snapshot = await social.snapshot(U.alice)
    expect(snapshot.creatorFeed).toEqual([])
    expect(snapshot.creators.some(item => item.person.id === U.creator)).toBe(false)
    expect(snapshot.followingIds).not.toContain(U.creator)
  })

  it('backfills the legacy JSON document into normalized tables', async () => {
    const fresh = await createTestDatabase()
    try {
      await fresh.createUser(U.alice, 'alice@test.local', 'alice')
      await fresh.createUser(U.bob, 'bob@test.local', 'bob')
      const legacy = {
        profiles: [U.alice, U.bob].map((id, index) => ({ id, username: `legacy_${index}`, avatar: '', birthDate: null, invitePolicy: 'known', inviteCode: `code-${index}`, defaultVisibility: 'private' })),
        friends: [[U.alice, U.bob], [U.bob, U.alice]],
        requests: [], groups: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', ownerId: U.alice, name: 'Nhóm', members: [U.alice, U.bob, U.carol] }],
        polls: [], posts: [{ id: 'cccccccc-0000-4000-8000-000000000001', ownerId: U.bob, caption: 'Hi', imageUrls: ['/uploads/x.webp'], visibility: 'friends', groupIds: [], createdAt: Date.now() }],
        follows: [], blocks: [], reports: [], notices: [], policies: [], temporaryImages: [],
      }
      await fresh.db.query('update social_state set data = $1 where id = 1', [JSON.stringify(legacy)])
      const { readFileSync } = await import('node:fs')
      const path = await import('node:path')
      await fresh.db.exec(readFileSync(path.resolve(import.meta.dirname, '../../supabase/migrations/009_social_normalized.sql'), 'utf8'))
      const migrated = new PostgresSocialStore(fresh.pool)
      const snapshot = await migrated.snapshot(U.alice)
      expect(snapshot.me.username).toBe('legacy_0')
      expect(snapshot.friends.map(friend => friend.id)).toEqual([U.bob])
      expect(snapshot.groups[0]?.members.map(member => member.id)).toEqual([U.alice, U.bob])
      expect(snapshot.posts.map(post => post.caption)).toEqual(['Hi'])
    } finally {
      await fresh.close()
    }
  })
})
