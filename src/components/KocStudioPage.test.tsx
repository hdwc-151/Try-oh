import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { socialApi } from '../services/social-api'
import { KocStudioPage } from './KocStudioPage'

vi.mock('../services/social-api',()=>({socialApi:{snapshot:vi.fn(),act:vi.fn()}}))
const user={id:'user-1',email:'user@example.com',displayName:'Nam',createdAt:'2026-01-01T00:00:00.000Z',role:'user' as const,status:'active' as const}
const snapshot={me:{id:'user-1',name:'Nam',username:'nam',avatar:'',birthDate:null,inviteCode:'code',invitePolicy:'known' as const,defaultVisibility:'private' as const},friends:[],incoming:[],outgoing:[],groups:[],polls:[],blocked:[],notifications:[],policies:[],posts:[],creatorFeed:[],followingIds:[],creators:[{person:{id:'koc-1',name:'KOC Lan',username:'lan',avatar:'',creator:true},following:false,followerCount:4}]}

describe('KocStudioPage',()=>{
  beforeEach(()=>{vi.mocked(socialApi.snapshot).mockResolvedValue(snapshot);vi.mocked(socialApi.act).mockResolvedValue({...snapshot,followingIds:['koc-1'],creators:[{...snapshot.creators[0],following:true}]})})
  it('shows creators and follows from the real social API',async()=>{
    render(<KocStudioPage user={user} onNavigate={vi.fn()}/>)
    expect(await screen.findByText('KOC Lan')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Theo dõi'}))
    expect(socialApi.act).toHaveBeenCalledWith('follow',{targetId:'koc-1'})
  })
})
