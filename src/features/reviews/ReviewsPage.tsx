import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Review, ReviewPeriod, ReviewType, UpdateReviewInput } from '../../domain/reviews'
import { EvidenceRail } from './EvidenceRail'
import { ReviewActions } from './ReviewActions'
import { ReviewEditor } from './ReviewEditor'
import { useReviews } from './useReviews'

type MobileStep = 'evidence' | 'writing' | 'actions'

const modes: Array<{ type: ReviewType; label: string }> = [
  { type: 'weekly', label: '周回顾' },
  { type: 'monthly', label: '月回顾' },
  { type: 'custom', label: '自定义周期' },
]

function validType(value: string | null): ReviewType {
  return value === 'monthly' || value === 'custom' ? value : 'weekly'
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function periodFor(type: ReviewType, now = new Date()): ReviewPeriod {
  const to = new Date(now)
  const from = new Date(now)
  if (type === 'weekly') from.setDate(to.getDate() - 6)
  else if (type === 'monthly') from.setDate(1)
  else from.setDate(to.getDate() - 29)
  return { from: dateKey(from), to: dateKey(to) }
}

function firstForType(reviews: Review[], type: ReviewType) {
  return reviews.find((review) => review.type === type && review.deletedAt == null)
}

export function ReviewsPage() {
  const reviewsState = useReviews()
  const [params, setParams] = useSearchParams()
  const requestedId = params.get('review')
  const requestedType = validType(params.get('period'))
  const [mobileStep, setMobileStep] = useState<MobileStep>('evidence')
  const [editorEpoch, setEditorEpoch] = useState(0)
  const selected = useMemo(() => (
    reviewsState.reviews.find((review) => review.id === requestedId)
      ?? firstForType(reviewsState.reviews, requestedType)
      ?? reviewsState.reviews[0]
  ), [requestedId, requestedType, reviewsState.reviews])
  const [periodDraft, setPeriodDraft] = useState<ReviewPeriod>(() => selected?.period ?? periodFor(requestedType))

  useEffect(() => {
    if (selected) setPeriodDraft(selected.period)
  }, [selected?.id, selected?.period.from, selected?.period.to])

  const chooseMode = async (type: ReviewType) => {
    const existing = firstForType(reviewsState.reviews, type)
    const review = existing ?? await reviewsState.createDraft(type, periodFor(type))
    const next = new URLSearchParams()
    next.set('review', review.id)
    next.set('period', type)
    setParams(next)
    setMobileStep('evidence')
  }

  const createReview = async () => {
    const review = await reviewsState.createDraft(requestedType, periodFor(requestedType))
    const next = new URLSearchParams()
    next.set('review', review.id)
    next.set('period', review.type)
    setParams(next)
    setMobileStep('evidence')
  }

  const saveNarrative = (input: UpdateReviewInput) => {
    if (!selected) return Promise.reject(new Error('没有可保存的回顾'))
    return reviewsState.update(selected.id, input)
  }

  const savePeriod = async () => {
    if (!selected || (periodDraft.from === selected.period.from && periodDraft.to === selected.period.to)) return
    await reviewsState.update(selected.id, { period: periodDraft, version: selected.version })
  }

  return (
    <article className="reviews-page">
      <header className="reviews-page__heading">
        <div>
          <p>证据化回顾</p>
          <h1 tabIndex={-1}>回顾</h1>
          <span>把真实发生过的事、你的解释和下一步行动放在同一张连续画布上。</span>
        </div>
        <button type="button" onClick={() => void createReview()}>新建回顾</button>
      </header>

      <section className="reviews-period" aria-label="回顾周期">
        <div className="reviews-period__modes" role="group" aria-label="周期模式">
          {modes.map((mode) => (
            <button
              key={mode.type}
              type="button"
              aria-pressed={selected?.type === mode.type}
              onClick={() => void chooseMode(mode.type)}
            >{mode.label}</button>
          ))}
        </div>
        <div className="reviews-period__dates">
          <label><span>周期开始</span><input aria-label="周期开始" type="date" value={periodDraft.from} onChange={(event) => setPeriodDraft((current) => ({ ...current, from: event.target.value }))} onBlur={() => void savePeriod()} /></label>
          <i aria-hidden="true">—</i>
          <label><span>周期结束</span><input aria-label="周期结束" type="date" value={periodDraft.to} onChange={(event) => setPeriodDraft((current) => ({ ...current, to: event.target.value }))} onBlur={() => void savePeriod()} /></label>
        </div>
      </section>

      {reviewsState.status === 'loading' ? <p className="reviews-page__state" role="status">正在整理周期事实…</p> : null}
      {['network-error', 'forbidden', 'disconnected'].includes(reviewsState.status) ? (
        <div className="reviews-page__state is-error" role="alert"><p>{reviewsState.error?.message ?? '暂时无法读取回顾。'}</p><button type="button" onClick={reviewsState.retry}>重试</button></div>
      ) : null}

      {selected ? (
        <>
          <nav className="reviews-mobile-progress" aria-label="移动回顾步骤">
            <button type="button" aria-current={mobileStep === 'evidence' ? 'step' : undefined} onClick={() => setMobileStep('evidence')}>证据 1/3</button>
            <button type="button" aria-current={mobileStep === 'writing' ? 'step' : undefined} onClick={() => setMobileStep('writing')}>书写 2/3</button>
            <button type="button" aria-current={mobileStep === 'actions' ? 'step' : undefined} onClick={() => setMobileStep('actions')}>行动 3/3</button>
          </nav>
          <section className="reviews-workspace" aria-label="回顾工作区" data-mobile-step={mobileStep}>
            <EvidenceRail
              evidence={selected.evidence}
              refreshing={reviewsState.isSaving}
              onRefresh={() => void reviewsState.refreshEvidence(selected.id, selected.version)}
            />
            <ReviewEditor
              key={`${selected.id}:${editorEpoch}`}
              review={selected}
              onSave={saveNarrative}
              onArchive={() => void reviewsState.archive(selected.id, selected.version)}
              onDelete={() => void reviewsState.remove(selected.id, selected.version)}
              onAdoptServer={async () => {
                await reviewsState.reload()
                setEditorEpoch((current) => current + 1)
              }}
            />
            <ReviewActions
              actions={selected.actions}
              busy={reviewsState.isSaving}
              onConvert={(actionId, input) => reviewsState.convertAction(selected.id, actionId, input)}
            />
          </section>
          <div className="reviews-mobile-controls">
            {mobileStep === 'writing' ? <button type="button" onClick={() => setMobileStep('evidence')}>返回证据</button> : null}
            {mobileStep === 'writing' ? <button className="is-primary" type="button" onClick={() => setMobileStep('actions')}>继续到行动</button> : null}
            {mobileStep === 'actions' ? <button type="button" onClick={() => setMobileStep('writing')}>返回书写</button> : null}
            {mobileStep === 'evidence' ? <button className="is-primary" type="button" onClick={() => setMobileStep('writing')}>继续到书写</button> : null}
          </div>
        </>
      ) : reviewsState.status === 'empty' ? (
        <section className="reviews-page__empty">
          <p>还没有回顾草稿</p>
          <h2>先选择一个周期，系统只会汇总已经保存的事实。</h2>
          <button type="button" onClick={() => void createReview()}>创建第一份回顾</button>
        </section>
      ) : null}

      {reviewsState.lastDeleted ? (
        <div className="reviews-undo" role="status"><span>回顾已移到回收站</span><button type="button" onClick={() => void reviewsState.restoreLastDeleted()}>恢复刚删除的回顾</button></div>
      ) : null}
    </article>
  )
}
