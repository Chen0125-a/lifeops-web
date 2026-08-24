import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { parseVaultDocument, serializeVaultDocument } from './frontmatter'
import type { VaultAdapter, VaultDocument, VaultDocumentType } from './types'

export interface ZipImportPreview {
  checksum: string
  documents: VaultDocument[]
  paths: string[]
  confirmed: boolean
}

const FIXED_MTIME = new Date('1980-01-01T00:00:00.000Z')

function pathFor(document: VaultDocument): string {
  const folder = document.type === 'knowledge' ? 'Knowledge' : document.type === 'review' ? 'Reviews' : null
  if (!folder) throw new Error(`Unsupported document type: ${String(document.type)}`)
  return `LifeOps/${folder}/${encodeURIComponent(document.lifeopsId)}.md`
}

function entryType(path: string): VaultDocumentType {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`Unsafe ZIP entry path: ${path}`)
  }
  if (/^LifeOps\/Knowledge\/[^/]+\.md$/u.test(path)) return 'knowledge'
  if (/^LifeOps\/Reviews\/[^/]+\.md$/u.test(path)) return 'review'
  throw new Error(`Unsupported ZIP entry path: ${path}`)
}

function checksum(bytes: Uint8Array): string {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function exportVaultZip(documents: VaultDocument[]): Uint8Array {
  const entries: Zippable = {}
  const ids = new Set<string>()
  for (const document of [...documents].sort((left, right) => pathFor(left).localeCompare(pathFor(right), 'en'))) {
    if (ids.has(document.lifeopsId)) throw new Error(`Duplicate lifeops_id: ${document.lifeopsId}`)
    ids.add(document.lifeopsId)
    entries[pathFor(document)] = [strToU8(serializeVaultDocument({ ...document, path: pathFor(document) })), { mtime: FIXED_MTIME }]
  }
  return zipSync(entries, { level: 6, mtime: FIXED_MTIME })
}

export function previewVaultZip(bytes: Uint8Array): ZipImportPreview {
  const entries = unzipSync(bytes)
  const paths = Object.keys(entries).sort((left, right) => left.localeCompare(right, 'en'))
  const documents = paths.map((path) => parseVaultDocument(strFromU8(entries[path]), path, { expectedType: entryType(path) }))
  const ids = new Set<string>()
  for (const document of documents) {
    if (ids.has(document.lifeopsId)) throw new Error(`Duplicate ZIP lifeops_id: ${document.lifeopsId}`)
    ids.add(document.lifeopsId)
  }
  return { checksum: checksum(bytes), documents, paths, confirmed: false }
}

export function confirmZipPreview(preview: ZipImportPreview): ZipImportPreview {
  return { ...preview, documents: [...preview.documents], paths: [...preview.paths], confirmed: true }
}

export async function applyZipPreview(preview: ZipImportPreview, adapter: VaultAdapter): Promise<string[]> {
  if (!preview.confirmed) throw new Error('Confirm the ZIP preview before applying')
  const documents = [...preview.documents].sort((left, right) => left.path.localeCompare(right.path, 'en'))
  for (const document of documents) {
    await adapter.writeAtomic(document.path, strToU8(serializeVaultDocument(document)))
  }
  return documents.map(({ path }) => path)
}

export function obsidianOpenUri(vault: string, file: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`
}
