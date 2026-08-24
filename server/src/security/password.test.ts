import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('password hashing', () => {
  it('uses a random salt and verifies without exposing the source password', async () => {
    const first = await hashPassword('a-long-enough-password')
    const second = await hashPassword('a-long-enough-password')

    expect(first).not.toBe(second)
    expect(first).not.toContain('a-long-enough-password')
    await expect(verifyPassword('a-long-enough-password', first)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', first)).resolves.toBe(false)
  })

  it('fails closed for malformed stored hashes', async () => {
    await expect(verifyPassword('anything', 'not-a-password-hash')).resolves.toBe(false)
  })
})

