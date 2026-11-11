import type { PublicUser } from '../auth/auth-store.js'

declare global {
  namespace Express {
    interface Request {
      authUser: PublicUser
    }
  }
}

export {}

