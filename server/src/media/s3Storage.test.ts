import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { S3Storage, type S3CommandClient } from './s3Storage.js'
import { MAX_MEDIA_BYTES } from './storagePort.js'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])

function clientWith(handler: (command: unknown) => unknown | Promise<unknown>) {
  const sent: unknown[] = []
  const client: S3CommandClient = {
    async send(command) {
      sent.push(command)
      return handler(command)
    },
  }
  return { client, sent }
}

describe('S3Storage', () => {
  it('stores validated media under a random private key with content metadata', async () => {
    const fake = clientWith(() => ({}))
    const storage = new S3Storage(fake.client, {
      bucket: 'lifeops-media',
      createId: () => '16891ea2-91c6-4b3b-80fd-59dd7bf2dc95',
    })

    const stored = await storage.put({ originalName: '../private/photo.png', mimeType: 'image/png', bytes: png })

    expect(stored).toMatchObject({ mimeType: 'image/png', sizeBytes: png.byteLength })
    expect(stored.storageKey).toMatch(/^[a-f0-9]{2}\/[a-f0-9-]+\.png$/)
    expect(stored.storageKey).not.toContain('private')
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0]).toBeInstanceOf(PutObjectCommand)
    const input = (fake.sent[0] as PutObjectCommand).input
    expect(input).toMatchObject({
      Bucket: 'lifeops-media',
      Key: stored.storageKey,
      ContentType: 'image/png',
      ContentLength: png.byteLength,
      IfNoneMatch: '*',
    })
    expect(input).not.toHaveProperty('ACL', 'public-read')
    expect(new Uint8Array(input.Body as Uint8Array)).toEqual(png)
  })

  it('heads the object and uses a bounded range before returning bytes', async () => {
    const fake = clientWith((command) => {
      if (command instanceof HeadObjectCommand) return { ContentLength: png.byteLength }
      if (command instanceof GetObjectCommand) {
        return { Body: (async function* () { yield png.slice(0, 4); yield png.slice(4) })() }
      }
      throw new Error('unexpected command')
    })
    const storage = new S3Storage(fake.client, { bucket: 'lifeops-media' })

    await expect(storage.read('aa/object.png')).resolves.toEqual(png)

    expect(fake.sent[0]).toBeInstanceOf(HeadObjectCommand)
    expect((fake.sent[0] as HeadObjectCommand).input).toEqual({ Bucket: 'lifeops-media', Key: 'aa/object.png' })
    expect(fake.sent[1]).toBeInstanceOf(GetObjectCommand)
    expect((fake.sent[1] as GetObjectCommand).input).toMatchObject({
      Bucket: 'lifeops-media',
      Key: 'aa/object.png',
      Range: `bytes=0-${MAX_MEDIA_BYTES - 1}`,
    })
  })

  it('rejects oversized metadata without issuing a GetObject request', async () => {
    const fake = clientWith(() => ({ ContentLength: MAX_MEDIA_BYTES + 1 }))
    const storage = new S3Storage(fake.client, { bucket: 'lifeops-media' })

    await expect(storage.read('aa/large.png')).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' })
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0]).toBeInstanceOf(HeadObjectCommand)
  })

  it('maps a missing object to undefined and never leaks provider error credentials', async () => {
    const missing = clientWith(() => Promise.reject(Object.assign(new Error('not found'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    })))
    const unavailable = clientWith(() => Promise.reject(new Error('failed with secret-access-key')))

    await expect(new S3Storage(missing.client, { bucket: 'lifeops-media' }).read('aa/missing.png'))
      .resolves.toBeUndefined()
    await expect(new S3Storage(unavailable.client, { bucket: 'lifeops-media' }).read('aa/object.png'))
      .rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    await expect(new S3Storage(unavailable.client, { bucket: 'lifeops-media' }).read('aa/object.png'))
      .rejects.not.toThrow(/secret-access-key/)
  })

  it('checks existence and deletes an existing private object', async () => {
    const fake = clientWith((command) => command instanceof HeadObjectCommand ? { ContentLength: 1 } : {})
    const storage = new S3Storage(fake.client, { bucket: 'lifeops-media' })

    await expect(storage.remove('aa/object.png')).resolves.toBe(true)

    expect(fake.sent).toHaveLength(2)
    expect(fake.sent[1]).toBeInstanceOf(DeleteObjectCommand)
    expect((fake.sent[1] as DeleteObjectCommand).input).toEqual({ Bucket: 'lifeops-media', Key: 'aa/object.png' })
  })

  it('reuses the media size and MIME validation before sending anything', async () => {
    const fake = clientWith(vi.fn())
    const storage = new S3Storage(fake.client, { bucket: 'lifeops-media' })
    const oversized = new Uint8Array(MAX_MEDIA_BYTES + 1)
    oversized.set(png)

    await expect(storage.put({ originalName: 'large.png', mimeType: 'image/png', bytes: oversized }))
      .rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' })
    await expect(storage.put({ originalName: 'fake.png', mimeType: 'image/png', bytes: Uint8Array.from([1, 2, 3]) }))
      .rejects.toMatchObject({ code: 'INVALID_MEDIA' })
    expect(fake.sent).toHaveLength(0)
  })
})
