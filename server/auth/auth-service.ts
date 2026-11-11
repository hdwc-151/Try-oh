import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { AuthStore, PublicUser } from './auth-store.js'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64

export class AuthError extends Error {
  constructor(public readonly statusCode: number, public readonly publicMessage: string) {
    super(publicMessage)
  }
}

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly sessionDays = 30,
    private readonly legacyDataClaimToken?: string,
  ) {}

  async register(input: { email: string; displayName: string; password: string; legacyClaimToken?: string }): Promise<{ user: PublicUser; token: string; expiresAt: Date }> {
    const email = input.email.trim().toLowerCase()
    const displayName = input.displayName.trim()
    this.validate(email, displayName, input.password)
    if (this.store.findUserByEmail(email)) throw new AuthError(409, 'Email này đã được sử dụng.')

    const isFirstUser = this.store.countUsers() === 0
    const salt = randomBytes(16).toString('hex')
    const passwordHash = await this.hashPassword(input.password, salt)
    const user = this.store.createUser({
      id: randomUUID(),
      email,
      displayName,
      passwordHash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
    })
    if (isFirstUser && this.isValidLegacyClaimToken(input.legacyClaimToken)) {
      this.store.claimLegacyData(user.id)
    }
    const session = this.createSession(user.id)
    return { user, ...session }
  }

  async login(emailInput: string, password: string): Promise<{ user: PublicUser; token: string; expiresAt: Date }> {
    const email = emailInput.trim().toLowerCase()
    const user = this.store.findUserByEmail(email)
    if (!user) {
      await this.hashPassword(password || 'invalid-password', randomBytes(16).toString('hex'))
      throw new AuthError(401, 'Email hoặc mật khẩu không đúng.')
    }
    const actual = Buffer.from(await this.hashPassword(password, user.passwordSalt), 'hex')
    const expected = Buffer.from(user.passwordHash, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AuthError(401, 'Email hoặc mật khẩu không đúng.')
    }
    const { passwordHash: _hash, passwordSalt: _salt, ...publicUser } = user
    const session = this.createSession(user.id)
    return { user: publicUser, ...session }
  }

  authenticate(token: string | null): PublicUser | null {
    if (!token) return null
    return this.store.findUserBySession(this.hashToken(token))
  }

  logout(token: string | null): void {
    if (token) this.store.deleteSession(this.hashToken(token))
  }

  async updateProfile(userId: string, input: { displayName: string }): Promise<PublicUser> {
    const displayName = input.displayName.trim()
    if (displayName.length < 2 || displayName.length > 50) {
      throw new AuthError(400, 'Tên hiển thị phải từ 2 đến 50 ký tự.')
    }
    const user = this.store.findUserById(userId)
    if (!user) throw new AuthError(404, 'Không tìm thấy người dùng.')
    return this.store.updateDisplayName(userId, displayName)
  }

  async changeEmail(userId: string, input: { newEmail: string; password: string }): Promise<PublicUser> {
    const newEmail = input.newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 254) {
      throw new AuthError(400, 'Email không hợp lệ.')
    }
    const existingUser = this.store.findUserByEmail(newEmail)
    if (existingUser && existingUser.id !== userId) {
      throw new AuthError(409, 'Email này đã được sử dụng.')
    }
    const user = this.store.findUserWithSecretsById(userId)
    if (!user) throw new AuthError(404, 'Không tìm thấy người dùng.')

    const actual = Buffer.from(await this.hashPassword(input.password, user.passwordSalt), 'hex')
    const expected = Buffer.from(user.passwordHash, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AuthError(400, 'Mật khẩu xác nhận không đúng.')
    }

    return this.store.updateEmail(userId, newEmail)
  }

  async changePassword(userId: string, input: { currentPassword: string; newPassword: string }): Promise<void> {
    if (input.newPassword.length < 8 || input.newPassword.length > 128) {
      throw new AuthError(400, 'Mật khẩu mới phải từ 8 đến 128 ký tự.')
    }
    const user = this.store.findUserWithSecretsById(userId)
    if (!user) throw new AuthError(404, 'Không tìm thấy người dùng.')

    const actual = Buffer.from(await this.hashPassword(input.currentPassword, user.passwordSalt), 'hex')
    const expected = Buffer.from(user.passwordHash, 'hex')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new AuthError(400, 'Mật khẩu hiện tại không đúng.')
    }

    const newSalt = randomBytes(16).toString('hex')
    const newPasswordHash = await this.hashPassword(input.newPassword, newSalt)
    this.store.updatePassword(userId, newPasswordHash, newSalt)
  }

  async deleteAccount(userId: string): Promise<void> {
    this.store.deleteUser(userId)
  }

  private validate(email: string, displayName: string, password: string): void {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new AuthError(400, 'Email không hợp lệ.')
    }
    if (displayName.length < 2 || displayName.length > 50) {
      throw new AuthError(400, 'Tên hiển thị phải từ 2 đến 50 ký tự.')
    }
    if (password.length < 8 || password.length > 128) {
      throw new AuthError(400, 'Mật khẩu phải từ 8 đến 128 ký tự.')
    }
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    return Buffer.from(await scrypt(password, salt, KEY_LENGTH) as ArrayBuffer).toString('hex')
  }

  private createSession(userId: string): { token: string; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + this.sessionDays * 24 * 60 * 60 * 1000)
    this.store.deleteExpiredSessions()
    this.store.createSession(this.hashToken(token), userId, expiresAt.toISOString())
    return { token, expiresAt }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private isValidLegacyClaimToken(candidate: string | undefined): boolean {
    if (!candidate || !this.legacyDataClaimToken) return false
    const expected = Buffer.from(createHash('sha256').update(this.legacyDataClaimToken).digest())
    const actual = Buffer.from(createHash('sha256').update(candidate).digest())
    return timingSafeEqual(actual, expected)
  }
}
