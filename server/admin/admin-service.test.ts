// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuthStore, type PublicUser } from '../auth/auth-store.js'
import { AdminService } from './admin-service.js'
import { SqliteAdminRepository } from './sqlite-admin-repository.js'

describe('AdminService authorization',()=>{
  let directory:string
  let auth:AuthStore
  let repository:SqliteAdminRepository
  let service:AdminService
  let admin:PublicUser
  let member:PublicUser

  beforeEach(async()=>{
    directory=mkdtempSync(path.join(tmpdir(),'tryoh-admin-'))
    const databasePath=path.join(directory,'test.sqlite')
    auth=new AuthStore(databasePath)
    admin=auth.createUser({id:'admin',email:'owner@example.com',displayName:'Owner',passwordHash:'hash',passwordSalt:'salt',createdAt:new Date().toISOString(),role:'admin'})
    member=auth.createUser({id:'member',email:'member@example.com',displayName:'Member',passwordHash:'hash',passwordSalt:'salt',createdAt:new Date().toISOString()})
    repository=new SqliteAdminRepository(databasePath)
    service=new AdminService(repository,['owner@example.com'])
    admin=await service.resolveAuthenticatedUser(admin)
    member=await service.resolveAuthenticatedUser(member)
  })

  afterEach(()=>{repository.close();auth.close();rmSync(directory,{recursive:true,force:true})})

  it('bootstraps only configured emails and rejects ordinary users',async()=>{
    expect(admin.role).toBe('admin')
    expect(member.role).toBe('user')
    await expect(service.summary(member)).rejects.toMatchObject({statusCode:403})
    await expect(service.summary(admin)).resolves.toMatchObject({users:2,admins:1})
  })

  it('does not grant admin from an allowlisted email without trusted app metadata',async()=>{
    const impostor=auth.createUser({id:'impostor',email:'another-owner@example.com',displayName:'Impostor',passwordHash:'hash',passwordSalt:'salt',createdAt:new Date().toISOString()})
    const guarded=new AdminService(repository,['another-owner@example.com'])
    await expect(guarded.resolveAuthenticatedUser(impostor)).resolves.toMatchObject({role:'user'})
  })

  it('prevents self privilege changes and records changes to other accounts',async()=>{
    await expect(service.updateUser(admin,admin.id,{role:'user'})).rejects.toMatchObject({statusCode:400})
    await expect(service.updateUser(admin,member.id,{role:'koc'})).resolves.toMatchObject({role:'koc'})
    const audit=await service.audit(admin)
    expect(audit[0]).toMatchObject({action:'user.role_changed',actorId:'admin',targetId:'member',details:{from:'user',to:'koc'}})
  })

  it('blocks suspended accounts at authentication time',async()=>{
    await service.updateUser(admin,member.id,{status:'suspended'})
    await expect(service.resolveAuthenticatedUser(member)).rejects.toMatchObject({statusCode:403})
  })

  it('lets an admin set user credits and records the change',async()=>{
    await expect(service.updateUser(admin,member.id,{creditBalance:4})).resolves.toMatchObject({creditBalance:4})
    const audit=await service.audit(admin)
    expect(audit[0]).toMatchObject({action:'user.credits_changed',targetId:'member',details:{from:'10',to:'4'}})
  })

  it('lets an admin assign a plan, grants its credits and records the change',async()=>{
    await expect(service.updateUser(admin,member.id,{subscriptionPlan:'plus'})).resolves.toMatchObject({subscriptionPlan:'plus',creditBalance:60})
    const audit=await service.audit(admin)
    expect(audit[0]).toMatchObject({action:'user.plan_changed',targetId:'member',details:{from:'free',to:'plus'}})
  })
})
