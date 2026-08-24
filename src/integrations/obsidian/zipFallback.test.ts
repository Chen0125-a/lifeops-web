import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { applyZipPreview, confirmZipPreview, exportVaultZip, obsidianOpenUri, previewVaultZip } from './zipFallback'
import type { VaultAdapter, VaultDocument } from './types'

function doc(id: string, type: 'knowledge' | 'review'): VaultDocument {
  return {
    lifeopsId: id,
    type,
    title: `${type} ${id}`,
    tags: ['LifeOps'],
    source: null,
    updatedAt: '2026-08-22T10:00:00.000Z',
    syncRevision: 1,
    body: `# ${id}`,
    path: `LifeOps/${type === 'knowledge' ? 'Knowledge' : 'Reviews'}/${id}.md`,
  }
}

function adapter(): VaultAdapter {
  return {
    scan: vi.fn(async () => []),
    read: vi.fn(),
    writeAtomic: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
  }
}

describe('Obsidian ZIP fallback', () => {
  it('exports deterministic approved paths and byte-identical archives', () => {
    const documents = [doc('知识 1', 'knowledge'), doc('review-1', 'review')]
    const first = exportVaultZip(documents)
    const second = exportVaultZip([...documents].reverse())
    expect(first).toEqual(second)
    expect(Object.keys(unzipSync(first)).sort()).toEqual([
      'LifeOps/Knowledge/%E7%9F%A5%E8%AF%86%201.md',
      'LifeOps/Reviews/review-1.md',
    ])
  })

  it('rejects zip-slip, absolute and unrelated paths before parsing any document', () => {
    for (const path of ['../evil.md', '/absolute.md', 'LifeOps/../evil.md', 'Secrets/token.md']) {
      expect(() => previewVaultZip(zipSync({ [path]: strToU8('not frontmatter') }))).toThrow(/path|entry/i)
    }
  })

  it('requires an explicit preview confirmation before applying and writes no delete action', async () => {
    const preview = previewVaultZip(exportVaultZip([doc('note-1', 'knowledge'), doc('review-1', 'review')]))
    const vault = adapter()
    expect(preview.confirmed).toBe(false)
    await expect(applyZipPreview(preview, vault)).rejects.toThrow(/confirm/i)
    expect(vault.writeAtomic).not.toHaveBeenCalled()

    const paths = await applyZipPreview(confirmZipPreview(preview), vault)
    expect(paths).toEqual(['LifeOps/Knowledge/note-1.md', 'LifeOps/Reviews/review-1.md'])
    expect(vault.writeAtomic).toHaveBeenCalledTimes(2)
  })

  it('encodes vault and file names in a safe Obsidian URI', () => {
    expect(obsidianOpenUri('我的 Vault', 'LifeOps/Knowledge/证据 1.md')).toBe(
      'obsidian://open?vault=%E6%88%91%E7%9A%84%20Vault&file=LifeOps%2FKnowledge%2F%E8%AF%81%E6%8D%AE%201.md',
    )
  })
})
