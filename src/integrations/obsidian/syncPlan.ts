import type { SyncPlan, VaultDocument } from './types'

function indexDocuments(side: string, documents: VaultDocument[]): Map<string, VaultDocument> {
  const index = new Map<string, VaultDocument>()
  for (const document of documents) {
    if (index.has(document.lifeopsId)) throw new Error(`Duplicate ${side} lifeops_id: ${document.lifeopsId}`)
    index.set(document.lifeopsId, document)
  }
  return index
}

function canonical(document: VaultDocument): string {
  return JSON.stringify({
    lifeopsId: document.lifeopsId,
    type: document.type,
    title: document.title,
    tags: document.tags,
    source: document.source,
    updatedAt: document.updatedAt,
    syncRevision: document.syncRevision,
    body: document.body,
  })
}

export function buildSyncPlan(webDocuments: VaultDocument[], vaultDocuments: VaultDocument[]): SyncPlan {
  const webIndex = indexDocuments('Web', webDocuments)
  const vaultIndex = indexDocuments('vault', vaultDocuments)
  const ids = [...new Set([...webIndex.keys(), ...vaultIndex.keys()])].sort((left, right) => left.localeCompare(right, 'en'))
  const actions = ids.map((lifeopsId) => {
    const web = webIndex.get(lifeopsId) ?? null
    const vault = vaultIndex.get(lifeopsId) ?? null
    if (!web) return { kind: 'create-web' as const, lifeopsId, web, vault }
    if (!vault) return { kind: 'create-vault' as const, lifeopsId, web, vault }
    if (web.type !== vault.type) return { kind: 'conflict' as const, lifeopsId, web, vault }
    if (web.syncRevision > vault.syncRevision) return { kind: 'update-vault' as const, lifeopsId, web, vault }
    if (vault.syncRevision > web.syncRevision) return { kind: 'update-web' as const, lifeopsId, web, vault }
    const kind = canonical(web) === canonical(vault) ? 'unchanged' as const : 'conflict' as const
    return { kind, lifeopsId, web, vault }
  })
  return { actions, hasConflicts: actions.some(({ kind }) => kind === 'conflict') }
}
