import type { LifeProjectionDocument } from './lifeProjection'

export type LifeImportActionKind =
  | 'create-vault'
  | 'update-vault'
  | 'import-candidate'
  | 'update-web'
  | 'recipe-version-draft'
  | 'conflict'
  | 'unchanged'

export interface LifeImportAction {
  key: string
  lifeopsId: string
  type: LifeProjectionDocument['type']
  kind: LifeImportActionKind
  web: LifeProjectionDocument | null
  vault: LifeProjectionDocument | null
}

export interface LifeImportPlan {
  actions: LifeImportAction[]
  hasConflicts: boolean
  writesApplied: false
}

export type LifeImportResolution = 'keep-web' | 'use-obsidian' | 'keep-both' | 'manual-merge' | 'create-recipe-version'

export interface LifeImportMutation {
  kind: 'import' | 'create-recipe-version'
  action: LifeImportAction
}

function keyOf(document: LifeProjectionDocument): string {
  return `${document.type}:${document.lifeopsId}`
}

function index(side: string, documents: LifeProjectionDocument[]): Map<string, LifeProjectionDocument> {
  const values = new Map<string, LifeProjectionDocument>()
  for (const document of documents) {
    const key = keyOf(document)
    if (values.has(key)) throw new Error(`Duplicate ${side} projection: ${key}`)
    values.set(key, document)
  }
  return values
}

function content(document: LifeProjectionDocument): string {
  return JSON.stringify({ title: document.title, tags: document.tags, body: document.body })
}

function canonical(document: LifeProjectionDocument): string {
  return JSON.stringify({ ...document, path: undefined })
}

export function buildLifeImportPlan(webDocuments: LifeProjectionDocument[], vaultDocuments: LifeProjectionDocument[]): LifeImportPlan {
  const web = index('Web', webDocuments)
  const vault = index('vault', vaultDocuments)
  const keys = [...web.keys(), ...[...vault.keys()].filter((key) => !web.has(key))]
  const actions: LifeImportAction[] = keys.map((key) => {
    const webDocument = web.get(key) ?? null
    const vaultDocument = vault.get(key) ?? null
    const current = webDocument ?? vaultDocument!
    let kind: LifeImportActionKind
    if (!webDocument) kind = 'import-candidate'
    else if (!vaultDocument) kind = 'create-vault'
    else if (canonical(webDocument) === canonical(vaultDocument)) kind = 'unchanged'
    else if (webDocument.type === 'recipe' && content(webDocument) !== content(vaultDocument)) kind = 'recipe-version-draft'
    else if (webDocument.version > vaultDocument.version) kind = 'update-vault'
    else if (vaultDocument.version > webDocument.version) kind = 'update-web'
    else kind = 'conflict'
    return { key, lifeopsId: current.lifeopsId, type: current.type, kind, web: webDocument, vault: vaultDocument }
  })
  return { actions, hasConflicts: actions.some(({ kind }) => kind === 'conflict' || kind === 'recipe-version-draft'), writesApplied: false }
}

export function buildLifeImportMutations(
  plan: LifeImportPlan,
  resolutions: Record<string, LifeImportResolution>,
): LifeImportMutation[] {
  const mutations: LifeImportMutation[] = []
  for (const action of plan.actions) {
    if (action.kind === 'recipe-version-draft') {
      const resolution = resolutions[action.key]
      if (!resolution) throw new Error(`配方 ${action.lifeopsId} 必须先明确是否创建 recipe version。`)
      if (resolution === 'create-recipe-version') mutations.push({ kind: 'create-recipe-version', action })
      else if (resolution !== 'keep-web') throw new Error(`配方 ${action.lifeopsId} 的处理方式无效。`)
      continue
    }
    if (action.kind === 'conflict') {
      const resolution = resolutions[action.key]
      if (!resolution) throw new Error(`冲突 ${action.key} 尚未明确处理。`)
      if (resolution === 'use-obsidian' || resolution === 'keep-both' || resolution === 'manual-merge') mutations.push({ kind: 'import', action })
      else if (resolution !== 'keep-web') throw new Error(`冲突 ${action.key} 的处理方式无效。`)
      continue
    }
    if (action.kind === 'update-web' || action.kind === 'import-candidate') mutations.push({ kind: 'import', action })
  }
  return mutations
}
