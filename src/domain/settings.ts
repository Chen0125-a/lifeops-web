export type SettingsTheme = 'system' | 'light' | 'dark'
export type SettingsMotion = 'system' | 'reduce' | 'full'

export interface SettingsDocument {
  version: number
  updatedAt: string
  appearance: { theme: SettingsTheme; motion: SettingsMotion }
  locale: { locale: string; timezone: string; weekStartsOn: 0 | 1 | 6 }
  defaults: { startRoute: string; quickCreateType: string }
  life: { lowStockDays: number; expiryWarningDays: number; remindersEnabled: boolean }
  publicSite: { defaultVisibility: 'private' | 'public'; rssEnabled: boolean }
  connections: Array<{ id: string; label: string; state: 'connected' | 'degraded' | 'disabled' | 'local-only'; detail: string }>
}

export type UpdateSettingsInput = Partial<Pick<SettingsDocument, 'appearance' | 'locale' | 'defaults' | 'life' | 'publicSite'>> & { version: number }

export interface AccountSession {
  id: string
  current: boolean
  createdAt: string
  expiresAt: string
}

export interface DataExportResult {
  schemaVersion: 1
  canonicalJson: string
  checksumSha256: string
  counts: Record<string, number>
}

export interface DataImportPreview {
  status: 'ready' | 'conflicts'
  previewChecksum: string
  counts: Record<string, number>
  conflicts: Array<{ id: string; collection: string }>
  rejectedRecords: Array<{ collection: string; id: string; code: string; message: string }>
  ownerRemap: { source: string; target: string }
}

export interface DataImportApplyResult {
  applied: true
  counts: Record<string, number>
  restorePoint: { id: string; checksumSha256: string; createdAt: string }
}

export interface SafeAuditEvent {
  id: string
  actorId: string
  action: string
  targetType: string
  targetId: string | null
  metadata: Record<string, unknown>
  occurredAt: string
}
