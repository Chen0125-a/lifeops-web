import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSystemMediaStorage } from './fileSystemStorage.js'
import { MAX_MEDIA_BYTES } from './storagePort.js'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x01])
const gif = new TextEncoder().encode('GIF89a-content')
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
])

describe('FileSystemMediaStorage', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lifeops-media-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('generates random shard keys and never uses the client path', async () => {
    let sequence = 0
    const storage = new FileSystemMediaStorage(root, { createId: () => `asset-${++sequence}` })

    const first = await storage.put({ originalName: '../private/x.png', mimeType: 'image/png', bytes: png })
    const second = await storage.put({ originalName: 'x.png', mimeType: 'image/png', bytes: png })

    expect(first.storageKey).toMatch(/^[a-f0-9]{2}\/[a-z0-9-]+\.png$/)
    expect(second.storageKey).not.toBe(first.storageKey)
    expect(first.storageKey).not.toContain('..')
    expect(first.storageKey).not.toContain('private')
  })

  it.each([
    ['image/jpeg', 'photo.jpg', jpeg, '.jpg'],
    ['image/png', 'photo.png', png, '.png'],
    ['image/webp', 'photo.webp', webp, '.webp'],
    ['image/gif', 'photo.gif', gif, '.gif'],
  ])('accepts %s only when its binary signature matches', async (mimeType, originalName, bytes, extension) => {
    const storage = new FileSystemMediaStorage(root, { createId: () => 'signature-asset' })

    const stored = await storage.put({ originalName, mimeType, bytes })

    expect(stored).toMatchObject({ mimeType, sizeBytes: bytes.byteLength })
    expect(stored.storageKey.endsWith(extension)).toBe(true)
    expect(await storage.read(stored.storageKey)).toEqual(bytes)
  })

  it('rejects a MIME/signature mismatch and all SVG input', async () => {
    const storage = new FileSystemMediaStorage(root)

    await expect(storage.put({ originalName: 'fake.png', mimeType: 'image/png', bytes: jpeg }))
      .rejects.toMatchObject({ code: 'INVALID_MEDIA' })
    await expect(storage.put({
      originalName: 'vector.svg',
      mimeType: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' })
  })

  it('rejects content larger than 10 MiB before creating a file', async () => {
    const storage = new FileSystemMediaStorage(root)
    const oversized = new Uint8Array(MAX_MEDIA_BYTES + 1)
    oversized.set(png)

    await expect(storage.put({ originalName: 'large.png', mimeType: 'image/png', bytes: oversized }))
      .rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' })
    expect(await readdir(root)).toEqual([])
  })

  it('returns undefined for a missing safe key and rejects traversal keys', async () => {
    const storage = new FileSystemMediaStorage(root)

    await expect(storage.read('aa/missing.png')).resolves.toBeUndefined()
    await expect(storage.read('../outside.png')).rejects.toMatchObject({ code: 'INVALID_MEDIA' })
  })

  it('uses exclusive final writes so a collision cannot overwrite stored bytes', async () => {
    const storage = new FileSystemMediaStorage(root, { createId: () => 'fixed-asset' })
    const stored = await storage.put({ originalName: 'first.png', mimeType: 'image/png', bytes: png })

    await expect(storage.put({ originalName: 'second.png', mimeType: 'image/png', bytes: Uint8Array.from([...png, 0x02]) }))
      .rejects.toMatchObject({ code: 'STORAGE_KEY_CONFLICT' })
    expect(await storage.read(stored.storageKey)).toEqual(png)
  })
})
