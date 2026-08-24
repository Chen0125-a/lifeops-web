import { describe, expect, it, vi } from 'vitest'
import {
  FileSystemVaultAdapter,
  applyVaultBatch,
  connectFileSystemVault,
  type DirectoryHandleLike,
} from './fileSystemVault'
import type { VaultAdapter } from './types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class FakeFileHandle {
  readonly kind = 'file' as const
  bytes = new Uint8Array()

  constructor(
    readonly name: string,
    private parent: FakeDirectoryHandle,
    private operations: string[],
  ) {}

  async getFile() {
    const bytes = this.bytes.slice()
    return { arrayBuffer: async () => bytes.buffer }
  }

  async createWritable() {
    this.operations.push(`open:${this.name}`)
    return {
      write: async (bytes: Uint8Array) => {
        this.operations.push(`write:${this.name}`)
        this.bytes = bytes.slice()
      },
      close: async () => {
        this.operations.push(`close:${this.name}`)
      },
    }
  }

  async move(destination: FakeDirectoryHandle, name: string) {
    this.operations.push(`move:${this.name}->${name}`)
    this.parent.entries.delete(this.name)
    destination.entries.set(name, this)
    this.parent = destination
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory' as const
  readonly entries = new Map<string, FakeDirectoryHandle | FakeFileHandle>()
  readonly operations: string[]
  createdDirectories = 0
  createdFiles = 0

  constructor(
    readonly name: string,
    readonly permission: PermissionState = 'granted',
    operations: string[] = [],
  ) {
    this.operations = operations
  }

  async queryPermission() {
    return this.permission
  }

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const found = this.entries.get(name)
    if (found instanceof FakeDirectoryHandle) return found
    if (found || !options.create) throw new DOMException('Missing directory', 'NotFoundError')
    this.createdDirectories += 1
    const directory = new FakeDirectoryHandle(name, this.permission, this.operations)
    this.entries.set(name, directory)
    return directory
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    const found = this.entries.get(name)
    if (found instanceof FakeFileHandle) return found
    if (found || !options.create) throw new DOMException('Missing file', 'NotFoundError')
    this.createdFiles += 1
    const file = new FakeFileHandle(name, this, this.operations)
    this.entries.set(name, file)
    return file
  }

  async *values() {
    for (const entry of this.entries.values()) yield entry
  }

  async removeEntry(name: string) {
    this.operations.push(`remove:${name}`)
    if (!this.entries.delete(name)) throw new DOMException('Missing entry', 'NotFoundError')
  }
}

async function seed(root: FakeDirectoryHandle, path: string, contents: string) {
  const parts = path.split('/')
  const fileName = parts.pop()!
  let directory = root
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true })
  const file = await directory.getFileHandle(fileName, { create: true })
  file.bytes = encoder.encode(contents)
}

