import { expect, test } from '@playwright/test'
import { positionVerticalScrollOwner, probeVerticalScrollOwners, waitForStableFrameCadence } from './helpers/motionProbe'

const session = { mode: 'local-preview', account: 'p3-t7-overview@lifeops.local' }

test.beforeEach(async ({ page }) => {
  await page.bringToFront()
  await page.clock.setFixedTime(new Date('2026-08-21T09:00:00+08:00'))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/habits') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ from: '', to: '', habits: [], entries: [] }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.addInitScript((value) => {
    sessionStorage.setItem('lifeops:session:v1', JSON.stringify(value.session))
    localStorage.setItem('lifeops:data:v1', JSON.stringify(value.state))
  }, {
    session,
    state: {
      schemaVersion: 1,
      plans: [{
        id: 'task-overview',
        title: '完成私人核心验收',
        scheduledFor: '2026-08-21',
        status: 'done',
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T01:00:00.000Z',
        completedAt: '2026-08-21T01:00:00.000Z',
      }],
      records: [{
        id: 'record-overview',
        title: '私人核心验收记录',
        body: '真实发生过的验收事实。',
        occurredAt: '2026-08-21T01:30:00.000Z',
        tags: ['验收'],
        links: [],
        mediaIds: [],
        coverMediaId: null,
        pinned: false,
        archivedAt: null,
        version: 1,
        createdAt: '2026-08-21T01:30:00.000Z',
        updatedAt: '2026-08-21T01:30:00.000Z',
        deletedAt: null,
      }],
      reviews: [{
        id: 'review-overview',
        periodStart: '2026-08-15',
        periodEnd: '2026-08-21',
        summary: '完成了私人核心闭环。',
        insights: ['局部失败不能替换整个工作台。'],
        evidence: [{ type: 'record', sourceId: 'record-overview' }],
        createdAt: '2026-08-21T02:00:00.000Z',
      }],
      knowledge: [{
        id: 'knowledge-overview',
        source: { type: 'review', id: 'review-overview' },
        title: '验收经验',
        body: '先核事实，再推进状态。',
        tags: ['LifeOps'],
        reviewOn: '2026-08-21',
        createdAt: '2026-08-20T00:00:00.000Z',
      }],
      snapshots: [],
    },
  })
})

test('overview keeps one continuous command surface and every summary continues into its owning workspace', async ({ page }) => {
  await page.goto('/app/overview')

  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeFocused()
  await expect(page.locator('[data-private-shell]')).toHaveAttribute('data-workspace-theme', 'daylight')
  await expect(page.locator('.private-orrery')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '今日状态' })).toContainText('1 / 1')
  await expect(page.getByRole('region', { name: '今天时间线' })).toContainText('完成私人核心验收')
  await expect(page.getByRole('region', { name: '最近记录' })).toContainText('私人核心验收记录')
  await expect(page.getByRole('region', { name: '上次回顾' })).toContainText('局部失败不能替换整个工作台')
  await expect(page.getByRole('region', { name: '重新浮现的知识' })).toContainText('验收经验')

  const journeys = [
    { region: '今日状态', link: '快速创建', path: /\/app\/schedule\?create=task/ },
    { region: '今天时间线', link: '打开日程', path: /\/app\/schedule(?:\?|$)/ },
    { region: '当前重点', link: '添加优先目标', path: /\/app\/goals\?create=goal/ },
    { region: '习惯七日节奏', link: '记录一次习惯', path: /\/app\/habits(?:\?|$)/ },
    { region: '最近记录', link: '全部记录', path: /\/app\/records(?:\?|$)/ },
    { region: '上次回顾', link: '查看回顾', path: /\/app\/reviews(?:\?|$)/ },
    { region: '重新浮现的知识', link: '知识库', path: /\/app\/knowledge(?:\?|$)/ },
  ] as const

  for (const journey of journeys) {
    const link = page.getByRole('region', { name: journey.region }).getByRole('link', { name: journey.link })
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(journey.path)
    await page.goBack()
    await expect(page).toHaveURL(/\/app\/overview$/)
    await expect(link).toBeFocused()
  }

  await page.setViewportSize({ width: 390, height: 844 })
  const compactGeometry = await page.evaluate(() => {
    const root = document.documentElement
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0 || (rect.left >= -1 && rect.right <= root.clientWidth + 1)) return []
      let ancestor = element.parentElement
      while (ancestor && ancestor !== document.body) {
        const overflow = getComputedStyle(ancestor).overflowX
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden' || overflow === 'clip') return []
        ancestor = ancestor.parentElement
      }
      return [{ tag: element.tagName.toLowerCase(), className: element.className, left: Math.round(rect.left), right: Math.round(rect.right) }]
    }).slice(0, 12)
    const wideContainers = Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
      if (element.scrollWidth <= element.clientWidth + 1) return []
      return [{
        tag: element.tagName.toLowerCase(),
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
      }]
    }).slice(0, 16)
    return { fits: root.scrollWidth <= root.clientWidth + 1, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, offenders, wideContainers }
  })
  expect(compactGeometry.fits, JSON.stringify(compactGeometry)).toBe(true)
  await expect(page.getByRole('navigation', { name: '私人空间导航' })).toBeVisible()
})

