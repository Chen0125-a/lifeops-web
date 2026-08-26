import { createRoot } from 'react-dom/client'
import { ObsidianSettings, type ObsidianSettingsProps } from '../../src/features/settings/ObsidianSettings'
import type { SyncPlan, VaultDocument } from '../../src/integrations/obsidian/types'

export type ObsidianBrowserHarnessMode = 'fallback' | 'granted' | 'denied'

export function mountObsidianSettings(selectedMode: ObsidianBrowserHarnessMode) {
  const values = window as unknown as Record<string, unknown>
  const applicationRoot = document.querySelector<HTMLElement>('#root')
  if (applicationRoot) applicationRoot.hidden = true
  const container = document.createElement('main')
  container.id = 'obsidian-browser-harness'
  container.style.maxWidth = '64rem'
  container.style.margin = '0 auto'
  container.style.padding = 'clamp(1rem, 5vw, 4rem)'
  document.body.append(container)

  const documentValue: VaultDocument = {
    lifeopsId: 'note-1',
    type: 'knowledge',
    title: 'Kubernetes 复盘',
    tags: ['k8s'],
    source: null,
    updatedAt: '2026-08-22T10:00:00.000Z',
    syncRevision: 1,
    body: '# 正文',
    path: 'LifeOps/Knowledge/note-1.md',
  }
  const preview: SyncPlan = {
    hasConflicts: true,
    actions: [
      { kind: 'create-vault', lifeopsId: 'note-1', web: documentValue, vault: null },
      { kind: 'conflict', lifeopsId: 'note-2', web: documentValue, vault: documentValue },
    ],
  }
  values.__obsidianExportCount = 0
  values.__obsidianApplyCount = 0
  const props: ObsidianSettingsProps = selectedMode === 'fallback'
    ? {
        documents: [documentValue],
        supported: false,
        vaultName: '我的 Vault',
        filePath: 'LifeOps/Knowledge/证据 1.md',
        onExportZip: () => { values.__obsidianExportCount = Number(values.__obsidianExportCount) + 1 },
        onImportZip: async () => preview,
        onApply: async () => { values.__obsidianApplyCount = Number(values.__obsidianApplyCount) + 1 },
      }
    : {
        documents: [documentValue],
        supported: true,
        connect: async () => ({
          permission: selectedMode === 'granted' ? 'granted' : 'denied',
          vaultName: selectedMode === 'granted' ? 'Life vault' : 'Denied vault',
          scan: async () => preview,
        }),
        onApply: async () => { values.__obsidianApplyCount = Number(values.__obsidianApplyCount) + 1 },
      }
  createRoot(container).render(<ObsidianSettings {...props} />)
}

Object.assign(window as unknown as Record<string, unknown>, { __mountObsidianSettings: mountObsidianSettings })
