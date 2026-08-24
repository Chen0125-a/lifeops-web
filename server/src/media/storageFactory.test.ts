import { PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { FileSystemMediaStorage } from './fileSystemStorage.js'
import { createMediaStorage, type MediaStorageConfig } from './storageFactory.js'
import type { S3CommandClient } from './s3Storage.js'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])

describe('createMediaStorage', () => {
  it('creates filesystem storage rooted only under the configured path', () => {
    const storage = createMediaStorage({ backend: 'filesystem', root: 'data/private-media' })

    expect(storage).toBeInstanceOf(FileSystemMediaStorage)
    expect((storage as FileSystemMediaStorage).root).toBe('data/private-media')
  })

  it('passes validated endpoint settings and separate credentials to the S3 client', async () => {
    const sent: unknown[] = []
    const client: S3CommandClient = { send: vi.fn(async (command) => { sent.push(command); return {} }) }
    const createS3Client = vi.fn(() => client)
    const config: MediaStorageConfig = {
      backend: 's3',
      endpoint: 'https://objects.example.test',
      region: 'us-east-1',
      bucket: 'lifeops-media',
      forcePathStyle: true,
    }

    const storage = createMediaStorage(config, {
      credentials: { accessKeyId: 'key-id', secretAccessKey: 'separate-secret' },
      createS3Client,
      createId: () => '16891ea2-91c6-4b3b-80fd-59dd7bf2dc95',
    })
    await storage.put({ originalName: 'photo.png', mimeType: 'image/png', bytes: png })

    expect(createS3Client).toHaveBeenCalledWith({
      endpoint: 'https://objects.example.test/',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'key-id', secretAccessKey: 'separate-secret' },
    })
    expect(sent[0]).toBeInstanceOf(PutObjectCommand)
  })

  it.each([
    [{ backend: 's3', endpoint: 'ftp://objects.example.test', region: 'us-east-1', bucket: 'lifeops-media', forcePathStyle: true }, 'endpoint'],
    [{ backend: 's3', endpoint: 'https://user:secret@objects.example.test', region: 'us-east-1', bucket: 'lifeops-media', forcePathStyle: true }, 'endpoint'],
    [{ backend: 's3', endpoint: 'https://objects.example.test', region: '', bucket: 'lifeops-media', forcePathStyle: true }, 'region'],
    [{ backend: 's3', endpoint: 'https://objects.example.test', region: 'us-east-1', bucket: '', forcePathStyle: true }, 'bucket'],
  ])('rejects invalid S3 %s configuration instead of falling back to local disk', (config, field) => {
    expect(() => createMediaStorage(config as MediaStorageConfig)).toThrow(new RegExp(field, 'i'))
  })
})