test('private transitions retain the header and outgoing route, focus the destination, restore state and never expose a white frame', async ({ page, browserName }) => {
  await page.goto('/app/overview')
  const header = page.locator('.workspace-header')
  await header.evaluate((element) => { element.setAttribute('data-p3-t7-stable-header', 'true') })
  if (browserName === 'webkit') await waitForStableFrameCadence(page, 420, 12)
  await page.evaluate(() => {
    type Frame = { at: number; shell: boolean; header: boolean; panels: number; white: boolean }
    const runtime = window as typeof window & { __p3t7RouteFrames?: Frame[] }
    runtime.__p3t7RouteFrames = []
    const started = performance.now()
    const sample = (at: number) => {
      const shell = document.querySelector<HTMLElement>('[data-private-shell]')
      const color = shell ? getComputedStyle(shell).backgroundColor : ''
      runtime.__p3t7RouteFrames!.push({
        at,
        shell: Boolean(shell),
        header: Boolean(document.querySelector('.workspace-header')),
        panels: document.querySelectorAll('[data-route-key]').length,
        white: color === 'rgb(255, 255, 255)' || color === 'rgba(255, 255, 255, 1)',
      })
      if (at - started < 420) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })

  await page.getByRole('link', { name: '目标与项目', exact: true }).click()
  await expect(page.locator('[data-route-key="/app/overview"][aria-hidden="true"]')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: '目标与项目', level: 1 })).toBeFocused()
  await expect(header).toHaveAttribute('data-p3-t7-stable-header', 'true')
  await page.waitForTimeout(450)
  const frames = await page.evaluate(() => (window as typeof window & {
    __p3t7RouteFrames?: Array<{ at: number; shell: boolean; header: boolean; panels: number; white: boolean }>
  }).__p3t7RouteFrames ?? [])
  expect(frames.length).toBeGreaterThanOrEqual(12)
  expect(frames.every((frame) => frame.shell && frame.header && frame.panels >= 1 && !frame.white)).toBe(true)

  const records = Array.from({ length: 30 }, (_, index) => ({
    id: `record-history-${index}`,
    title: `状态恢复记录 ${index}`,
    body: '浏览器返回必须恢复筛选、选中和滚动。',
    occurredAt: `2026-08-${String(21 - (index % 18)).padStart(2, '0')}T01:00:00.000Z`,
    tags: ['LifeOps'], pinned: false, archivedAt: null, links: [], mediaIds: [], coverMediaId: null, version: 1,
    createdAt: '2026-08-21T01:00:00.000Z', updatedAt: '2026-08-21T01:00:00.000Z', deletedAt: null,
  }))
  await page.route('**/api/v1/records?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(records) }))
  await page.goto('/app/records?tag=LifeOps&q=%E4%BA%8B%E5%AE%9E&record=record-history-10')
  const filters = page.getByRole('search', { name: '筛选记录' })
  await expect(filters.getByLabel('标签')).toHaveValue('LifeOps')
  await expect(filters.getByLabel('正文搜索')).toHaveValue('事实')
  await expect(page.getByLabel('标题')).toHaveValue('状态恢复记录 10')
  const initialScrollOwners = await probeVerticalScrollOwners(page)
  const primaryScrollOwner = initialScrollOwners[0] ?? null
  const positionedScrollOwner = primaryScrollOwner
    ? await positionVerticalScrollOwner(page, primaryScrollOwner.key, Math.min(900, primaryScrollOwner.maxOffset))
    : null
  if (primaryScrollOwner) {
    expect(positionedScrollOwner?.offset).toBeGreaterThan(0)
  } else {
    expect(initialScrollOwners).toEqual([])
  }
  await page.getByRole('link', { name: '习惯', exact: true }).click()
  await page.goBack()
  await expect(page).toHaveURL(/tag=LifeOps.*q=%E4%BA%8B%E5%AE%9E.*record=record-history-10/)
  await expect(filters.getByLabel('标签')).toHaveValue('LifeOps')
  await expect(filters.getByLabel('正文搜索')).toHaveValue('事实')
  await expect(page.getByLabel('标题')).toHaveValue('状态恢复记录 10')
  if (positionedScrollOwner) {
    await expect.poll(async () => {
      const restored = await probeVerticalScrollOwners(page)
      return restored.find((owner) => owner.key === positionedScrollOwner.key)?.offset ?? -1
    }).toBeGreaterThan(positionedScrollOwner.offset - 2)
  } else {
    await expect.poll(() => probeVerticalScrollOwners(page)).toEqual([])
  }
})
