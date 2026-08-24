import { createHash } from 'node:crypto'

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024

export type SupportedMediaMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

export interface PutMediaInput {
  originalName: string
  mimeType: string
  bytes: Uint8Array
}

export interface StoredMediaObject {
  storageKey: string
  mimeType: SupportedMediaMime
  sizeBytes: number
  checksum: string
}

export interface MediaStoragePort {
  put(input: PutMediaInput): Promise<StoredMediaObject>
  read(storageKey: string): Promise<Uint8Array | undefined>
  remove(storageKey: string): Promise<boolean>
}

export type MediaStorageErrorCode =
  | 'INVALID_MEDIA'
  | 'MEDIA_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA'
  | 'STORAGE_KEY_CONFLICT'
  | 'STORAGE_UNAVAILABLE'

export class MediaStorageError extends Error {
  constructor(
    readonly code: MediaStorageErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MediaStorageError'
  }
}

const formats: Record<SupportedMediaMime, { extension: string; signature: (bytes: Uint8Array) => boolean }> = {
  'image/jpeg': { extension: 'jpg', signature: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/png': { extension: 'png', signature: (bytes) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value) },
  'image/webp': { extension: 'webp', signature: (bytes) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP' },
  'image/gif': { extension: 'gif', signature: (bytes) => ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6)) },
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end))
}

export function buildStoredMediaObject(input: PutMediaInput, createId: () => string): StoredMediaObject {
  if (!input.originalName.trim()) throw new MediaStorageError('INVALID_MEDIA', '原始文件名不能为空')
  if (input.bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaStorageError('MEDIA_TOO_LARGE', '文件不能超过 10 MiB')
  const format = formats[input.mimeType as SupportedMediaMime]
  if (!format) throw new MediaStorageError('UNSUPPORTED_MEDIA', '仅支持 JPEG、PNG、WebP 和 GIF')
  if (!format.signature(input.bytes)) throw new MediaStorageError('INVALID_MEDIA', '文件签名与媒体类型不匹配')
  const id = createId().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  if (!id || id.length > 160) throw new MediaStorageError('INVALID_MEDIA', '存储标识无效')
  const checksum = createHash('sha256').update(input.bytes).digest('hex').toUpperCase()
  const shard = createHash('sha256').update(id).digest('hex').slice(0, 2)
  return {
    storageKey: `${shard}/${id}.${format.extension}`,
    mimeType: input.mimeType as SupportedMediaMime,
    sizeBytes: input.bytes.byteLength,
    checksum,
  }
}

export function validateStorageKey(storageKey: string) {
  if (!/^[a-f0-9]{2}\/[a-z0-9-]+\.(?:jpg|png|webp|gif)$/.test(storageKey)) {
    throw new MediaStorageError('INVALID_MEDIA', '存储键无效')
  }
  return storageKey
}
