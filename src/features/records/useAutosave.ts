import { useCallback, useEffect, useRef, useState } from 'react'
import { HttpError } from '../../api/httpClient'

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'offline'

interface SaveResult {
  updatedAt: string
  version: number
}

export interface AutosaveResult {
  error: HttpError | Error | null
  lastSavedAt: string | null
  privacyNote: string
  recoverDraft: () => string | null
  status: AutosaveStatus
  statusLabel: string
  version: number
}

interface UseAutosaveOptions {
  delay?: number
  draftKey?: string
  save: (value: string, version: number) => Promise<SaveResult>
  value: string
  version: number
}

const privacyNote = '离线草稿仅保存在当前浏览器会话的会话存储中，并以明文保存；关闭会话后会清除。'
const isOffline = () => navigator.onLine === false

function label(status: AutosaveStatus, lastSavedAt: string | null) {
  if (status === 'idle') return '尚未修改'
  if (status === 'dirty') return '等待保存'
  if (status === 'saving') return '保存中'
  if (status === 'conflict') return '保存冲突'
  if (status === 'offline') return '离线草稿'
  if (!lastSavedAt) return '已保存'
  return `已保存 · ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(lastSavedAt))}`
}

export function useAutosave({ value, version, save, delay = 800, draftKey = 'untitled' }: UseAutosaveOptions): AutosaveResult {
  const storageKey = `lifeops:record-draft:${draftKey}`
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState(version)
  const [error, setError] = useState<HttpError | Error | null>(null)
  const cleanValue = useRef(value)
  const latestValue = useRef(value)
  const latestStorageKey = useRef(storageKey)
  const saveRef = useRef(save)
  const versionRef = useRef(version)
  const dirtyRef = useRef(false)
  const lastAttempt = useRef<{ value: string; version: number } | null>(null)

  latestValue.current = value
  latestStorageKey.current = storageKey
  saveRef.current = save

  useEffect(() => {
    if (version > versionRef.current) {
      versionRef.current = version
      setCurrentVersion(version)
    }
  }, [version])

  const storeDraft = useCallback((draftValue: string) => {
    sessionStorage.setItem(latestStorageKey.current, JSON.stringify({ value: draftValue, savedAt: new Date().toISOString() }))
  }, [])

  const recoverDraft = useCallback(() => {
    const stored = sessionStorage.getItem(latestStorageKey.current)
    if (!stored) return null
    try {
      const parsed = JSON.parse(stored) as { value?: unknown }
      return typeof parsed.value === 'string' ? parsed.value : null
    } catch {
      return null
    }
  }, [])

  const persist = useCallback(async (draftValue: string) => {
    const saveVersion = versionRef.current
    if (lastAttempt.current?.value === draftValue && lastAttempt.current.version === saveVersion) return
    if (isOffline()) {
      storeDraft(draftValue)
      setError(null)
      setStatus('offline')
      return
    }

    lastAttempt.current = { value: draftValue, version: saveVersion }
    setError(null)
    setStatus('saving')
    try {
      const saved = await saveRef.current(draftValue, saveVersion)
      cleanValue.current = draftValue
      versionRef.current = saved.version
      setCurrentVersion(saved.version)
      setLastSavedAt(saved.updatedAt)
      sessionStorage.removeItem(latestStorageKey.current)
      dirtyRef.current = latestValue.current !== draftValue
      setStatus(dirtyRef.current ? 'dirty' : 'saved')
    } catch (cause) {
      const caught = cause instanceof Error ? cause : new Error('保存失败')
      setError(caught)
      storeDraft(draftValue)
      dirtyRef.current = true
      setStatus(caught instanceof HttpError && caught.status === 409 ? 'conflict' : isOffline() ? 'offline' : 'dirty')
    }
  }, [storeDraft])

  useEffect(() => {
    if (value === cleanValue.current) return
    dirtyRef.current = true
    setStatus((current) => current === 'saving' ? current : 'dirty')
    const timer = window.setTimeout(() => { void persist(value) }, delay)
    return () => window.clearTimeout(timer)
  }, [delay, persist, value])

  const flush = useCallback(() => {
    if (!dirtyRef.current) return
    if (isOffline()) {
      storeDraft(latestValue.current)
      setStatus('offline')
      return
    }
    void persist(latestValue.current)
  }, [persist, storeDraft])
  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(() => {
    const onPageHide = () => flushRef.current()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      flushRef.current()
    }
  }, [])

  return {
    error,
    lastSavedAt,
    privacyNote,
    recoverDraft,
    status,
    statusLabel: label(status, lastSavedAt),
    version: currentVersion,
  }
}
