import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PollCard, PollComposer } from './Voting'
import type { SocialSnapshot, SocialPoll } from '../../../server/social/types'
const me={id:'a',name:'An',username:'an_test',avatar:'🌿'}
const friend={id:'b',name:'Bình',username:'binh_test',avatar:'🌸'}
const outfits=[{id:'one',frontImageUrl:'/one.png',backImageUrl:null,official:false},{id:'two',frontImageUrl:'/two.png',backImageUrl:null,official:false}]
const data:SocialSnapshot={me:{...me,birthDate:null,inviteCode:'code',invitePolicy:'known',defaultVisibility:'private'},friends:[friend],incoming:[],outgoing:[],groups:[],polls:[],blocked:[],notifications:[],policies:[],posts:[],creatorFeed:[],creators:[],followingIds:[]}
const poll:SocialPoll={id:'poll',owner:me,title:'Đi chơi mặc gì?',createdAt:Date.now(),expiresAt:Date.now()+3600000,closed:false,outfits,recipients:[friend],votes:[],myVote:null,winnerId:null}
describe('Voting UI',()=>{
 it('requires outfit and audience; displays audience confirmation before POST',async()=>{
  const act=vi.fn().mockResolvedValue(true),done=vi.fn()
  render(<PollComposer data={data} outfits={outfits} act={act} onDone={done} onCreateOutfit={()=>{}}/>)
  expect(screen.getByRole('button',{name:'Xem lại người nhận'})).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox',{name:'Outfit 1'}))
  expect(screen.getByText('Đã chọn')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Tất cả bạn bè'}))
  fireEvent.click(screen.getByRole('button',{name:'Xem lại người nhận'}))
  expect(act).not.toHaveBeenCalled()
  expect(screen.getByText('Chỉ những người này được xem:')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Gửi bình chọn'}))
  await waitFor(()=>expect(done).toHaveBeenCalled())
  expect(act).toHaveBeenCalledWith('poll-create',{outfitIds:['one'],recipientIds:['b'],title:'',hours:24})
 })
 it('lets a voter change choices before expiration and shows voter identities',()=>{
  const act=vi.fn().mockResolvedValue(true)
  render(<PollCard poll={{...poll,myVote:'one',votes:[{user:friend,outfitId:'one'}]}} me="b" act={act} onZoom={()=>{}}/>)
  expect(screen.getByRole('button',{name:'✓ Đang chọn'})).toHaveAttribute('aria-pressed','true')
  expect(screen.getByTitle('binh_test')).toHaveTextContent('Bình')
  fireEvent.click(screen.getByRole('button',{name:'Chọn bộ này'}))
  expect(act).toHaveBeenCalledWith('vote',{id:'poll',outfitId:'two'})
 })
 it('closed polls do not allow voting',()=>{
  render(<PollCard poll={{...poll,closed:true}} me="b" act={vi.fn()} onZoom={()=>{}}/>)
  expect(screen.queryByRole('button',{name:'Chọn bộ này'})).not.toBeInTheDocument()
 })
})
