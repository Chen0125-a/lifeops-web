export interface HttpRequestOptions {
  method?: string
  body?: unknown
  csrf?: string
  idempotencyKey?: string
  signal?: AbortSignal
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
    requestId?: string
    details?: unknown
  }
}

export class HttpError extends Error {
  readonly name = 'HttpError'

  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

function requestUrl(baseUrl: string, path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new HttpError('INVALID_REQUEST_PATH', '请求路径必须是站内绝对路径', 0)
  }
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined

  try {
    return JSON.parse(text) as unknown
  } catch (cause) {
    throw new HttpError(
      'INVALID_RESPONSE',
      '服务返回了无法解析的数据',
      response.status,
      response.headers.get('x-request-id') ?? undefined,
      undefined,
      { cause },
    )
  }
}

export class HttpClient {
  constructor(private readonly baseUrl = '/api/v1') {}

  async request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    let body: BodyInit | undefined

    if (options.body !== undefined) {
      if (options.body instanceof FormData) {
        body = options.body
      } else {
        headers['content-type'] = 'application/json'
        body = JSON.stringify(options.body)
      }
    }
    if (options.csrf) headers['x-csrf-token'] = options.csrf
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey

    let response: Response
    try {
      response = await fetch(requestUrl(this.baseUrl, path), {
        method: options.method ?? 'GET',
        credentials: 'same-origin',
        signal: options.signal,
        headers,
        body,
      })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      throw new HttpError('NETWORK_ERROR', '无法连接服务，请检查网络后重试', 0, undefined, undefined, { cause })
    }

    if (response.status === 204) return undefined as T

    const payload = await responsePayload(response)
    if (!response.ok) {
      const envelope = payload && typeof payload === 'object' ? payload as ErrorEnvelope : undefined
      const requestId = envelope?.error?.requestId
        ?? response.headers.get('x-request-id')
        ?? undefined
      throw new HttpError(
        envelope?.error?.code ?? 'REQUEST_FAILED',
        envelope?.error?.message ?? '请求失败，请稍后重试',
        response.status,
        requestId,
        envelope?.error?.details,
      )
    }

    return payload as T
  }
}

export const http = new HttpClient()
