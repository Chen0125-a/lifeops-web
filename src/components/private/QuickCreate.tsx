import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { goalsApi } from '../../api/goalsApi'
import { habitsApi } from '../../api/habitsApi'
import { knowledgeApi } from '../../api/knowledgeApi'
import { lifeCatalogApi } from '../../api/lifeCatalogApi'
import { lifeCommerceApi } from '../../api/lifeCommerceApi'
import { lifePlanningApi } from '../../api/lifePlanningApi'
import { lifeRecipesApi } from '../../api/lifeRecipesApi'
import { recordsApi } from '../../api/recordsApi'
import { reviewsApi } from '../../api/reviewsApi'
import { tasksApi } from '../../api/tasksApi'
import type { QuickCreateContextValue } from './quickCreateContext'

export type QuickCreateType =
  | 'task' | 'record' | 'knowledge' | 'goal' | 'project' | 'habit' | 'review'
  | 'life-item' | 'recipe' | 'medicine' | 'fitness' | 'household-item'
  | 'shopping-item' | 'day-plan' | 'actual-meal'

export interface QuickCreateSubmission {
  type: QuickCreateType
  title: string
  details: string
  context: QuickCreateContextValue
  idempotencyKey: string
}

export interface QuickCreateResult {
  id: string
  type: QuickCreateType
  title: string
  route: string
  version?: number
  undoExpiresAt?: string
  undoable?: boolean
  raw?: unknown
}

export interface QuickCreateActions {
  create(submission: QuickCreateSubmission): Promise<QuickCreateResult>
  undo(result: QuickCreateResult, idempotencyKey: string): Promise<void>
}

interface QuickCreateProps {
  open: boolean
  context: QuickCreateContextValue
  actions?: QuickCreateActions
  createIdempotencyKey?: () => string
  onOpen: () => void
  onClose: () => void
  onOpenResult: (route: string) => void
}

const types: Array<{ value: QuickCreateType; label: string }> = [
  { value: 'record', label: '记录' },
  { value: 'task', label: '任务' },
  { value: 'knowledge', label: '知识' },
  { value: 'goal', label: '目标' },
  { value: 'project', label: '项目' },
  { value: 'habit', label: '习惯' },
  { value: 'review', label: '回顾' },
  { value: 'life-item', label: '生活条目' },
  { value: 'recipe', label: '食谱' },
  { value: 'medicine', label: '药品事实' },
  { value: 'fitness', label: '健身活动' },
  { value: 'household-item', label: '家庭物品' },
  { value: 'shopping-item', label: '采购项' },
  { value: 'day-plan', label: '日计划' },
  { value: 'actual-meal', label: '实际完成' },
]
const labels = Object.fromEntries(types.map((type) => [type.value, type.label])) as Record<QuickCreateType, string>
const localDate = () => {
  const now = new Date()
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 10)
}
const route = (pathname: string, key: string, value: string) => `${pathname}?${new URLSearchParams({ [key]: value })}`
const entity = (value: unknown) => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const number = (value: unknown) => typeof value === 'number' ? value : undefined
const id = (value: unknown, fallback: string) => typeof value === 'string' && value ? value : fallback
const expiry = () => new Date(Date.now() + 10 * 60_000).toISOString()
const newIdempotencyKey = () => crypto.randomUUID()

function result(
  submission: QuickCreateSubmission,
  raw: unknown,
  resultRoute: string,
  options: { fallbackId?: string; undoable?: boolean } = {},
): QuickCreateResult {
  const row = entity(raw)
  return {
    id: id(row.id, options.fallbackId ?? submission.idempotencyKey),
    type: submission.type,
    title: submission.title,
    route: resultRoute,
    version: number(row.version) ?? number(row.entityVersion),
    undoExpiresAt: options.undoable === false ? undefined : expiry(),
    undoable: options.undoable !== false,
    raw,
  }
}

