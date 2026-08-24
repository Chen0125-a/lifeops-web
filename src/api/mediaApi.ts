import type { MediaAsset, UploadStatus } from '../domain/records'
import { http } from './httpClient'

export interface UploadMediaOptions {
  idempotencyKey: string
  csrf?: string
  signal?: AbortSignal
  onStatus?: (status: UploadStatus) => void
}

export const mediaApi = {
  async upload(file: File, options: UploadMediaOptions): Promise<MediaAsset> {
    options.onStatus?.('queued')
    const body = new FormData()
    body.set('file', file)
    options.onStatus?.('uploading')
    try {
      const asset = await http.request<MediaAsset>('/media', {
        method: 'POST', body, csrf: options.csrf, idempotencyKey: options.idempotencyKey, signal: options.signal,
      })
      options.onStatus?.('stored')
      return asset
    } catch (error) {
      options.onStatus?.('failed')
      throw error
    }
  },
  privateUrl: (id: string) => `/api/v1/media/${encodeURIComponent(id)}`,
  publicUrl: (id: string) => `/api/v1/public/media/${encodeURIComponent(id)}`,
}

export async function withMediaPreview<T>(file: File, inspect: (url: string) => T | Promise<T>): Promise<T> {
  const url = URL.createObjectURL(file)
  try {
    return await inspect(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}
