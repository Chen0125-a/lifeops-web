import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import {
  buildStoredMediaObject,
  MediaStorageError,
  type MediaStoragePort,
  type PutMediaInput,
  validateStorageKey,
} from './storagePort.js'

function storagePath(root: string, storageKey: string) {
  validateStorageKey(storageKey)
  const normalizedRoot = resolve(root)
  const target = resolve(normalizedRoot, ...storageKey.split('/'))
  if (!target.startsWith(`${normalizedRoot}${sep}`)) throw new MediaStorageError('INVALID_MEDIA', '存储键越界')
  return target
}

export class FileSystemMediaStorage implements MediaStoragePort {
  private readonly createId: () => string

  constructor(
    readonly root: string,
    options: { createId?: () => string } = {},
  ) {
    this.createId = options.createId ?? randomUUID
  }

  async put(input: PutMediaInput) {
    const stored = buildStoredMediaObject(input, this.createId)
    const target = storagePath(this.root, stored.storageKey)
    await mkdir(resolve(this.root, stored.storageKey.slice(0, 2)), { recursive: true })
    let handle
    try {
      handle = await open(target, 'wx')
      await handle.writeFile(input.bytes)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'EEXIST') {
        throw new MediaStorageError('STORAGE_KEY_CONFLICT', '存储键冲突')
      }
      if (handle) await rm(target, { force: true }).catch(() => undefined)
      throw error
    } finally {
      await handle?.close()
    }
    return stored
  }

  async read(storageKey: string) {
    const target = storagePath(this.root, storageKey)
    try {
      return new Uint8Array(await readFile(target))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return undefined
      throw error
    }
  }

  async remove(storageKey: string) {
    const target = storagePath(this.root, storageKey)
    try {
      await rm(target)
      return true
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT') return false
      throw error
    }
  }
}
