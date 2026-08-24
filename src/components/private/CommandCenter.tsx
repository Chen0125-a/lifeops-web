import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { searchApi, type SearchResult } from '../../api/searchApi'
import { groupSearchResults, readRecentSearchResults, rememberSearchResult, searchTypeLabels } from './workspaceSearch'

interface CommandCenterProps {
  open: boolean
  onOpen: () => void
  onClose: () => void
}

export function CommandCenter({ open, onOpen, onClose }: CommandCenterProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [recent, setRecent] = useState<SearchResult[]>(() => readRecentSearchResults(window.sessionStorage))
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const groups = useMemo(() => groupSearchResults(results), [results])

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'k') return
      event.preventDefault()
      if (!open) returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      onOpen()
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [onOpen, open])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      returnFocusRef.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null
      setRecent(readRecentSearchResults(window.sessionStorage))
      const frame = requestAnimationFrame(() => inputRef.current?.focus())
      wasOpenRef.current = true
      return () => cancelAnimationFrame(frame)
    }
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false
      setQuery('')
      setResults([])
      setStatus('idle')
      setActiveIndex(-1)
      const element = returnFocusRef.current
      returnFocusRef.current = null
      const frame = requestAnimationFrame(() => element?.focus())
      return () => cancelAnimationFrame(frame)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !panelRef.current) return
      const items = [...panelRef.current.querySelectorAll<HTMLElement>('input,button:not([disabled]),a[href]')]
      const first = items[0]; const last = items.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    const normalized = query.trim()
    if (normalized.length < 2) {
      setResults([])
      setStatus('idle')
      setActiveIndex(-1)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setStatus('loading')
      void searchApi.search({ query: normalized, limit: 50 }, controller.signal).then(({ items }) => {
        if (controller.signal.aborted) return
        setResults(items)
        setActiveIndex(-1)
        setStatus('ready')
      }).catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        setResults([])
        setStatus('error')
      })
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, query])

  const choose = (result: SearchResult) => {
    rememberSearchResult(window.sessionStorage, result)
    setRecent(readRecentSearchResults(window.sessionStorage))
    onClose()
    navigate(result.route)
  }

  const handleInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => results.length ? (current + 1) % results.length : -1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => results.length ? (current <= 0 ? results.length - 1 : current - 1) : -1)
    } else if (event.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault()
      choose(results[activeIndex])
    }
  }

  if (!open) return null
  let resultIndex = 0
  return (
    <div className="command-center" role="dialog" aria-modal="true" aria-label="全局搜索">
      <button type="button" className="overlay-backdrop" onClick={onClose} tabIndex={-1} aria-label="关闭全局搜索" />
      <div className="command-center__panel" ref={panelRef}>
        <div className="command-center__search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input ref={inputRef} type="search" role="searchbox" aria-label="搜索 LifeOps" value={query}
            aria-controls="lifeops-search-results" aria-activedescendant={activeIndex >= 0 ? `lifeops-search-result-${activeIndex}` : undefined}
            onKeyDown={handleInputKey} onChange={(event) => setQuery(event.target.value)} placeholder="搜索目标、记录、知识或生活事实" />
          <kbd>ESC</kbd>
        </div>
        <div className="command-center__results" id="lifeops-search-results" role={results.length ? 'listbox' : undefined} aria-live="polite">
          {!query.trim() && recent.length > 0 && <section className="command-center__group" aria-labelledby="search-recent-heading">
            <h3 id="search-recent-heading">最近访问</h3>
            {recent.map((result) => <Link key={`${result.type}:${result.id}`} to={result.route} onClick={() => { rememberSearchResult(window.sessionStorage, result); onClose() }} aria-label={`${searchTypeLabels[result.type]} ${result.title}`}>
              <span>{searchTypeLabels[result.type]}</span><div><strong>{result.title}</strong><small>{result.context}</small></div><i aria-hidden="true">→</i>
            </Link>)}
          </section>}
          {!query.trim() && recent.length === 0 && <p>输入至少 2 个字，搜索你的私人 LifeOps 内容。</p>}
          {query.trim().length === 1 && <p>再输入 1 个字开始搜索。</p>}
          {status === 'loading' && <p>正在搜索…</p>}
          {status === 'error' && <p role="alert">搜索暂时不可用，请稍后重试。</p>}
          {status === 'ready' && results.length === 0 && <p>没有匹配内容。换一个关键词试试。</p>}
          {groups.map((group) => <section key={group.id} className="command-center__group" role="group" aria-labelledby={`search-group-${group.id}`}>
            <h3 id={`search-group-${group.id}`}>{group.label}</h3>
            {group.items.map((result) => {
              const index = resultIndex++
              return <button key={`${result.type}:${result.id}`} id={`lifeops-search-result-${index}`} type="button" role="option" aria-selected={activeIndex === index} aria-label={`${searchTypeLabels[result.type]} ${result.title}`} onMouseMove={() => setActiveIndex(index)} onClick={() => choose(result)}>
                <span>{searchTypeLabels[result.type]}</span><div><strong>{result.title}</strong><small>{result.excerpt}</small><em>{result.context}</em></div><i aria-hidden="true">→</i>
              </button>
            })}
          </section>)}
        </div>
      </div>
    </div>
  )
}
