import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '../../services/admin-api'
import { AdminPage } from './AdminPage'

vi.mock('../../services/admin-api',()=>({adminApi:{summary:vi.fn(),users:vi.fn(),audit:vi.fn(),updateUser:vi.fn(),moderationReports:vi.fn(),resolveModerationReport:vi.fn()}}))

const admin={id:'admin',email:'owner@example.com',displayName:'Owner',createdAt:'2026-01-01T00:00:00.000Z',role:'admin' as const,status:'active' as const,creditBalance:10,subscriptionPlan:'free' as const}
const member={id:'member',email:'member@example.com',displayName:'Member',createdAt:'2026-01-02T00:00:00.000Z',lastSeenAt:null,role:'user' as const,status:'active' as const,creditBalance:10,subscriptionPlan:'free' as const}

describe('AdminPage',()=>{
  beforeEach(()=>{
    vi.mocked(adminApi.summary).mockResolvedValue({users:2,activeUsers:2,suspendedUsers:0,kocUsers:0,moderators:0,admins:1})
    vi.mocked(adminApi.users).mockResolvedValue([{...admin,lastSeenAt:null},member])
    vi.mocked(adminApi.audit).mockResolvedValue([])
    vi.mocked(adminApi.moderationReports).mockResolvedValue([])
    vi.mocked(adminApi.updateUser).mockResolvedValue({...member,role:'koc'})
  })

  it('loads real admin data and updates another user role',async()=>{
    render(<AdminPage user={admin} onNavigate={vi.fn()}/>)
    expect(await screen.findByText('Tổng người dùng')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Người dùng'}))
    const roleSelect=await screen.findByRole('combobox',{name:'Role của member@example.com'})
    fireEvent.change(roleSelect,{target:{value:'koc'}})
    await waitFor(()=>expect(adminApi.updateUser).toHaveBeenCalledWith('member',{role:'koc'}))
  })

  it('does not call admin APIs for an ordinary account',async()=>{
    vi.clearAllMocks()
    render(<AdminPage user={{...admin,role:'user'}} onNavigate={vi.fn()}/>)
    expect(screen.getByText('Không có quyền truy cập')).toBeInTheDocument()
    await new Promise(resolve=>setTimeout(resolve,0))
    expect(adminApi.summary).not.toHaveBeenCalled()
  })

  it('lets an admin set the remaining credits of a user',async()=>{
    render(<AdminPage user={admin} onNavigate={vi.fn()}/>)
    fireEvent.click(await screen.findByRole('button',{name:'Người dùng'}))
    const input=await screen.findByRole('spinbutton',{name:'Credit của member@example.com'})
    fireEvent.change(input,{target:{value:'4'}})
    fireEvent.click(screen.getByRole('button',{name:'Lưu credit của member@example.com'}))
    await waitFor(()=>expect(adminApi.updateUser).toHaveBeenCalledWith('member',{creditBalance:4}))
  })
})
