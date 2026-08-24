import type { Page, Route } from '@playwright/test'

const timestamp = '2026-08-21T02:00:00.000Z'

export const privateCoreState = {
  schemaVersion: 1,
  plans: [{
    id: 'plan-visual', title: '完成私人核心视觉验收', scheduledFor: '2026-08-21', status: 'done',
    createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp,
  }],
  records: [{
    id: 'record-visual', title: '私人核心视觉记录', body: '连续画布、真实状态与可回放证据必须同时成立。',
    occurredAt: timestamp, tags: ['P3-T7', '视觉'], pinned: true, archivedAt: null,
    links: [{ type: 'task', id: 'task-visual' }], mediaIds: [], coverMediaId: null, version: 1,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  }],
  reviews: [{
    id: 'review-legacy-visual', periodStart: '2026-08-15', periodEnd: '2026-08-21',
    summary: '页面结构服从任务，局部状态不污染整个工作台。',
    insights: ['先核事实，再推进状态。'],
    evidence: [{ type: 'record', sourceId: 'record-visual', title: '私人核心视觉记录', excerpt: '连续画布与证据。' }],
    createdAt: timestamp,
  }],
  knowledge: [{
    id: 'knowledge-visual', source: { type: 'review', id: 'review-legacy-visual' }, title: '验收经验',
    body: '四断点验收必须包含真实浏览器和逐图复核。', tags: ['LifeOps', '验收'], createdAt: timestamp,
  }],
  snapshots: [{
    id: 'snapshot-visual', slug: 'private-core-visual', source: { type: 'knowledge', id: 'knowledge-visual' },
    title: '私人核心视觉证据', excerpt: '这是明确选择后生成的公开副本。', visibility: 'private', createdAt: timestamp,
  }],
}

const goal = {
  id: 'goal-visual', title: '高质量完成 LifeOps', description: '从行为、视觉和失败状态三条证据链验收。',
  status: 'active', priority: 1, startsOn: '2026-08-01', targetOn: '2026-08-31', progressMode: 'manual',
  manualProgress: 72, version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
}

const project = {
  id: 'project-visual', goalId: goal.id, title: '私人核心工作台', description: '按批准设计形成连续工作面。',
  riskNote: '旧证据不能替代本轮验收', status: 'active', startsOn: '2026-08-01', targetOn: '2026-08-31',
  progress: 68, nextTaskId: 'task-visual', version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
}

const milestone = {
  id: 'milestone-visual', projectId: project.id, title: '通过 P3-T7', dueOn: '2026-08-21', completedAt: null,
  position: 10, version: 1, deletedAt: null,
}

const tasks = [
  {
    id: 'task-visual', goalId: goal.id, projectId: project.id, milestoneId: milestone.id, title: '完成四断点验收',
    description: '打开并逐页核对原始私人核心。', startsAt: '2026-08-21T09:00:00', endsAt: '2026-08-21T10:30:00',
    dueAt: '2026-08-21T12:00:00', estimateMinutes: 90, priority: 1, tags: ['P3-T7'], status: 'doing',
    checklist: [], recurrence: null, version: 1, createdAt: timestamp, updatedAt: timestamp, completedAt: null, deletedAt: null,
  },
  {
    id: 'task-unscheduled-visual', goalId: goal.id, projectId: project.id, milestoneId: null, title: '整理逐图结论',
    description: '记录八个视觉维度的结论。', startsAt: null, endsAt: null, dueAt: '2026-08-22T09:00:00',
    estimateMinutes: 45, priority: 2, tags: ['证据'], status: 'planned', checklist: [], recurrence: null, version: 1,
    createdAt: timestamp, updatedAt: timestamp, completedAt: null, deletedAt: null,
  },
]

const scheduleBlocks = [{
  id: 'block-visual', taskId: 'task-visual', startsAt: '2026-08-21T09:00:00', endsAt: '2026-08-21T10:30:00', version: 1,
}]

const habits = [
  {
    id: 'habit-visual', goalId: goal.id, projectId: project.id, title: '逐页复核', description: '每天打开证据并写下判断。',
    measure: 'count', unit: '页', targetValue: 8, status: 'active', pausedAt: null, timezone: 'Asia/Shanghai',
    schedule: { scheduleType: 'daily', startsOn: '2026-08-01', endsOn: null }, version: 1,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  },
  {
    id: 'habit-rhythm-visual', goalId: goal.id, projectId: project.id, title: '运动恢复', description: '只记录事实，不做惩罚。',
    measure: 'duration', unit: '分钟', targetValue: 30, status: 'active', pausedAt: null, timezone: 'Asia/Shanghai',
    schedule: { scheduleType: 'weekdays', weekdays: [1, 3, 5], startsOn: '2026-08-01', endsOn: null }, version: 1,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  },
]

