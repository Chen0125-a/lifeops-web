import type { VaultDocument, VaultDocumentType } from './types'

const DOCUMENT_TYPES = new Set<VaultDocumentType>(['knowledge', 'review'])

function quote(value: string): string {
  return JSON.stringify(value)
}

function validateId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || value === '.' || value === '..' || /[\\/\u0000-\u001f]/u.test(value)) {
    throw new Error('Invalid lifeops_id')
  }
}

function validateTimestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Invalid updated_at')
  const date = new Date(value)
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) throw new Error('Invalid updated_at')
}

function validateDocument(document: VaultDocument): void {
  validateId(document.lifeopsId)
  if (!DOCUMENT_TYPES.has(document.type)) throw new Error('Invalid document type')
  if (typeof document.title !== 'string' || !Array.isArray(document.tags) || document.tags.some((tag) => typeof tag !== 'string')) {
    throw new Error('Invalid document metadata')
  }
  if (document.source !== null && typeof document.source !== 'string') throw new Error('Invalid source')
  validateTimestamp(document.updatedAt)
  if (!Number.isInteger(document.syncRevision) || document.syncRevision < 0) throw new Error('Invalid sync_revision')
  if (typeof document.body !== 'string' || typeof document.path !== 'string') throw new Error('Invalid document contents')
}

export function serializeVaultDocument(document: VaultDocument): string {
  validateDocument(document)
  const lines = [
    '---',
    `lifeops_id: ${quote(document.lifeopsId)}`,
    `type: ${quote(document.type)}`,
    'tags:',
    ...document.tags.map((tag) => `  - ${quote(tag)}`),
    `source: ${document.source === null ? 'null' : quote(document.source)}`,
    `updated_at: ${quote(document.updatedAt)}`,
    `sync_revision: ${document.syncRevision}`,
    `title: ${quote(document.title)}`,
    '---',
  ]
  return `${lines.join('\n')}\n${document.body}`
}

export function parseVaultDocument(
  markdown: string,
  path: string,
  options: { expectedType?: VaultDocumentType } = {},
): VaultDocument {
  if (!markdown.startsWith('---\n')) throw new Error('Missing frontmatter')
  const closing = markdown.indexOf('\n---\n', 4)
  if (closing < 0) throw new Error('Missing frontmatter boundary')
  const header = markdown.slice(4, closing)
  const body = markdown.slice(closing + 5)
  const values = new Map<string, unknown>()
  const tags: string[] = []
  let readingTags = false

  for (const line of header.split('\n')) {
    if (readingTags && line.startsWith('  - ')) {
      const parsed = JSON.parse(line.slice(4))
      if (typeof parsed !== 'string') throw new Error('Invalid tags')
      tags.push(parsed)
      continue
    }
    readingTags = false
    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error('Invalid frontmatter entry')
    const key = line.slice(0, separator)
    if (values.has(key)) throw new Error(`Duplicate frontmatter entry: ${key}`)
    const raw = line.slice(separator + 1).trim()
    if (key === 'tags') {
      if (raw !== '') throw new Error('Invalid tags')
      values.set(key, tags)
      readingTags = true
      continue
    }
    if (!['lifeops_id', 'type', 'source', 'updated_at', 'sync_revision', 'title'].includes(key)) {
      throw new Error(`Unsupported frontmatter entry: ${key}`)
    }
    try {
      values.set(key, JSON.parse(raw))
    } catch {
      throw new Error(`Invalid frontmatter entry: ${key}`)
    }
  }

  for (const key of ['lifeops_id', 'type', 'tags', 'source', 'updated_at', 'sync_revision', 'title']) {
    if (!values.has(key)) throw new Error(`Missing ${key}`)
  }
  const type = values.get('type')
  if (type !== 'knowledge' && type !== 'review') throw new Error('Invalid document type')
  if (options.expectedType && type !== options.expectedType) throw new Error(`Unexpected document type: ${type}`)
  const document: VaultDocument = {
    lifeopsId: values.get('lifeops_id') as string,
    type,
    title: values.get('title') as string,
    tags: values.get('tags') as string[],
    source: values.get('source') as string | null,
    updatedAt: values.get('updated_at') as string,
    syncRevision: values.get('sync_revision') as number,
    body,
    path,
  }
  validateDocument(document)
  return document
}
