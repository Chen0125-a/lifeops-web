import { S3Client } from '@aws-sdk/client-s3'
import type { MediaStorageConfig } from '../config.js'
import { FileSystemMediaStorage } from './fileSystemStorage.js'
import type { MediaStoragePort } from './storagePort.js'
import { S3Storage, type S3CommandClient } from './s3Storage.js'

export type { MediaStorageConfig } from '../config.js'

export interface MediaStorageCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export interface MediaStorageFactoryOptions {
  credentials?: MediaStorageCredentials
  createS3Client?: (input: {
    endpoint: string
    region: string
    forcePathStyle: boolean
    credentials?: MediaStorageCredentials
  }) => S3CommandClient
  createId?: () => string
}

export function createMediaStorage(
  config: MediaStorageConfig,
  options: MediaStorageFactoryOptions = {},
): MediaStoragePort {
  if (config.backend === 'filesystem') {
    if (!config.root.trim()) throw new Error('filesystem root is required')
    return new FileSystemMediaStorage(config.root.trim(), { createId: options.createId })
  }
  const endpoint = normalizeEndpoint(config.endpoint)
  const region = required(config.region, 'region')
  const bucket = required(config.bucket, 'bucket')
  const clientConfig = {
    endpoint,
    region,
    forcePathStyle: config.forcePathStyle,
    ...(options.credentials ? { credentials: options.credentials } : {}),
  }
  const client = options.createS3Client?.(clientConfig) ?? (() => {
    const sdk = new S3Client(clientConfig)
    return { send: (command: unknown) => sdk.send(command as never) }
  })()
  return new S3Storage(client, { bucket, createId: options.createId })
}

function required(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`S3 ${field} is required`)
  return normalized
}

function normalizeEndpoint(value: string) {
  try {
    const parsed = new URL(required(value, 'endpoint'))
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('unsafe')
    return parsed.toString()
  } catch {
    throw new Error('S3 endpoint must be a credential-free HTTP or HTTPS URL')
  }
}
