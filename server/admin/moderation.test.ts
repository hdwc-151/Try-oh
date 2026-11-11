// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../__tests__/pglite-pool.js'
import { PostgresSocialStore } from '../social/postgres-social-store.js'
import { AdminService } from './admin-service.js'
import { PostgresAdminRepository } from './postgres-admin-repository.js'

const ADMIN = '00000000-0000-4000-8000-0000000000aa'
const MOD = '00000000-0000-4000-8000-0000000000bb'
const REPORTER = '00000000-0000-4000-8000-000000000001'
const TARGET = '00000000-0000-4000-8000-000000000002'
const actor = (id: string, role: 'admin' | 'moderator') => ({ id, email: `${role}@example.com`, displayName: role, createdAt: new Date().toISOString(), role, status: 'active' as const })

describe('Moderation', () => {
  let test: TestDatabase
  let social: PostgresSocialStore
  let admin: AdminService
  beforeEach(async () => {
    test = await createTestDatabase()
    for (const [id, email] of [[ADMIN, 'admin@example.com'], [MOD, 'mod@example.com'], [REPORTER, 'reporter@example.com'], [TARGET, 'target@example.com']]) await test.createUser(id!, email!)
    await test.db.query("update profiles set role='admin' where id=$1", [ADMIN])
    await test.db.query("update profiles set role='moderator' where id=$1", [MOD])
    social = new PostgresSocialStore(test.pool)
    admin = new AdminService(new PostgresAdminRepository(test.pool), [], 0)
    await social.act(TARGET, 'post-create', { imageUrls: ['/uploads/bad.webp'], caption: 'Spam', visibility: 'public', groupIds: [] })
    await social.act(REPORTER, 'report', { targetId: TARGET, reason: 'Nội dung spam' })
  })
  afterEach(async () => { await social.close(); await test.close() })

  it('lets a moderator hide posts and resolve the report, with an audit trail', async () => {
    const [report] = await social.moderationReports()
    expect((await social.snapshot(REPORTER)).posts).toHaveLength(1)
    await admin.moderate(actor(MOD, 'moderator'), social, report!.id, { status: 'resolved', hidePosts: true })
    expect(await social.moderationReports()).toEqual([])
    expect((await social.snapshot(REPORTER)).posts).toHaveLength(0)
    expect(await social.canReadImage(REPORTER, 'bad.webp')).toBe(false)
    const audit = (await test.db.query<{ action: string }>('select action from admin_audit_logs order by created_at')).rows.map(row => row.action)
    expect(audit).toEqual(['user.posts_hidden', 'report.resolved'])
  })

  it('allows only admins to suspend the reported account', async () => {
    const [report] = await social.moderationReports()
    await expect(admin.moderate(actor(MOD, 'moderator'), social, report!.id, { suspend: true })).rejects.toMatchObject({ statusCode: 403 })
    await admin.moderate(actor(ADMIN, 'admin'), social, report!.id, { suspend: true })
    expect((await test.db.query<{ status: string }>('select status from profiles where id=$1', [TARGET])).rows[0]?.status).toBe('suspended')
  })

  it('dismisses a report without side effects', async () => {
    const [report] = await social.moderationReports()
    await admin.moderate(actor(MOD, 'moderator'), social, report!.id, { status: 'dismissed' })
    expect((await social.snapshot(REPORTER)).posts).toHaveLength(1)
    await expect(admin.moderate(actor(MOD, 'moderator'), social, report!.id, { status: 'dismissed' })).rejects.toMatchObject({ statusCode: 404 })
  })
})
