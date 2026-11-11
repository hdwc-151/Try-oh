import { createHmac, timingSafeEqual } from 'node:crypto'

export const hmacSha256 = (secret: string, value: string) =>
  createHmac('sha256', secret).update(value).digest('hex')

export const secureSignatureEqual = (expected: string, received: unknown): boolean => {
  if (typeof received !== 'string' || expected.length !== received.length) return false
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'))
}

const payosValue = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export const payosDataString = (data: Record<string, unknown>): string =>
  Object.keys(data).sort().map((key) => key + '=' + payosValue(data[key])).join('&')

