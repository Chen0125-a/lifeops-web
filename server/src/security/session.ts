import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const createOpaqueToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const hashOpaqueToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 1) continue
    if (pair.slice(0, separator).trim() === name) return decodeURIComponent(pair.slice(separator + 1).trim())
  }
  return undefined
}

export function safeTokenEqual(first: string | undefined, second: string): boolean {
  if (!first) return false
  const left = Buffer.from(first)
  const right = Buffer.from(second)
  return left.length === right.length && timingSafeEqual(left, right)
}

