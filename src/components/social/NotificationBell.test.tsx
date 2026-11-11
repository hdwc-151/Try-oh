import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { socialApi } from '../../services/social-api'
import { NotificationBell } from './NotificationBell'

vi.mock('../../services/social-api', () => ({
  socialApi: {
    snapshot: vi.fn(),
    act: vi.fn(),
  },
}))

const snapshot = {
  me: { id: 'me', name: 'An', username: 'an', avatar: '🌿', birthDate: null, inviteCode: 'code', invitePolicy: 'known' as const, defaultVisibility: 'private' as const },
  friends: [], incoming: [], outgoing: [], groups: [], polls: [], blocked: [], policies: [], posts: [], creatorFeed: [], creators: [], followingIds: [],
  notifications: [
    { id: 'new', kind: 'request' as const, text: 'Bình gửi lời mời kết bạn', targetId: 'request', read: false, createdAt: 1_700_000_000_000 },
    { id: 'read', kind: 'poll' as const, text: 'Lan muốn xin ý kiến bạn', targetId: 'poll', read: true, createdAt: 1_700_000_100_000 },
  ],
}

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.mocked(socialApi.snapshot).mockResolvedValue(snapshot)
    vi.mocked(socialApi.act).mockResolvedValue(snapshot)
  })

  it('opens a list below the bell and closes on outside click', async () => {
    render(<NotificationBell />)
    const bell = await screen.findByRole('button', { name: 'Thông báo bạn bè, 1 chưa đọc' })
    fireEvent.click(bell)
    expect(await screen.findByRole('dialog', { name: 'Danh sách thông báo' })).toBeInTheDocument()
    expect(screen.getByText('Bình gửi lời mời kết bạn')).toBeInTheDocument()
    expect(screen.getByText('Lan muốn xin ý kiến bạn')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Danh sách thông báo' })).not.toBeInTheDocument()
  })

  it('marks every notification as read from the dropdown', async () => {
    render(<NotificationBell />)
    fireEvent.click(await screen.findByRole('button', { name: 'Thông báo bạn bè, 1 chưa đọc' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Đã đọc hết' }))
    await waitFor(() => expect(socialApi.act).toHaveBeenCalledWith('notification-read', {}))
    expect(screen.getByText('0 thông báo chưa đọc')).toBeInTheDocument()
  })
})
