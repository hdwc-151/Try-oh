export const DEFAULT_IMAGE_CREDITS = 10
export const MAX_MANUAL_CREDITS = 1_000_000

export type CreditStatus = {
  remaining: number | null
  limit: number
  unlimited: boolean
}

export type CreditReservation = {
  amount: number
  charged: boolean
}