describe('FileSystemVaultAdapter', () => {
  it('scans only approved Markdown folders without creating or writing on first scan', async () => {
    const root = new FakeDirectoryHandle('Vault')
    await seed(root, 'LifeOps/Knowledge/note.md', '# note')
    await seed(root, 'LifeOps/Knowledge/ignore.txt', 'ignore')
    await seed(root, 'LifeOps/Reviews/review.md', '# review')
    root.createdDirectories = 0
    root.createdFiles = 0
    root.operations.length = 0

    const adapter = new FileSystemVaultAdapter(root as unknown as DirectoryHandleLike)
    expect(await adapter.scan()).toEqual(['LifeOps/Knowledge/note.md', 'LifeOps/Reviews/review.md'])
    expect(root.createdDirectories).toBe(0)
    expect(root.createdFiles).toBe(0)
    expect(root.operations).toEqual([])
  })

  it('does not persist or claim a connection when read-write permission is denied', async () => {
    const denied = new FakeDirectoryHandle('Denied vault', 'denied')
    const save = vi.fn(async () => undefined)
    await expect(connectFileSystemVault(
      vi.fn(async () => denied as unknown as DirectoryHandleLike),
      { save },
    )).rejects.toThrow(/permission/i)
    expect(save).not.toHaveBeenCalled()
  })

  it('persists a granted handle only after querying permission', async () => {
    const granted = new FakeDirectoryHandle('Granted vault')
    const calls: string[] = []
    granted.queryPermission = vi.fn(async () => {
      calls.push('permission')
      return 'granted' as PermissionState
    })
    const save = vi.fn(async () => { calls.push('save') })
    const picker = vi.fn(async () => granted as unknown as DirectoryHandleLike)

    const connection = await connectFileSystemVault(picker, { save })
    expect(picker).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(connection.handle).toBe(granted)
    expect(calls).toEqual(['permission', 'save'])
  })

  it('replaces a file through a closed temporary sibling without leaving the temp file', async () => {
    const root = new FakeDirectoryHandle('Vault')
    await seed(root, 'LifeOps/Knowledge/note.md', 'old')
    root.operations.length = 0
    const adapter = new FileSystemVaultAdapter(root as unknown as DirectoryHandleLike)

    await adapter.writeAtomic('LifeOps/Knowledge/note.md', encoder.encode('new'))

    const knowledge = await (await root.getDirectoryHandle('LifeOps')).getDirectoryHandle('Knowledge')
    const target = await knowledge.getFileHandle('note.md')
    expect(decoder.decode(target.bytes)).toBe('new')
    expect(knowledge.entries.has('note.md.lifeops-tmp')).toBe(false)
    expect(root.operations).toEqual([
      'remove:note.md.lifeops-tmp',
      'open:note.md.lifeops-tmp',
      'write:note.md.lifeops-tmp',
      'close:note.md.lifeops-tmp',
      'remove:note.md',
      'move:note.md.lifeops-tmp->note.md',
    ])
  })
})

describe('applyVaultBatch', () => {
  it('backs up every affected path before the first write and reports a stopped partial failure', async () => {
    const calls: string[] = []
    const adapter: VaultAdapter = {
      scan: vi.fn(async () => []),
      read: vi.fn(async () => new Uint8Array()),
      mkdir: vi.fn(async (path) => { calls.push(`mkdir:${path}`) }),
      copy: vi.fn(async (source, target) => { calls.push(`copy:${source}->${target}`) }),
      writeAtomic: vi.fn(async (path) => {
        calls.push(`write:${path}`)
        if (path.endsWith('two.md')) throw new Error('disk full')
      }),
    }

    const result = await applyVaultBatch(adapter, [
      { path: 'LifeOps/Knowledge/one.md', bytes: encoder.encode('one') },
      { path: 'LifeOps/Reviews/two.md', bytes: encoder.encode('two') },
      { path: 'LifeOps/Knowledge/three.md', bytes: encoder.encode('three') },
    ], new Date('2026-08-22T10:20:30.000Z'))

    expect(result).toEqual({
      backupPath: 'LifeOps/.lifeops-backup/2026-08-22T10-20-30-000Z',
      completedPaths: ['LifeOps/Knowledge/one.md'],
      failedPaths: ['LifeOps/Reviews/two.md'],
    })
    expect(calls).toEqual([
      'mkdir:LifeOps/.lifeops-backup/2026-08-22T10-20-30-000Z',
      'copy:LifeOps/Knowledge/one.md->LifeOps/.lifeops-backup/2026-08-22T10-20-30-000Z/LifeOps/Knowledge/one.md',
      'copy:LifeOps/Reviews/two.md->LifeOps/.lifeops-backup/2026-08-22T10-20-30-000Z/LifeOps/Reviews/two.md',
      'copy:LifeOps/Knowledge/three.md->LifeOps/.lifeops-backup/2026-08-22T10-20-30-000Z/LifeOps/Knowledge/three.md',
      'write:LifeOps/Knowledge/one.md',
      'write:LifeOps/Reviews/two.md',
    ])
  })
})