async function createThroughDomainApi(submission: QuickCreateSubmission) {
  const { context, details, idempotencyKey, title, type } = submission
  const date = context.date ?? localDate()
  if (type === 'task') {
    const raw = await tasksApi.create({ title, description: details || undefined, goalId: context.goalId, projectId: context.projectId, dueAt: context.date ? `${context.date}T23:59:00.000Z` : undefined }, idempotencyKey)
    return result(submission, raw, route('/app/schedule', 'task', raw.id))
  }
  if (type === 'record') {
    const links = [
      ...(context.goalId ? [{ type: 'goal' as const, id: context.goalId }] : []),
      ...(context.projectId ? [{ type: 'project' as const, id: context.projectId }] : []),
      ...(context.habitId ? [{ type: 'habit' as const, id: context.habitId }] : []),
    ]
    const raw = await recordsApi.create({ title, body: details || title, occurredAt: context.date ? `${context.date}T12:00:00.000Z` : undefined, links }, idempotencyKey)
    return result(submission, raw, route('/app/records', 'record', raw.id))
  }
  if (type === 'knowledge') {
    const sourceLinks = context.sourceType === 'record' && context.sourceId
      ? [{ type: 'record' as const, id: context.sourceId }]
      : []
    const relatedIds = context.sourceType === 'knowledge' && context.sourceId ? [context.sourceId] : []
    const raw = await knowledgeApi.create({ title, body: details || title, sourceLinks, relatedIds }, undefined, idempotencyKey)
    return result(submission, raw, route('/app/knowledge', 'note', raw.id))
  }
  if (type === 'goal') {
    const raw = await goalsApi.create({ title, description: details || undefined }, idempotencyKey)
    return result(submission, raw, route('/app/goals', 'goal', raw.id))
  }
  if (type === 'project') {
    if (!context.goalId) throw new Error('请先从一个已加载的目标中创建项目')
    const raw = await goalsApi.createProject(context.goalId, { title, description: details || undefined }, idempotencyKey)
    return result(submission, raw, route('/app/goals', 'project', raw.id))
  }
  if (type === 'habit') {
    const raw = await habitsApi.create({
      title, description: details || undefined, goalId: context.goalId, projectId: context.projectId,
      measure: 'boolean', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      schedule: { scheduleType: 'daily', startsOn: date },
    }, idempotencyKey)
    return result(submission, raw, route('/app/habits', 'habit', raw.id))
  }
  if (type === 'review') {
    const raw = await reviewsApi.create({ type: 'custom', period: { from: date, to: date }, achievements: [title], insights: details ? [details] : [] }, idempotencyKey)
    return result(submission, raw, route('/app/reviews', 'review', raw.id))
  }
  if (type === 'life-item' || type === 'medicine' || type === 'household-item') {
    const kind = type === 'medicine' ? 'medicine' : type === 'household-item' ? 'household_consumable' : 'ingredient'
    const raw = await lifeCatalogApi.create({ kind, name: title, baseUnit: 'count', notes: details }, idempotencyKey)
    const pathname = type === 'medicine' ? '/app/life/medicines' : type === 'household-item' ? '/app/life/household' : '/app/life/ingredients'
    return result(submission, raw, route(pathname, 'item', raw.id))
  }
  if (type === 'recipe') {
    const raw = await lifeRecipesApi.create({
      name: title, description: details, servings: 1, components: [],
      steps: [{ instruction: details || title, ingredientItemIds: [], durationSeconds: null, imageMediaId: null, caution: '', position: 0 }],
    }, idempotencyKey)
    return result(submission, raw, route('/app/life/recipes', 'recipe', raw.id))
  }
  if (type === 'fitness') {
    const raw = await lifePlanningApi.createFitness({ name: title, defaultMinutes: 30, kcalPerHour: 0, intensity: details, steps: [], equipment: [] }, idempotencyKey)
    return result(submission, raw, route('/app/life/fitness', 'date', date), { undoable: false })
  }
  if (type === 'shopping-item') {
    if (context.sourceType !== 'life-item' || !context.sourceId) throw new Error('请先从一个已加载的生活条目中创建采购项')
    const raw = await lifeCommerceApi.createShoppingItem({ itemId: context.sourceId, requestedQuantity: 1, unit: 'count', neededOn: context.date }, idempotencyKey)
    return result(submission, raw, route('/app/life/shopping', 'shopping', raw.id), { undoable: false })
  }
  if (type === 'day-plan') {
    const raw = await lifePlanningApi.createDayPlan({ date, mealSlots: [], items: [] }, idempotencyKey)
    return result(submission, raw, route('/app/life/plans', 'date', date), { fallbackId: date, undoable: false })
  }
  if (context.sourceType !== 'day-plan-item' || !context.sourceId) throw new Error('请先从一个已加载的日计划条目中记录实际完成')
  const raw = await lifePlanningApi.createCompletion({ date, dayPlanItemId: context.sourceId, completedAt: new Date().toISOString() }, idempotencyKey)
  return result(submission, raw, route('/app/life/plans', 'date', date))
}

