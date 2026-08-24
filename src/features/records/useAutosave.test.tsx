import { act, renderHook } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError } from '../../api/httpClient'
import { useAutosave } from './useAutosave'

interface SaveResult {
  version: number
  updatedAt: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  })
}

function sessionDrafts() {
  return Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
    .filter((key): key is string => key !== null)
    .map((key) => ({ key, value: sessionStorage.getItem(key) }))
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T10:32:00.000Z'))
    setOnline(true)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    setOnline(true)
  })

  it('moves idle → dirty → saving → saved after exactly 800ms and exposes timestamped status', async () => {
    const pending = deferred<SaveResult>()
    const save = vi.fn<(value: string, version: number) => Promise<SaveResult>>()
      .mockReturnValue(pending.promise)
    const { result, rerender } = renderHook(
      ({ value, version }) => useAutosave({ value, version, save, delay: 800 }),
      { initialProps: { value: '初始正文', version: 4 } },
    )

    expect(result.current.status).toBe('idle')
    expect(result.current.statusLabel).toBe('尚未修改')
    rerender({ value: '800ms 后保存', version: 4 })
    expect(result.current.status).toBe('dirty')

    await act(async () => { await vi.advanceTimersByTimeAsync(799) })
    expect(save).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('800ms 后保存', 4)
    expect(result.current.status).toBe('saving')
    expect(result.current.statusLabel).toBe('保存中')

    pending.resolve({ version: 5, updatedAt: '2026-08-21T10:32:00.000Z' })
    await act(async () => { await pending.promise })
    expect(result.current.status).toBe('saved')
    expect(result.current.statusLabel).toMatch(/^已保存 · .+/)
    expect(result.current.lastSavedAt).toBe('2026-08-21T10:32:00.000Z')
    expect(result.current.version).toBe(5)
  })

  it('keeps an offline edit in plain session-local storage with an honest privacy note', async () => {
    setOnline(false)
    const save = vi.fn<(value: string, version: number) => Promise<SaveResult>>()
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave({ value, version: 2, save, delay: 800, draftKey: 'record-42' }),
      { initialProps: { value: '已保存正文' } },
    )

    rerender({ value: '离线时不能丢失的正文' })
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })

    expect(save).not.toHaveBeenCalled()
    expect(result.current.status).toBe('offline')
    expect(result.current.statusLabel).toBe('离线草稿')
    expect(result.current.privacyNote).toMatch(/当前浏览器会话|会话存储/)
    expect(result.current.privacyNote).toMatch(/明文/)
    expect(result.current.privacyNote).not.toMatch(/encrypted|加密/i)
    expect(localStorage).toHaveLength(0)
    expect(sessionDrafts()).toHaveLength(1)
    expect(sessionDrafts()[0].value).toContain('离线时不能丢失的正文')
    expect(result.current.recoverDraft()).toBe('离线时不能丢失的正文')
  })

  it('flushes the latest dirty value when the editor unmounts or the page is left', () => {
    const unmountSave = vi.fn<(value: string, version: number) => Promise<SaveResult>>()
      .mockResolvedValue({ version: 4, updatedAt: '2026-08-21T10:32:00.000Z' })
    const first = renderHook(
      ({ value }) => useAutosave({ value, version: 3, save: unmountSave, delay: 800 }),
      { initialProps: { value: '原正文' } },
    )
    first.rerender({ value: '卸载前的正文' })
    first.unmount()

    expect(unmountSave).toHaveBeenCalledTimes(1)
    expect(unmountSave).toHaveBeenCalledWith('卸载前的正文', 3)

    const leaveSave = vi.fn<(value: string, version: number) => Promise<SaveResult>>()
      .mockResolvedValue({ version: 8, updatedAt: '2026-08-21T10:32:00.000Z' })
    const second = renderHook(
      ({ value }) => useAutosave({ value, version: 7, save: leaveSave, delay: 800 }),
      { initialProps: { value: '原正文' } },
    )
    second.rerender({ value: '离开页面前的正文' })
    act(() => window.dispatchEvent(new Event('pagehide')))

    expect(leaveSave).toHaveBeenCalledTimes(1)
    expect(leaveSave).toHaveBeenCalledWith('离开页面前的正文', 7)
    second.unmount()
    expect(leaveSave).toHaveBeenCalledTimes(1)
  })

  it('keeps the local draft and exposes recovery after a stale-version 409 conflict', async () => {
    const conflict = new HttpError('VERSION_CONFLICT', '记录已被更新，请刷新后重试', 409, 'request-409')
    const save = vi.fn<(value: string, version: number) => Promise<SaveResult>>()
      .mockRejectedValue(conflict)
    const { result, rerender } = renderHook(
      ({ value }) => useAutosave({ value, version: 9, save, delay: 800, draftKey: 'record-conflict' }),
      { initialProps: { value: '服务器正文' } },
    )

    rerender({ value: '本地冲突正文' })
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })

    expect(save).toHaveBeenCalledWith('本地冲突正文', 9)
    expect(result.current.status).toBe('conflict')
    expect(result.current.error).toMatchObject({ code: 'VERSION_CONFLICT', status: 409, requestId: 'request-409' })
    expect(result.current.statusLabel).toBe('保存冲突')
    expect(sessionDrafts()[0].value).toContain('本地冲突正文')
    expect(result.current.recoverDraft()).toBe('本地冲突正文')
  })

  it('does not save the same value and version twice across rerenders or StrictMode effects', async () => {
    const save = vi.fn<(value: string, version: number) => Promise<SaveResult>>()
      .mockResolvedValue({ version: 12, updatedAt: '2026-08-21T10:32:00.000Z' })
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result, rerender } = renderHook(
      ({ value, version }) => useAutosave({ value, version, save, delay: 800 }),
      { initialProps: { value: '原正文', version: 11 }, wrapper },
    )

    rerender({ value: '只保存一次', version: 11 })
    rerender({ value: '只保存一次', version: 11 })
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('saved')

    rerender({ value: '只保存一次', version: 11 })
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(save).toHaveBeenCalledTimes(1)
  })
})
