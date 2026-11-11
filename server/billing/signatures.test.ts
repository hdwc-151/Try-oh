import { describe, expect, it } from 'vitest'
import { hmacSha256, payosDataString, secureSignatureEqual } from './signatures.js'

describe('payment signatures', () => {
  it('sorts payOS fields before signing', () => {
    expect(payosDataString({ orderCode: 12, amount: 89000, description: 'FITSY PLUS' }))
      .toBe('amount=89000&description=FITSY PLUS&orderCode=12')
  })

  it('compares HMAC signatures without accepting malformed values', () => {
    const signature = hmacSha256('secret', 'amount=89000')
    expect(secureSignatureEqual(signature, signature)).toBe(true)
    expect(secureSignatureEqual(signature, signature.slice(1))).toBe(false)
    expect(secureSignatureEqual(signature, null)).toBe(false)
  })
})
