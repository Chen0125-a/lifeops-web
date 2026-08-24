import { useMemo, useState } from 'react'
import { HttpError } from '../../api/httpClient'
import type { Review, UpdateReviewInput } from '../../domain/reviews'
import { useAutosave } from '../records/useAutosave'

type NarrativeKey = 'achievements' | 'problems' | 'causes' | 'insights' | 'nextChanges'
type NarrativeDraft = Record<NarrativeKey, string>

const fields: Array<{ key: NarrativeKey; label: string; prompt: string }> = [
  { key: 'achievements', label: '成果', prompt: '哪些结果已经真实发生？' },
  { key: 'problems', label: '问题', prompt: '什么阻碍了推进？' },
  { key: 'causes', label: '原因', prompt: '哪些事实解释了这些问题？' },
  { key: 'insights', label: '洞察', prompt: '你从证据中看到了什么？' },
  { key: 'nextChanges', label: '下一步变化', prompt: '下一周期要具体改变什么？' },
]

function reviewDraft(review: Review): NarrativeDraft {
  return {
    achievements: review.achievements.join('\n'),
    problems: review.problems.join('\n'),
    causes: review.causes.join('\n'),
    insights: review.insights.join('\n'),
    nextChanges: review.nextChanges.join('\n'),
  }
}

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

function serialized(draft: NarrativeDraft) {
  return JSON.stringify(draft)
}

export function ReviewEditor({
  review,
  onSave,
  onArchive,
  onDelete,
  onAdoptServer,
}: {
  review: Review
  onSave: (input: UpdateReviewInput) => Promise<Review>
  onArchive: () => void
  onDelete: () => void
  onAdoptServer: () => Promise<void>
}) {
  const [draft, setDraft] = useState<NarrativeDraft>(() => reviewDraft(review))
  const [keptLocal, setKeptLocal] = useState(false)
  const value = useMemo(() => serialized(draft), [draft])
  const autosave = useAutosave({
    draftKey: `review:${review.id}`,
    value,
    version: review.version,
    save: async (nextValue, version) => {
      const next = JSON.parse(nextValue) as NarrativeDraft
      const updated = await onSave({
        achievements: lines(next.achievements),
        problems: lines(next.problems),
        causes: lines(next.causes),
        insights: lines(next.insights),
        nextChanges: lines(next.nextChanges),
        version,
      })
      return { updatedAt: updated.updatedAt, version: updated.version }
    },
  })
  const conflictError = autosave.status === 'conflict' && autosave.error instanceof HttpError
    ? autosave.error
    : null

  return (
    <section className="review-editor" aria-label="叙事回顾" data-grid-span="6">
      <header>
        <div>
          <span>叙事层</span>
          <h2>把事实写成可行动的理解</h2>
        </div>
        <p className={`review-editor__save is-${autosave.status}`} role="status" aria-live="polite">{autosave.statusLabel}</p>
      </header>
      <p className="review-editor__lead">一行写一条。这里保存你的判断，不会反向改写左侧事实。</p>
      <div className="review-editor__fields">
        {fields.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <small>{field.prompt}</small>
            <textarea
              aria-label={field.label}
              rows={field.key === 'insights' ? 5 : 4}
              value={draft[field.key]}
              onChange={(event) => {
                setKeptLocal(false)
                setDraft((current) => ({ ...current, [field.key]: event.target.value }))
              }}
            />
          </label>
        ))}
      </div>
      {conflictError ? (
        <div className="review-editor__conflict" role="alert" aria-label="回顾保存冲突">
          <strong>保存冲突</strong>
          <p>{conflictError.message}</p>
          <div>
            <button type="button" onClick={() => void onAdoptServer()}>采用服务器版本</button>
            <button type="button" onClick={() => {
              const recovered = autosave.recoverDraft()
              if (recovered) setDraft(JSON.parse(recovered) as NarrativeDraft)
              setKeptLocal(true)
            }}>保留本地草稿</button>
          </div>
        </div>
      ) : null}
      {keptLocal ? <p className="review-editor__local" role="status">本地草稿已保留；刷新服务器版本后可再次保存。</p> : null}
      <p className="review-editor__privacy">{autosave.privacyNote}</p>
      <footer>
        <button type="button" onClick={onArchive} disabled={review.status === 'archived'}>{review.status === 'archived' ? '已归档' : '归档回顾'}</button>
        <button className="is-danger" type="button" onClick={onDelete}>删除回顾</button>
      </footer>
    </section>
  )
}
