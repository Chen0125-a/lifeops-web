import { randomUUID } from 'node:crypto'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import {
  buildStoredMediaObject,
  MAX_MEDIA_BYTES,
  MediaStorageError,
  validateStorageKey,
  type MediaStoragePort,
  type PutMediaInput,
} from './storagePort.js'

export interface S3CommandClient {
  send(command: unknown): Promise<unknown>
}

export interface S3StorageOptions {
  bucket: string
  createId?: () => string
}

export class S3Storage implements MediaStoragePort {
  private readonly createId: () => string

  constructor(
    readonly client: S3CommandClient,
    readonly options: S3StorageOptions,
  ) {
    this.createId = options.createId ?? randomUUID
  }

  async put(input: PutMediaInput) {
    const stored = buildStoredMediaObject(input, this.createId)
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: stored.storageKey,
        Body: input.bytes,
        ContentType: stored.mimeType,
        ContentLength: stored.sizeBytes,
        IfNoneMatch: '*',
      }))
      return stored
    } catch (error) {
      if (isConflict(error)) throw new MediaStorageError('STORAGE_KEY_CONFLICT', '存储键冲突')
      throw unavailable()
    }
  }

  async read(storageKey: string): Promise<Uint8Array | undefined> {
    validateStorageKey(storageKey)
    try {
      const head = await this.client.send(new HeadObjectCommand({
        Bucket: this.options.bucket,
        Key: storageKey,
      })) as { ContentLength?: number }
      if (typeof head.ContentLength === 'number' && head.ContentLength > MAX_MEDIA_BYTES) {
        throw new MediaStorageError('MEDIA_TOO_LARGE', '媒体对象超过 10 MiB 响应上限')
      }
      const output = await this.client.send(new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: storageKey,
        Range: `bytes=0-${MAX_MEDIA_BYTES - 1}`,
      })) as { Body?: unknown }
      return await boundedBody(output.Body)
    } catch (error) {
      if (error instanceof MediaStorageError) throw error
      if (isMissing(error)) return undefined
      throw unavailable()
    }
  }

  async remove(storageKey: string): Promise<boolean> {
    validateStorageKey(storageKey)
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: storageKey }))
      await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: storageKey }))
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw unavailable()
    }
  }
}

function isMissing(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return candidate.$metadata?.httpStatusCode === 404 || ['NoSuchKey', 'NotFound'].includes(String(candidate.name))
}

function isConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } }
  return candidate.$metadata?.httpStatusCode === 409 || candidate.$metadata?.httpStatusCode === 412
    || ['PreconditionFailed', 'ConditionalRequestConflict'].includes(String(candidate.name))
}

function unavailable() {
  return new MediaStorageError('STORAGE_UNAVAILABLE', '媒体存储暂时不可用')
}

async function boundedBody(body: unknown): Promise<Uint8Array> {
  if (!body) throw unavailable()
  if (body instanceof Uint8Array) {
    if (body.byteLength > MAX_MEDIA_BYTES) throw new MediaStorageError('MEDIA_TOO_LARGE', '媒体对象超过 10 MiB 响应上限')
    return body
  }
  if (typeof body === 'object' && 'transformToByteArray' in body && typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray() as Uint8Array
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new MediaStorageError('MEDIA_TOO_LARGE', '媒体对象超过 10 MiB 响应上限')
    return bytes
  }
  if (typeof body === 'object' && Symbol.asyncIterator in body) {
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
      size += bytes.byteLength
      if (size > MAX_MEDIA_BYTES) throw new MediaStorageError('MEDIA_TOO_LARGE', '媒体对象超过 10 MiB 响应上限')
      chunks.push(bytes)
    }
    const result = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }
  throw unavailable()
}
