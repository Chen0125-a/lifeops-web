export type VaultDocumentType = 'knowledge' | 'review'

export interface VaultDocument {
  lifeopsId: string
  type: VaultDocumentType
  title: string
  tags: string[]
  source: string | null
  updatedAt: string
  syncRevision: number
  body: string
  path: string
}

export type SyncActionKind = 'create-web' | 'update-web' | 'create-vault' | 'update-vault' | 'conflict' | 'unchanged'

export interface SyncPlanAction {
  kind: SyncActionKind
  lifeopsId: string
  web: VaultDocument | null
  vault: VaultDocument | null
}

export interface SyncPlan {
  actions: SyncPlanAction[]
  hasConflicts: boolean
}

export interface VaultAdapter {
  scan(): Promise<string[]>
  read(path: string): Promise<Uint8Array>
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>
  mkdir(path: string): Promise<void>
  copy(source: string, target: string): Promise<void>
}

export interface VaultBatchWrite {
  path: string
  bytes: Uint8Array
}

export interface VaultBatchResult {
  backupPath: string
  completedPaths: string[]
  failedPaths: string[]
}
