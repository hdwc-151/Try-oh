export type AuthUser = {
  id: string
  email: string
  displayName: string
  createdAt: string
  role: 'user' | 'koc' | 'moderator' | 'admin'
  status: 'active' | 'suspended'
  /** false: tài khoản chỉ đăng nhập bằng Google, chưa có mật khẩu Fitsy. */
  hasPassword?: boolean
}
