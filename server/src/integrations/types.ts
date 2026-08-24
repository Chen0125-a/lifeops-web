export interface IntegrationAuth {
  bearerToken?: string
  bearerTokenFile?: string
  caFile?: string
  basic?: { username: string; password: string }
}

export interface IntegrationConfig {
  enabled: boolean
  baseUrl: string | null
  timeoutMs: number
  maxResponseBytes: number
  deepLinkUrl: string | null
  auth: IntegrationAuth
  toJSON?: () => { enabled: boolean; deepLinkUrl: string | null }
}

export type PlatformSourceState = 'connected' | 'degraded' | 'disconnected' | 'disabled' | 'unknown'

export interface PlatformSourceStatus {
  source: string
  state: PlatformSourceState
  checkedAt: string | null
  latencyMs: number | null
  message: string
}

export interface SafeIntegrationFetchOptions {
  query?: Record<string, string | number | boolean | null | undefined>
  trustedQuery?: Record<string, string | number | boolean | null | undefined>
  method?: 'GET' | 'POST'
  jsonBody?: unknown
  signal?: AbortSignal
}

export class IntegrationRequestError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'IntegrationRequestError'
    this.code = code
  }
}