const habitEntries = [
  { id: 'entry-done-visual', habitId: 'habit-visual', entryDate: '2026-08-18', status: 'done', value: 8, note: '', version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
  { id: 'entry-partial-visual', habitId: 'habit-visual', entryDate: '2026-08-19', status: 'partial', value: 5, note: '仍需复核移动端', version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
  { id: 'entry-skip-visual', habitId: 'habit-visual', entryDate: '2026-08-20', status: 'intentional-skip', value: null, note: '主动留出修复窗口', version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null },
]

const records = privateCoreState.records

const knowledgeNotes = [{
  id: 'knowledge-visual', title: '验收经验', body: '# 四断点验收\n\n真实浏览器和逐图复核必须同时成立。',
  tags: ['LifeOps', '验收'], collectionIds: ['collection-visual'],
  sourceLinks: [{ type: 'review', id: 'review-legacy-visual' }], relatedIds: [],
  pinned: true, favorite: false, reviewOn: '2026-08-28', version: 1,
  createdAt: timestamp, updatedAt: timestamp, archivedAt: null, deletedAt: null,
}]

const knowledgeCollections = [{
  id: 'collection-visual', name: '验收', color: '#2E6F65', position: 1, version: 1,
}]

const review = {
  id: 'review-visual', type: 'weekly', period: { from: '2026-08-15', to: '2026-08-21' }, status: 'draft',
  achievements: ['原始私人核心页面均已实现'], problems: ['需要完成四断点统一复核'], causes: ['跨域证据尚未集中'],
  insights: ['局部失败必须停留在局部'], nextChanges: ['完成视觉证据与回放'],
  evidence: {
    period: { from: '2026-08-15', to: '2026-08-21' }, goals: { active: 1, completed: 0 },
    projects: { active: 1, completed: 0 }, tasks: { total: 2, completed: 0, skipped: 0, cancelled: 0 },
    habits: { entries: 3, done: 1, partial: 1, intentionalSkips: 1 }, records: { total: 1, ids: ['record-visual'] },
    priorCommitments: [{ reviewId: 'review-prior-visual', text: '完成私人核心', status: 'pending' }], hasFacts: true,
  },
  actions: [{
    id: 'action-visual', text: '把逐图结论转为下一步', status: 'pending', convertedTarget: null, convertedId: null,
    version: 1, createdAt: timestamp, updatedAt: timestamp,
  }],
  version: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
}

const publishingDraft = {
  id: 'publishing-visual', category: 'learning', source: { type: 'knowledge', id: 'knowledge-visual', version: 1 },
  title: '知识与发布边界', excerpt: '公开的是经过确认的不可变副本。',
  body: '# 知识与发布边界\n\n私人来源留在工作台，公开页面只读取 revision 白名单。',
  coverUrl: null, tags: ['LifeOps', '发布'], slug: 'publishing-visual', scheduledAt: null, featured: true,
  seo: { title: '知识与发布边界', description: '公开副本、隐私门禁与 revision 证据。' },
  status: 'draft', version: 2, createdAt: timestamp, updatedAt: timestamp,
}

const publishingRevision = {
  id: 'publishing-revision-visual', draftId: publishingDraft.id, sourceVersion: 1, revision: 1,
  category: publishingDraft.category, slug: publishingDraft.slug, title: publishingDraft.title,
  excerpt: publishingDraft.excerpt, body: publishingDraft.body, coverUrl: null, tags: publishingDraft.tags,
  featured: true, seo: publishingDraft.seo, publishedAt: timestamp, updatedAt: timestamp,
}

const settingsDocument = {
  version: 1, updatedAt: timestamp,
  appearance: { theme: 'system', motion: 'system' },
  locale: { locale: 'zh-CN', timezone: 'Asia/Shanghai', weekStartsOn: 1 },
  defaults: { startRoute: '/app', quickCreateType: 'record' },
  life: { lowStockDays: 7, expiryWarningDays: 14, remindersEnabled: true },
  publicSite: { defaultVisibility: 'private', rssEnabled: true },
  connections: [
    { id: 'prometheus', label: 'Prometheus', state: 'disabled', detail: '未配置' },
    { id: 'obsidian', label: 'Obsidian', state: 'local-only', detail: '浏览器授权' },
  ],
}

export const contentVisualRoutes = [
  { slug: 'knowledge', path: '/app/knowledge?note=knowledge-visual', heading: '知识' },
  { slug: 'settings', path: '/app/settings', heading: '账户与设置' },
  { slug: 'publish', path: '/app/publish?status=draft&draft=publishing-visual', heading: '发布' },
  { slug: 'public-learning', path: '/learning', heading: '最近在学' },
  { slug: 'public-article', path: '/p/publishing-visual', heading: '知识与发布边界' },
] as const

export const privateCoreRoutes = [
  { slug: 'overview', path: '/app/overview', heading: '总览' },
  { slug: 'goals', path: '/app/goals?goal=goal-visual', heading: '目标与项目' },
  { slug: 'schedule', path: '/app/schedule?view=week&date=2026-08-21', heading: '日程' },
  { slug: 'habits', path: '/app/habits?habit=habit-visual', heading: '习惯' },
  { slug: 'records', path: '/app/records?record=record-visual', heading: '记录' },
  { slug: 'reviews', path: '/app/reviews?review=review-visual&period=weekly', heading: '回顾' },
  { slug: 'knowledge', path: '/app/knowledge?note=knowledge-visual', heading: '知识' },
  { slug: 'publish', path: '/app/publish?status=draft&draft=publishing-visual', heading: '发布' },
  { slug: 'settings', path: '/app/settings', heading: '账户与设置' },
] as const

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

export async function installPrivateCoreFixture(page: Page) {
  await page.addInitScript(({ session, state }) => {
    sessionStorage.setItem('lifeops:session:v1', JSON.stringify(session))
    localStorage.setItem('lifeops:data:v1', JSON.stringify(state))
  }, {
    session: { mode: 'local-preview', account: 'p3-t7-visual@lifeops.local' },
    state: privateCoreState,
  })

  await page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/v1/settings') return json(route, settingsDocument)
    if (request.method() === 'GET' && url.pathname === '/api/v1/account/sessions') return json(route, { sessions: [] })
    if (request.method() === 'GET' && url.pathname === '/api/v1/audit') return json(route, { events: [] })
    if (request.method() === 'POST' && url.pathname === `/api/v1/publishing/drafts/${publishingDraft.id}/preview`) {
      return json(route, {
        body: publishingRevision.body, category: publishingRevision.category, coverUrl: publishingRevision.coverUrl,
        excerpt: publishingRevision.excerpt, featured: publishingRevision.featured, publishedAt: publishingRevision.publishedAt,
        revision: publishingRevision.revision, slug: publishingRevision.slug, tags: publishingRevision.tags,
        title: publishingRevision.title, updatedAt: publishingRevision.updatedAt,
      })
    }
    if (request.method() !== 'GET') return json(route, { error: { code: 'READ_ONLY_FIXTURE', message: '视觉夹具只允许读取。' } }, 405)
    if (url.pathname === '/api/v1/goals') return json(route, [goal])
    if (url.pathname === `/api/v1/goals/${goal.id}/projects`) return json(route, [project])
    if (url.pathname === `/api/v1/projects/${project.id}/milestones`) return json(route, [milestone])
    if (url.pathname === '/api/v1/tasks') return json(route, tasks)
    if (url.pathname === '/api/v1/schedule-blocks') return json(route, scheduleBlocks)
    if (url.pathname === '/api/v1/schedule/conflicts') return json(route, [])
    if (url.pathname === '/api/v1/habits') return json(route, {
      from: url.searchParams.get('from'), to: url.searchParams.get('to'), habits, entries: habitEntries,
    })
    if (url.pathname === '/api/v1/records') return json(route, records)
    if (url.pathname === '/api/v1/reviews') return json(route, [review])
    if (url.pathname === '/api/v1/knowledge/collections') return json(route, knowledgeCollections)
    if (url.pathname === '/api/v1/knowledge/resurface') return json(route, knowledgeNotes)
    if (url.pathname === '/api/v1/knowledge') return json(route, { items: knowledgeNotes })
    if (url.pathname === '/api/v1/publishing/drafts') return json(route, [publishingDraft])
    if (url.pathname === `/api/v1/publishing/drafts/${publishingDraft.id}/revisions`) return json(route, [publishingRevision])
    if (url.pathname === '/api/v1/state') return json(route, privateCoreState)
    if (url.pathname === '/api/v1/public/content') return json(route, url.searchParams.get('category') === 'learning' ? [{
      id: publishingRevision.id, slug: publishingRevision.slug, category: publishingRevision.category,
      title: publishingRevision.title, excerpt: publishingRevision.excerpt, coverUrl: publishingRevision.coverUrl,
      publishedAt: publishingRevision.publishedAt, featured: publishingRevision.featured, revision: publishingRevision.revision,
    }] : [])
    if (url.pathname === `/api/v1/public/content/${publishingRevision.slug}`) return json(route, {
      body: publishingRevision.body, category: publishingRevision.category, coverUrl: publishingRevision.coverUrl,
      excerpt: publishingRevision.excerpt, featured: publishingRevision.featured, publishedAt: publishingRevision.publishedAt,
      revision: publishingRevision.revision, slug: publishingRevision.slug, tags: publishingRevision.tags,
      title: publishingRevision.title, updatedAt: publishingRevision.updatedAt,
    })
    if (url.pathname === '/api/v1/public/feed.xml') return route.fulfill({ status: 200, contentType: 'application/rss+xml', body: '<?xml version="1.0"?><rss version="2.0"><channel><title>LifeOps</title></channel></rss>' })
    return json(route, {})
  })
}
