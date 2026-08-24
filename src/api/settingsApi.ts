import type {
  AccountSession,
  DataExportResult,
  DataImportApplyResult,
  DataImportPreview,
  SafeAuditEvent,
  SettingsDocument,
  UpdateSettingsInput,
} from '../domain/settings'
import { http } from './httpClient'

export const settingsApi = {
  get: (signal?: AbortSignal) => http.request<SettingsDocument>('/settings', { signal }),
  update: (input: UpdateSettingsInput, csrf?: string) => http.request<SettingsDocument>('/settings', { method: 'PATCH', body: input, csrf }),
  listSessions: (signal?: AbortSignal) => http.request<{ sessions: AccountSession[] }>('/account/sessions', { signal }),
  changePassword: (input: { currentPassword: string; newPassword: string }, csrf?: string) =>
    http.request<void>('/account/password', { method: 'POST', body: input, csrf }),
  revokeSession: (id: string, csrf?: string) => http.request<void>(`/account/sessions/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {}, csrf }),
  exportData: (csrf?: string) => http.request<DataExportResult>('/data/export', { method: 'POST', body: {}, csrf }),
  previewImport: (input: { canonicalJson: string; checksumSha256: string }, csrf?: string) =>
    http.request<DataImportPreview>('/data/import/preview', { method: 'POST', body: input, csrf }),
  applyImport: (input: { previewChecksum: string; currentPassword: string }, csrf?: string) =>
    http.request<DataImportApplyResult>('/data/import/apply', { method: 'POST', body: input, csrf }),
  listAudit: (signal?: AbortSignal) => http.request<{ events: SafeAuditEvent[] }>('/audit', { signal }),
}
