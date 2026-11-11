import { describe, expect, it } from 'vitest'
import { AuthService } from './auth-service.js'
import { AuthStore } from './auth-store.js'

describe('AuthService', () => {
  it('đăng ký, tạo session và xác thực bằng token', async () => {
    const store = new AuthStore(':memory:')
    const auth = new AuthService(store, 30)
    const result = await auth.register({
      displayName: 'Nguyễn An',
      email: 'AN@Example.com',
      password: 'mat-khau-an-toan',
    })

    expect(result.user.email).toBe('an@example.com')
    expect(auth.authenticate(result.token)?.id).toBe(result.user.id)
    auth.logout(result.token)
    expect(auth.authenticate(result.token)).toBeNull()
    store.close()
  })

  it('đăng nhập đúng mật khẩu và từ chối mật khẩu sai', async () => {
    const store = new AuthStore(':memory:')
    const auth = new AuthService(store)
    await auth.register({ displayName: 'Minh Anh', email: 'minh@example.com', password: 'password-123' })

    await expect(auth.login('minh@example.com', 'password-123')).resolves.toHaveProperty('token')
    await expect(auth.login('minh@example.com', 'wrong-password')).rejects.toMatchObject({
      statusCode: 401,
    })
    store.close()
  })

  it('không cho đăng ký email trùng hoặc mật khẩu ngắn', async () => {
    const store = new AuthStore(':memory:')
    const auth = new AuthService(store)
    await auth.register({ displayName: 'User One', email: 'user@example.com', password: 'password-123' })

    await expect(auth.register({ displayName: 'User Two', email: 'USER@example.com', password: 'password-456' })).rejects.toMatchObject({ statusCode: 409 })
    await expect(auth.register({ displayName: 'User Two', email: 'other@example.com', password: 'short' })).rejects.toMatchObject({ statusCode: 400 })
    store.close()
  })

  it('cập nhật tên hiển thị hợp lệ và từ chối tên quá ngắn/dài', async () => {
    const store = new AuthStore(':memory:')
    const auth = new AuthService(store)
    const { user } = await auth.register({ displayName: 'Lan Anh', email: 'lan@example.com', password: 'password-123' })

    const updated = await auth.updateProfile(user.id, { displayName: 'Lan Anh Nguyễn' })
    expect(updated.displayName).toBe('Lan Anh Nguyễn')

    await expect(auth.updateProfile(user.id, { displayName: 'L' })).rejects.toMatchObject({ statusCode: 400 })
    store.close()
  })

  it('đổi email thành công khi đúng mật khẩu và từ chối khi sai mật khẩu hoặc trùng email', async () => {
    const store = new AuthStore(':memory:')
    const auth = new AuthService(store)
    const { user: user1 } = await auth.register({ displayName: 'User 1', email: 'user1@example.com', password: 'password-123' })
    await auth.register({ displayName: 'User 2', email: 'user2@example.com', password: 'password-123' })

    // Sai mật khẩu
    await expect(auth.changeEmail(user1.id, { newEmail: 'new@example.com', password: 'wrong' })).rejects.toMatchObject({ statusCode: 400 })
    // Trùng email
    await expect(auth.changeEmail(user1.id, { newEmail: 'user2@example.com', password: 'password-123' })).rejects.toMatchObject({ statusCode: 409 })
    // Thành công
    const updated = await auth.changeEmail(user1.id, { newEmail: 'lan.new@example.com', password: 'password-123' })
    expect(updated.email).toBe('lan.new@example.com')
    store.close()
  })

  it('đổi mật khẩu thành công và từ chối khi mật khẩu cũ không đúng', async () => {
    const store = new AuthStore(':memory:')
    const auth = new AuthService(store)
    const { user } = await auth.register({ displayName: 'Huy', email: 'huy@example.com', password: 'old-password-123' })

    // Sai mật khẩu cũ
    await expect(auth.changePassword(user.id, { currentPassword: 'wrong-password', newPassword: 'new-password-456' })).rejects.toMatchObject({ statusCode: 400 })

    // Mật khẩu mới quá ngắn
    await expect(auth.changePassword(user.id, { currentPassword: 'old-password-123', newPassword: 'short' })).rejects.toMatchObject({ statusCode: 400 })

    // Đổi mật khẩu thành công
    await auth.changePassword(user.id, { currentPassword: 'old-password-123', newPassword: 'new-password-456' })

    // Đăng nhập bằng mật khẩu mới
    await expect(auth.login('huy@example.com', 'new-password-456')).resolves.toHaveProperty('token')
    // Mật khẩu cũ không còn dùng được
    await expect(auth.login('huy@example.com', 'old-password-123')).rejects.toMatchObject({ statusCode: 401 })
    store.close()
  })
})