async function undoThroughDomainApi(created: QuickCreateResult, idempotencyKey: string) {
  const version = created.version ?? 1
  if (created.type === 'task') return tasksApi.remove(created.id, version)
  if (created.type === 'record') return recordsApi.remove(created.id, version)
  if (created.type === 'knowledge') return knowledgeApi.remove(created.id, version)
  if (created.type === 'goal') return goalsApi.remove(created.id, version)
  if (created.type === 'project') return goalsApi.removeProject(created.id, version)
  if (created.type === 'habit') { await habitsApi.update(created.id, { status: 'archived', version }); return }
  if (created.type === 'review') return reviewsApi.remove(created.id, version)
  if (['life-item', 'medicine', 'household-item'].includes(created.type)) return lifeCatalogApi.remove(created.id, version)
  if (created.type === 'recipe') return lifeRecipesApi.remove(created.id, version)
  if (created.type === 'actual-meal') { await lifePlanningApi.undoCompletion(created.id, idempotencyKey); return }
  throw new Error('这个类型暂不支持安全撤销')
}

export const quickCreateActions: QuickCreateActions = {
  create: createThroughDomainApi,
  undo: undoThroughDomainApi,
}

export function QuickCreate({
  open,
  context,
  actions = quickCreateActions,
  createIdempotencyKey = newIdempotencyKey,
  onOpen,
  onClose,
  onOpenResult,
}: QuickCreateProps) {
  const reducedMotion = useReducedMotion()
  const [type, setType] = useState<QuickCreateType>('record')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error' | 'undone'>('idle')
  const [error, setError] = useState('')
  const [created, setCreated] = useState<QuickCreateResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLFormElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const keyRef = useRef<string | null>(null)
  const submittingRef = useRef(false)
  const inherited = useMemo(() => [
    context.goalId && `继承目标 ${context.goalId}`,
    context.projectId && `继承项目 ${context.projectId}`,
    context.habitId && `继承习惯 ${context.habitId}`,
    context.date && `日期 ${context.date}`,
    context.sourceId && `来源 ${context.sourceType} ${context.sourceId}`,
  ].filter(Boolean) as string[], [context])
  const canUndo = Boolean(
    created
    && created.undoable !== false
    && created.undoExpiresAt
    && Date.parse(created.undoExpiresAt) > Date.now(),
  )

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== '/') return
      event.preventDefault()
      if (!open) returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      onOpen()
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [onOpen, open])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      returnFocusRef.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null
      wasOpenRef.current = true
      keyRef.current = createIdempotencyKey()
      const frame = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(frame)
    }
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false
      submittingRef.current = false
      setType('record'); setTitle(''); setDetails(''); setAdvanced(false); setState('idle'); setCreated(null); setError('')
      keyRef.current = null
      const target = returnFocusRef.current
      returnFocusRef.current = null
      const frame = requestAnimationFrame(() => target?.focus())
      return () => cancelAnimationFrame(frame)
    }
  }, [createIdempotencyKey, open])

  useEffect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('input,textarea,select,button:not([disabled])')]
      const first = focusable[0]; const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose, open])

  const submit = async () => {
    if (submittingRef.current || !title.trim()) return
    submittingRef.current = true
    setState('submitting'); setError('')
    try {
      const value = await actions.create({
        type, title: title.trim(), details: details.trim(), context,
        idempotencyKey: keyRef.current ?? (keyRef.current = createIdempotencyKey()),
      })
      setCreated(value)
      setState('success')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败，请重试')
      setState('error')
    } finally {
      submittingRef.current = false
    }
  }
  const onSubmit = (event: FormEvent) => { event.preventDefault(); void submit() }
  const createAnother = () => {
    keyRef.current = createIdempotencyKey()
    setTitle(''); setDetails(''); setAdvanced(false); setCreated(null); setError(''); setState('idle')
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  const undo = async () => {
    if (!created || !keyRef.current || !canUndo) return
    setState('submitting')
    try {
      await actions.undo(created, keyRef.current)
      setState('undone')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销失败，请前往原页面处理')
      setState('error')
    }
  }

  return <AnimatePresence initial={false}>
    {open && <motion.div
      className="quick-create"
      role="dialog"
      aria-modal="true"
      aria-label="快速记录"
      initial={false}
      animate={{ opacity: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : .16 }}
    >
      <button type="button" className="overlay-backdrop" onClick={onClose} tabIndex={-1} aria-label="关闭快速记录" />
      <motion.form ref={panelRef} onSubmit={onSubmit}
        initial={reducedMotion ? false : { x: 28 }} animate={{ opacity: 1, x: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 18 }}>
        <header><div><p>Quick create</p><h2>快速记录</h2></div><button type="button" onClick={onClose} aria-label="关闭快速记录">×</button></header>
        {state === 'success' || state === 'undone' ? <section className="quick-create__success" role="status" aria-label="创建成功">
          <p>{state === 'undone' ? '已撤销' : '已经写入你的 LifeOps'}</p>
          <h3>{created?.title}</h3>
          {state !== 'undone' && canUndo && <span>可在 {new Date(created!.undoExpiresAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 前撤销</span>}
          <div>
            <button type="button" onClick={onClose}>留在这里</button>
            {state !== 'undone' && <button type="button" onClick={() => { if (created) { onClose(); onOpenResult(created.route) } }}>打开{created ? labels[created.type] : '内容'}</button>}
            {state !== 'undone' && canUndo && <button type="button" onClick={() => void undo()}>撤销</button>}
            <button type="button" onClick={createAnother}>再建一个</button>
          </div>
        </section> : <>
          <label className="quick-create__type">记录类型<select aria-label="记录类型" value={type} onChange={(event) => { setType(event.target.value as QuickCreateType); setError(''); setState('idle') }}>
            {types.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select></label>
          {inherited.length > 0 && <div className="quick-create__context" aria-label="继承上下文">{inherited.map((item) => <span key={item}>{item}</span>)}</div>}
          <label className="quick-create__title">标题<input ref={inputRef} value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <button className="quick-create__advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>{advanced ? '收起高级字段' : '展开高级字段'}</button>
          {advanced && <label className="quick-create__details">补充说明<textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={5} /></label>}
          {type === 'project' && !context.goalId && <p className="quick-create__requirement">项目需要从一个已加载的目标上下文创建。</p>}
          {type === 'shopping-item' && context.sourceType !== 'life-item' && <p className="quick-create__requirement">采购项需要从一个已加载的生活条目上下文创建。</p>}
          {type === 'actual-meal' && context.sourceType !== 'day-plan-item' && <p className="quick-create__requirement">实际完成需要从一个已加载的日计划条目创建。</p>}
          {state === 'error' && <p role="alert">{error}</p>}
          <button className="workspace-primary" type={state === 'error' ? 'button' : 'submit'} disabled={!title.trim() || state === 'submitting'} onClick={state === 'error' ? () => void submit() : undefined}>
            {state === 'submitting' ? '正在创建' : state === 'error' ? '重试创建' : `创建${labels[type]}`}
          </button>
        </>}
      </motion.form>
    </motion.div>}
  </AnimatePresence>
}
