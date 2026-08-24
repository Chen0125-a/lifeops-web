const MAX_STRING_LENGTH = 2_048
const MAX_ARRAY_ITEMS = 100
const MAX_DEPTH = 8

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '')

function sensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return normalized === 'authorization'
    || normalized === 'proxyauthorization'
    || normalized === 'cookie'
    || normalized === 'setcookie'
    || normalized === 'password'
    || normalized === 'passwd'
    || normalized === 'body'
    || normalized === 'requestbody'
    || normalized === 'responsebody'
    || normalized.includes('token')
    || normalized.includes('secret')
    || normalized.includes('apikey')
}

function sensitiveAnnotation(key: string): boolean {
  return sensitiveKey(key) || key.toLowerCase().includes('last-applied-configuration')
}

function boundedString(value: string): string {
  return value.length <= MAX_STRING_LENGTH ? value : `${value.slice(0, MAX_STRING_LENGTH)}…`
}

function sanitizeValue(value: unknown, depth: number, parentKey = ''): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]'
  if (typeof value === 'string') return boundedString(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1))
  }
  if (!value || typeof value !== 'object') return String(value)

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    const isAnnotation = normalizeKey(parentKey) === 'annotations'
    if (sensitiveKey(key) || (isAnnotation && sensitiveAnnotation(key))) continue
    result[key] = sanitizeValue(nested, depth + 1, key)
  }
  return result
}

export function sanitizeLabels(labels: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const [key, value] of Object.entries(labels)) {
    if (sensitiveKey(key) || value === undefined || value === null || typeof value === 'object') continue
    sanitized[key] = boundedString(String(value))
  }
  return sanitized
}

export function sanitizeLogEvent(event: unknown): unknown {
  return sanitizeValue(event, 0)
}

export function sanitizeExternalError(_error: unknown): { code: string; message: string } {
  return {
    code: 'INTEGRATION_UPSTREAM_ERROR',
    message: 'External integration request failed',
  }
}
