import type { VaultAdapter, VaultBatchResult, VaultBatchWrite } from './types'

interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>
}

interface WritableLike {
  write(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
}

interface FileHandleLike {
  kind: 'file'
  name: string
  getFile(): Promise<FileLike>
  createWritable(): Promise<WritableLike>
  move?(destination: DirectoryHandleLike, name: string): Promise<void>
}

export interface DirectoryHandleLike {
  kind: 'directory'
  name: string
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  values(): AsyncIterableIterator<DirectoryHandleLike | FileHandleLike>
  removeEntry(name: string): Promise<void>
}

export interface VaultHandleStore {
  save(handle: DirectoryHandleLike): Promise<void>
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotFoundError'
}

function pathParts(path: string): string[] {
  if (!path || path.startsWith('/') || path.includes('\\')) throw new Error(`Unsafe vault path: ${path}`)
  const parts = path.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe vault path: ${path}`)
  return parts
}

export class FileSystemVaultAdapter implements VaultAdapter {
  constructor(private readonly root: DirectoryHandleLike) {}

  private async directory(parts: string[], create: boolean): Promise<DirectoryHandleLike> {
    let directory = this.root
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create })
    return directory
  }

  private async file(path: string): Promise<FileHandleLike> {
    const parts = pathParts(path)
    const name = parts.pop()!
    return (await this.directory(parts, false)).getFileHandle(name, { create: false })
  }

  async scan(): Promise<string[]> {
    const paths: string[] = []
    for (const folder of ['Knowledge', 'Reviews']) {
      let directory: DirectoryHandleLike
      try {
        directory = await this.directory(['LifeOps', folder], false)
      } catch (error) {
        if (isNotFound(error)) continue
        throw error
      }
      for await (const entry of directory.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) paths.push(`LifeOps/${folder}/${entry.name}`)
      }
    }
    return paths.sort((left, right) => left.localeCompare(right, 'en'))
  }

  async scanLife(): Promise<string[]> {
    const paths: string[] = []
    for (const folder of ['Recipes', 'Cooking', 'Fitness', 'Reviews', 'Shopping', 'Budgets']) {
      let directory: DirectoryHandleLike
      try {
        directory = await this.directory(['LifeOps', 'Life', folder], false)
      } catch (error) {
        if (isNotFound(error)) continue
        throw error
      }
      for await (const entry of directory.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) paths.push(`LifeOps/Life/${folder}/${entry.name}`)
      }
    }
    return paths.sort((left, right) => left.localeCompare(right, 'en'))
  }

  async read(path: string): Promise<Uint8Array> {
    const file = await (await this.file(path)).getFile()
    return new Uint8Array(await file.arrayBuffer())
  }

  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
    const parts = pathParts(path)
    const name = parts.pop()!
    const directory = await this.directory(parts, true)
    const temporaryName = `${name}.lifeops-tmp`
    try {
      try { await directory.removeEntry(temporaryName) } catch (error) { if (!isNotFound(error)) throw error }
      const temporary = await directory.getFileHandle(temporaryName, { create: true })
      const writable = await temporary.createWritable()
      await writable.write(bytes)
      await writable.close()
      if (!temporary.move) throw new Error('Atomic file move is not supported by this browser')
      try { await directory.removeEntry(name) } catch (error) { if (!isNotFound(error)) throw error }
      await temporary.move(directory, name)
    } catch (error) {
      try { await directory.removeEntry(temporaryName) } catch { /* best-effort temp cleanup */ }
      throw error
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.directory(pathParts(path), true)
  }

  async copy(source: string, target: string): Promise<void> {
    await this.writeAtomic(target, await this.read(source))
  }
}

export async function connectFileSystemVault(
  picker: (options: { mode: 'readwrite' }) => Promise<DirectoryHandleLike>,
  store: VaultHandleStore,
): Promise<{ adapter: FileSystemVaultAdapter; handle: DirectoryHandleLike }> {
  const handle = await picker({ mode: 'readwrite' })
  const permission = await handle.queryPermission({ mode: 'readwrite' })
  if (permission !== 'granted') throw new Error(`Vault permission ${permission}`)
  await store.save(handle)
  return { adapter: new FileSystemVaultAdapter(handle), handle }
}

export async function applyVaultBatch(
  adapter: VaultAdapter,
  writes: VaultBatchWrite[],
  now: Date,
): Promise<VaultBatchResult> {
  const seen = new Set<string>()
  for (const write of writes) {
    pathParts(write.path)
    if (seen.has(write.path)) throw new Error(`Duplicate batch path: ${write.path}`)
    seen.add(write.path)
  }
  const backupPath = `LifeOps/.lifeops-backup/${now.toISOString().replace(/[.:]/gu, '-')}`
  await adapter.mkdir(backupPath)
  for (const write of writes) {
    try {
      await adapter.copy(write.path, `${backupPath}/${write.path}`)
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }
  const completedPaths: string[] = []
  const failedPaths: string[] = []
  for (const write of writes) {
    try {
      await adapter.writeAtomic(write.path, write.bytes)
      completedPaths.push(write.path)
    } catch {
      failedPaths.push(write.path)
      break
    }
  }
  return { backupPath, completedPaths, failedPaths }
}
