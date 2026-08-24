import { mediaApi } from '../../api/mediaApi'
import type { LifeRecord } from '../../domain/records'

interface RecordStreamProps {
  records: LifeRecord[]
  selectedId?: string
  onSelect: (id: string) => void
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
})
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
})

function grouped(records: LifeRecord[]) {
  const groups = new Map<string, LifeRecord[]>()
  for (const record of records) {
    const label = dateFormatter.format(new Date(record.occurredAt))
    groups.set(label, [...(groups.get(label) ?? []), record])
  }
  return [...groups.entries()]
}

export function RecordStream({ records, selectedId, onSelect }: RecordStreamProps) {
  return (
    <section className="record-stream" role="region" aria-label="记录时间流" data-grid-span="8">
      <header>
        <h2>发生过的事</h2>
        <span>{records.length} 条记录</span>
      </header>
      {records.length === 0 ? (
        <div className="record-stream__empty">
          <h3>这里还没有记录</h3>
          <p>从一件刚完成的任务开始，写下事实、感受和下一步。</p>
        </div>
      ) : grouped(records).map(([date, items]) => (
        <section className="record-day" role="group" aria-label={date} key={date}>
          <h3>{date}</h3>
          <ol>{items.map((record) => (
            <li key={record.id}>
              <button type="button" aria-current={selectedId === record.id ? 'true' : undefined} onClick={() => onSelect(record.id)}>
                <time>{timeFormatter.format(new Date(record.occurredAt))}</time>
                <span className="record-day__body">
                  <strong>{record.title}</strong>
                  <span>{record.body.replace(/[#>*_`\[\]-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 92)}</span>
                  <small>{record.pinned ? '已置顶 · ' : ''}{record.tags.join(' · ') || '未添加标签'}</small>
                </span>
                {record.coverMediaId ? <img src={mediaApi.privateUrl(record.coverMediaId)} alt="" /> : null}
              </button>
            </li>
          ))}</ol>
        </section>
      ))}
    </section>
  )
}
