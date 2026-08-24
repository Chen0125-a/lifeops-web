import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { lifeCatalogApi } from '../../../api/lifeCatalogApi'
import { queryKeys } from '../../../api/queryKeys'
import { useAuth } from '../../../state/AuthContext'

export function TrashWorkspace({ embedded = false }: { embedded?: boolean }) {
  const auth = useAuth()
  const [announcement, setAnnouncement] = useState('')
  const trashQuery = useQuery({ queryKey: queryKeys.lifeTrash.lists, queryFn: ({ signal }) => lifeCatalogApi.listTrash(signal) })
  const items = trashQuery.data ?? []

  const restore = async (id: string, name: string, version: number) => {
    try {
      await lifeCatalogApi.restore(id, version, auth.csrfToken)
      setAnnouncement(`${name}已恢复，原有关系由服务端完成安全校验`)
      await trashQuery.refetch()
    } catch {
      setAnnouncement(navigator.onLine === false ? `${name}尚未恢复：当前设备离线` : `${name}尚未恢复：关系或版本校验失败，请重新加载后重试`)
    }
  }

  return <article className={`life-data-workspace${embedded ? ' is-embedded' : ''}`}>
    {!embedded ? <header><h1 tabIndex={-1}>生活数据</h1><p>数据分类、导入导出与 Obsidian 连接将在后续顺序任务接入；本任务只开放关系安全的回收站。</p></header> : null}
    <section className="trash-workspace" role="region" aria-label="生活数据回收站">
      <header><div><h2>回收站</h2><p>这里只有软删除记录。永久删除不可用；恢复必须通过服务端关系和版本校验。</p></div><span>{items.length} 项</span></header>
      {trashQuery.isPending ? <p role="status">正在读取回收站…</p> : null}
      {trashQuery.error ? <div role="alert"><p>回收站暂时无法加载。</p><button type="button" onClick={() => void trashQuery.refetch()}>重新加载</button></div> : null}
      {items.length ? <ol>{items.map((item) => <li key={item.id}><div><strong>{item.name}</strong><span>{item.kind} · {item.deletedAt ? new Date(item.deletedAt).toLocaleString('zh-CN') : '删除时间未知'}</span></div><button type="button" onClick={() => void restore(item.id, item.name, item.version)}>恢复 {item.name}</button></li>)}</ol> : !trashQuery.isPending ? <div className="trash-workspace__empty"><h3>回收站为空</h3><p>软删除的生活物品会保留在这里，直到你恢复它。</p></div> : null}
    </section>
    {announcement ? <p className="catalog-announcement" role="status">{announcement}</p> : null}
  </article>
}
