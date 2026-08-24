import type {
  AccountSession,
  SafeAuditEvent,
  UserSettings,
  UserSettingsDocument,
} from '../domain/types.js'
import type { DataTransferPort } from '../services/dataTransfer.js'

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  appearance: Object.freeze({ theme: 'system', motion: 'system' }),
  locale: Object.freeze({ locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 }),
  defaults: Object.freeze({ startRoute: '/app', quickCreateType: 'record' }),
  life: Object.freeze({ lowStockDays: 7, expiryWarningDays: 14, remindersEnabled: true }),
  publicSite: Object.freeze({ defaultVisibility: 'private', rssEnabled: true }),
})

export interface SettingsStore extends DataTransferPort {
  getUserSettings(userId: string): Promise<UserSettingsDocument>
  updateUserSettings(userId: string, input: Partial<UserSettings> & { version: number }): Promise<UserSettingsDocument>
  updateUserPassword(userId: string, passwordHash: string): Promise<void>
  listUserSessions(userId: string, currentSessionId: string): Promise<AccountSession[]>
  revokeUserSession(userId: string, sessionId: string): Promise<boolean>
  revokeOtherUserSessions(userId: string, currentSessionId: string): Promise<void>
  appendSafeAuditEvent(userId: string, input: { action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }): Promise<SafeAuditEvent>
  listSafeAuditEvents(userId: string, limit?: number): Promise<SafeAuditEvent[]>
}
