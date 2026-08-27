import type { Page } from '@playwright/test'

export interface MotionFrame {
  at: number
  pathname: string
  shell: boolean
  main: boolean
  routePanels: number
  whiteFrame: boolean
  activeElement: string
}

export interface ScrollOwnerEvidence {
  key: string
  maxOffset: number
  offset: number
}

export async function probeVerticalScrollOwners(page: Page): Promise<ScrollOwnerEvidence[]> {
  return page.evaluate(() => {
    const scrollingElement = document.scrollingElement as HTMLElement | null
    const nested = [...document.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const overflowY = getComputedStyle(element).overflowY
        return ['auto', 'scroll', 'overlay'].includes(overflowY)
          && element.scrollHeight > element.clientHeight + 2
      })
      .map((element, index) => ({
        element,
        key: `element:${element.id || element.getAttribute('data-route-key') || element.className || element.tagName}:${index}`,
      }))
    return [
      ...(scrollingElement ? [{ element: scrollingElement, key: 'document' }] : []),
      ...nested,
    ]
      .map(({ element, key }) => {
        const maxOffset = Math.max(0, element.scrollHeight - element.clientHeight)
        const initialOffset = element.scrollTop
        const probeOffset = initialOffset > 0 ? initialOffset - 1 : Math.min(1, maxOffset)
        element.scrollTop = probeOffset
        const acceptsScroll = element.scrollTop !== initialOffset
        element.scrollTop = initialOffset
        return { acceptsScroll, element, key, maxOffset }
      })
      .filter(({ acceptsScroll, maxOffset }) => acceptsScroll && maxOffset > 2)
      .sort((left, right) => right.maxOffset - left.maxOffset)
      .map(({ element, key, maxOffset }) => ({ key, maxOffset, offset: element.scrollTop }))
  })
}

export async function positionVerticalScrollOwner(
  page: Page,
  key: string,
  requestedOffset: number,
): Promise<ScrollOwnerEvidence | null> {
  return page.evaluate(async ({ ownerKey, offset }) => {
    const scrollingElement = document.scrollingElement as HTMLElement | null
    const nested = [...document.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const overflowY = getComputedStyle(element).overflowY
        return ['auto', 'scroll', 'overlay'].includes(overflowY)
          && element.scrollHeight > element.clientHeight + 2
      })
      .map((element, index) => ({
        element,
        key: `element:${element.id || element.getAttribute('data-route-key') || element.className || element.tagName}:${index}`,
      }))
    const candidate = [
      ...(scrollingElement ? [{ element: scrollingElement, key: 'document' }] : []),
      ...nested,
    ].find(({ key: candidateKey }) => candidateKey === ownerKey)
    if (!candidate) return null
    const maxOffset = Math.max(0, candidate.element.scrollHeight - candidate.element.clientHeight)
    candidate.element.scrollTop = Math.min(Math.max(0, offset), maxOffset)
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
    return { key: candidate.key, maxOffset, offset: candidate.element.scrollTop }
  }, { ownerKey: key, offset: requestedOffset })
}

export async function recordMotionFrames(page: Page, durationMs: number) {
  return page.evaluate(async (duration) => {
    const frames: MotionFrame[] = []
    const started = performance.now()
    await new Promise<void>((resolve) => {
      const sample = (at: number) => {
        const surface = document.querySelector<HTMLElement>('[data-private-shell], .public-home, .public-detail')
        const color = surface ? getComputedStyle(surface).backgroundColor : ''
        frames.push({
          at: Math.round((at - started) * 100) / 100,
          pathname: location.pathname,
          shell: Boolean(document.querySelector('[data-private-shell]')),
          main: Boolean(document.querySelector('main')),
          routePanels: document.querySelectorAll('[data-route-key]').length,
          whiteFrame: !surface || color === 'rgb(255, 255, 255)' || color === 'rgba(255, 255, 255, 1)',
          activeElement: document.activeElement instanceof HTMLElement
            ? document.activeElement.getAttribute('aria-label') || document.activeElement.textContent?.trim() || document.activeElement.tagName
            : '',
        })
        if (at - started < duration) requestAnimationFrame(sample)
        else resolve()
      }
      requestAnimationFrame(sample)
    })
    return frames
  }, durationMs)
}

export async function waitForStableFrameCadence(
  page: Page,
  durationMs: number,
  minimumFrames: number,
) {
  const deadline = Date.now() + 12_000
  let observed = 0
  let stableWindows = 0

  while (Date.now() < deadline) {
    await page.bringToFront()
    observed = await page.evaluate(async (duration) => {
      let frames = 0
      const started = performance.now()
      await new Promise<void>((resolve) => {
        const sample = (at: number) => {
          frames += 1
          if (at - started < duration) requestAnimationFrame(sample)
          else resolve()
        }
        requestAnimationFrame(sample)
      })
      return frames
    }, durationMs)

    stableWindows = observed >= minimumFrames ? stableWindows + 1 : 0
    if (stableWindows >= 2) return
    await page.waitForTimeout(80)
  }

  throw new Error(`Foreground frame cadence did not hold ${minimumFrames} frames in ${durationMs}ms for two consecutive windows; observed ${observed}`)
}

export async function measureOrbitPathDistances(page: Page, frameCount = 50) {
  return page.evaluate(async (count) => {
    const results: Array<{ frame: number; slug: string; distance: number }> = []
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const objects = [...document.querySelectorAll<HTMLElement>('[data-public-object]')]
      for (const object of objects) {
        const orbitId = object.dataset.orbitId
        const path = document.querySelector<SVGPathElement>(`[data-orbit-path="${orbitId}"]`)
        const anchor = object.querySelector<HTMLElement>('.public-object__anchor')
        if (!path || !anchor) continue
        const matrix = path.getScreenCTM()
        // ADR-028 keeps the moving object's root/anchor on the path while the
        // authored glyph may hang from that root through a short connector.
        const box = anchor.getBoundingClientRect()
        if (!matrix) continue
        const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
        const length = path.getTotalLength()
        let nearest = Number.POSITIVE_INFINITY
        for (let index = 0; index <= 720; index += 1) {
          const point = path.getPointAtLength(length * index / 720).matrixTransform(matrix)
          nearest = Math.min(nearest, Math.hypot(point.x - center.x, point.y - center.y))
        }
        results.push({ frame, slug: object.dataset.publicObject ?? '', distance: nearest })
      }
    }
    return results
  }, frameCount)
}
