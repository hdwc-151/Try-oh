// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AuthStore } from '../auth/auth-store.js'
import { SqliteUserDataRepository } from '../storage/sqlite-user-data-repository.js'
import { SqliteGarmentRepository } from '../storage/sqlite-garment-repository.js'
import { SocialStore } from './social-store.js'
import Database from 'better-sqlite3'
describe('Social access and voting',()=>{
 let dir:string,dbPath:string,auth:AuthStore,outfits:SqliteUserDataRepository,garments:SqliteGarmentRepository,social:SocialStore
 beforeEach(()=>{
  dir=mkdtempSync(path.join(tmpdir(),'fitting-social-test-'))
  dbPath=path.join(dir,'test.sqlite')
  auth=new AuthStore(dbPath);outfits=new SqliteUserDataRepository(dbPath);garments=new SqliteGarmentRepository(dbPath)
  for(const id of ['alice','bob','carol','outsider','creator'])auth.createUser({id,email:id+'@test.local',displayName:id,passwordHash:'test',passwordSalt:'test',createdAt:new Date().toISOString(),role:id==='creator'?'koc':'user'})
  social=new SocialStore(dbPath,outfits)
  social.snapshot('alice')
  for(const id of ['one','two'])outfits.saveOutfit('alice',{id,frontImageUrl:'/uploads/'+id+'.png',frontImageKey:id+'.png',backImageUrl:null,backImageKey:null,garmentIds:[],createdAt:new Date().toISOString()})
 })
 afterEach(()=>{vi.useRealTimers();social.close();auth.close();outfits.close();garments.close();rmSync(dir,{recursive:true,force:true})})
 const connect=(a:string,b:string)=>{
  const code=social.snapshot(b).me.inviteCode
  social.act(a,'request',{targetId:b,inviteCode:code})
  const req=social.snapshot(b).incoming.find(r=>r.from.id===a)!
  social.act(b,'request-response',{id:req.id,decision:'accept'})
 }
 const poll=()=>{
  connect('alice','bob');connect('alice','carol')
  return social.act('alice','poll-create',{outfitIds:['one','two'],recipientIds:['bob','carol'],hours:1,title:'Chọn giúp mình'}).polls[0]!
 }
 it('requires invite codes for unknown ages and protects private profile data',()=>{
  expect(social.snapshot('alice').me.defaultVisibility).toBe('private')
  expect(()=>social.act('bob','request',{targetId:'alice'})).toThrow()
  connect('alice','bob')
  const person=social.profile('bob','alice').person
  expect(person).not.toHaveProperty('birthDate');expect(person).not.toHaveProperty('inviteCode')
  expect(social.profile('bob','alice').outfits).toHaveLength(0)
  expect(()=>social.profile('outsider','alice')).toThrow()
 })
 it('applies the profile default visibility only when an outfit has no explicit policy',()=>{
  connect('alice','bob')
  expect(social.profile('bob','alice').outfits).toHaveLength(0)
  social.act('alice','settings',{username:'alice_style',invitePolicy:'known',defaultVisibility:'friends'})
  expect(social.profile('bob','alice').outfits).toHaveLength(2)
  social.act('alice','outfit-policy',{outfitId:'one',visibility:'private',groupIds:[]})
  expect(social.profile('bob','alice').outfits.map(outfit=>outfit.id)).toEqual(['two'])
 })
 it('only recipients vote; vote changes replace rather than accumulate',()=>{
  const p=poll()
  expect(social.snapshot('outsider').polls).toHaveLength(0)
  expect(()=>social.act('outsider','vote',{id:p.id,outfitId:'one'})).toThrow()
  social.act('bob','vote',{id:p.id,outfitId:'one'})
  expect(social.snapshot('carol').polls[0]!.votes).toHaveLength(0)
  social.act('bob','vote',{id:p.id,outfitId:'two'})
  social.act('carol','vote',{id:p.id,outfitId:'one'})
  expect(social.snapshot('bob').polls[0]!.votes).toHaveLength(2)
  expect(social.snapshot('alice').polls[0]!.votes.find(v=>v.user.id==='bob')?.outfitId).toBe('two')
 })
 it('revokes poll and media access on unfriend, even after reconnect',()=>{
  const p=poll()
  expect(social.canReadImage('bob','one.png')).toBe(true)
  expect(social.canReadImage('outsider','one.png')).toBe(false)
  social.act('alice','unfriend',{targetId:'bob'})
  expect(social.snapshot('bob').polls).toHaveLength(0)
  expect(social.canReadImage('bob','one.png')).toBe(false)
  connect('alice','bob')
  expect(()=>social.act('bob','vote',{id:p.id,outfitId:'one'})).toThrow()
 })
 it('blocks requests and removes notifications without notifying blocked user',()=>{
  poll();social.act('alice','block',{targetId:'bob'})
  expect(social.snapshot('bob').notifications).toHaveLength(0)
  expect(social.search('bob','user_alice')).toHaveLength(0)
  expect(()=>social.act('bob','request',{targetId:'alice',inviteCode:social.snapshot('alice').me.inviteCode})).toThrow()
 })
 it('searches by display name or username and ranks exact usernames first',()=>{
  auth.createUser({id:'viet',email:'viet@test.local',displayName:'Nguyễn Nam',passwordHash:'test',passwordSalt:'test',createdAt:new Date().toISOString()})
  social.snapshot('viet')
  social.act('alice','settings',{username:'alice_style',invitePolicy:'known'})
  social.act('carol','settings',{username:'alice_style_daily',invitePolicy:'known'})
  expect(social.search('bob','@ALICE_STYLE').map(person=>person.id)).toEqual(['alice','carol'])
  expect(social.search('bob','ice').map(person=>person.id)).toContain('alice')
  expect(social.search('bob','nguyen nam').map(person=>person.id)).toContain('viet')
  expect(social.search('alice','alice')).not.toContainEqual(expect.objectContaining({id:'alice'}))
  expect(social.search('bob','a')).toEqual([])
 })
 it('group membership gates media; leaving revokes access',()=>{
  connect('alice','bob');connect('alice','carol')
  const group=social.act('alice','group-save',{name:'Close',memberIds:['bob']}).groups[0]!
  social.act('alice','outfit-policy',{outfitId:'one',visibility:'groups',groupIds:[group.id]})
  expect(social.canReadImage('bob','one.png')).toBe(true)
  expect(social.canReadImage('carol','one.png')).toBe(false)
  expect(()=>social.act('bob','group-save',{id:group.id,name:'Steal',memberIds:[]})).toThrow()
  social.act('bob','group-leave',{id:group.id})
  expect(social.canReadImage('bob','one.png')).toBe(false)
 })
 it('expiration prevents votes and emits results once; owner saves winning outfit',()=>{
  const p=poll();social.act('bob','vote',{id:p.id,outfitId:'two'})
  expect(()=>social.act('alice','poll-winner',{id:p.id,outfitId:'two'})).toThrow()
  vi.useFakeTimers();vi.setSystemTime(p.expiresAt+1)
  expect(()=>social.act('bob','vote',{id:p.id,outfitId:'one'})).toThrow()
  const count=social.snapshot('bob').notifications.length
  expect(social.snapshot('bob').notifications).toHaveLength(count)
  expect(()=>social.act('alice','poll-winner',{id:p.id,outfitId:'one'})).toThrow()
  expect(social.act('alice','poll-winner',{id:p.id,outfitId:'two'}).policies.find(o=>o.outfitId==='two')?.official).toBe(true)
 })
 it('private reset and deletion revoke prior poll media access',()=>{
  poll()
  social.act('alice','outfit-policy',{outfitId:'one',visibility:'private'})
  expect(social.snapshot('bob').polls).toHaveLength(0)
  expect(social.canReadImage('bob','one.png')).toBe(false)
 })
 it('rejects more than 3 outfits, invalid audience and changes to others polls',()=>{
  const p=poll()
  expect(()=>social.act('alice','poll-create',{outfitIds:['one','two','three','four'],recipientIds:['bob'],hours:24})).toThrow()
  expect(()=>social.act('alice','poll-create',{outfitIds:['one'],recipientIds:['outsider'],hours:24})).toThrow()
  expect(()=>social.act('bob','poll-delete',{id:p.id})).toThrow()
 })
 it('stores reports and limits minor invitation settings',()=>{
  const result=social.act('alice','settings',{username:'alice_1',birthDate:'2015-01-01',invitePolicy:'everyone'})
  expect(result.me.invitePolicy).toBe('known')
  expect(()=>social.act('bob','report',{targetId:'alice',reason:'Unsafe content'})).not.toThrow()
  const code=result.me.inviteCode;social.act('alice','rotate-invite',{})
  expect(()=>social.resolveInvite('bob',code)).toThrow()
 })
 it('accepts only stored image URLs for avatars and grants authenticated image access',()=>{
  expect(()=>social.act('alice','settings',{username:'alice_style',avatar:'🌿',invitePolicy:'known'})).toThrow()
  social.act('alice','settings',{username:'alice_style',avatar:'/uploads/avatar.webp',invitePolicy:'known'})
  expect(social.canReadImage('bob','avatar.webp')).toBe(true)
 })
 it('applies post privacy to both the feed and protected image route',()=>{
  connect('alice','bob')
  social.act('alice','post-create',{imageUrls:['/uploads/private.webp'],caption:'Riêng tư',visibility:'private',groupIds:[]})
  expect(social.snapshot('bob').posts).toHaveLength(0)
  expect(social.canReadImage('bob','private.webp')).toBe(false)
  social.act('alice','post-create',{imageUrls:['/uploads/friends.webp'],caption:'Bạn bè',visibility:'friends',groupIds:[]})
  expect(social.snapshot('bob').posts.map(post=>post.caption)).toContain('Bạn bè')
  expect(social.canReadImage('bob','friends.webp')).toBe(true)
  expect(social.snapshot('outsider').posts).toHaveLength(0)
 })
 it('shows creator posts only after following',()=>{
  social.act('creator','post-create',{imageUrls:['/uploads/creator.webp'],caption:'Look mới',visibility:'public',groupIds:[]})
  expect(social.snapshot('alice').creatorFeed).toHaveLength(0)
  const followed=social.act('alice','follow',{targetId:'creator'})
  expect(followed.creatorFeed[0]?.caption).toBe('Look mới')
  expect(followed.creators.find(item=>item.person.id==='creator')?.followerCount).toBe(1)
  expect(social.canReadImage('alice','creator.webp')).toBe(true)
  const poll=social.act('creator','image-poll-create',{imageUrls:['/uploads/koc-a.webp','/uploads/koc-b.webp'],title:'Chọn look',hours:24,visibility:'public'}).polls[0]!
  expect(social.snapshot('alice').polls.some(item=>item.id===poll.id)).toBe(true)
  expect(()=>social.act('alice','vote',{id:poll.id,outfitId:poll.outfits[0]!.id})).not.toThrow()
 })
 it('creates a poll directly from uploaded images',()=>{
  connect('alice','bob')
  const result=social.act('alice','image-poll-create',{imageUrls:['/uploads/a.webp','/uploads/b.webp'],recipientIds:['bob'],title:'Chọn ảnh',hours:24,visibility:'friends'})
  const created=result.polls.find(item=>item.title==='Chọn ảnh')!
  expect(created.outfits.map(item=>item.frontImageUrl)).toEqual(['/uploads/a.webp','/uploads/b.webp'])
  expect(social.canReadImage('bob','a.webp')).toBe(true)
  expect(social.canReadImage('outsider','a.webp')).toBe(false)
 })
 it('removes orphaned social data when an account is deleted',()=>{
  social.act('creator','post-create',{imageUrls:['/uploads/deleted.webp'],caption:'Tài khoản cũ',visibility:'public',groupIds:[]})
  social.act('alice','follow',{targetId:'creator'})
  const cleanup=new Database(dbPath)
  cleanup.prepare('DELETE FROM users WHERE id = ?').run('creator')
  cleanup.close()
  const snapshot=social.snapshot('alice')
  expect(snapshot.creatorFeed).toEqual([])
  expect(snapshot.creators.some(item=>item.person.id==='creator')).toBe(false)
  expect(snapshot.followingIds).not.toContain('creator')
 })
})
