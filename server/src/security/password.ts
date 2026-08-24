import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const KEY_LENGTH = 64
const FORMAT = 'scrypt-v1'

export type PasswordPolicyIssue = 'length' | 'uppercase' | 'lowercase' | 'number' | 'symbol'

export function passwordPolicyIssues(password: string): PasswordPolicyIssue[] {
  const issues: PasswordPolicyIssue[] = []
  if (password.length < 12 || password.length > 512) issues.push('length')
  if (!/\p{Lu}/u.test(password)) issues.push('uppercase')
  if (!/\p{Ll}/u.test(password)) issues.push('lowercase')
  if (!/\p{N}/u.test(password)) issues.push('number')
  if (!/[^\p{L}\p{N}\s]/u.test(password)) issues.push('symbol')
  return issues
}

export function assertPasswordPolicy(password: string) {
  const issues = passwordPolicyIssues(password)
  if (issues.length) throw new Error(`密码不符合策略：${issues.join(', ')}`)
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error('密码至少需要 12 个字符')
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer
  return [FORMAT, salt.toString('base64url'), derived.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [format, encodedSalt, encodedHash, extra] = stored.split('$')
    if (format !== FORMAT || !encodedSalt || !encodedHash || extra) return false
    const salt = Buffer.from(encodedSalt, 'base64url')
    const expected = Buffer.from(encodedHash, 'base64url')
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return false
    const actual = await scrypt(password, salt, expected.length) as Buffer
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
