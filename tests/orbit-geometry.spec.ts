import { expect, test } from '@playwright/test'
import { measureOrbitPathDistances } from './helpers/motionProbe'

const expectedPlayheads = {
  now: 30,
  doing: 40,
  learning: 40,
  moments: 50,
  archive: 60,
} as const

const expectedRings = [
  { id: 'orbit-a', base: 353, screen: 300.05, direction: 'ccw', duration: 30 },
  { id: 'orbit-b', base: 501, screen: 425.85, direction: 'cw', duration: 40 },
  { id: 'orbit-c', base: 649, screen: 551.65, direction: 'cw', duration: 50 },
  { id: 'orbit-d', base: 797, screen: 677.45, direction: 'ccw', duration: 60 },
] as const

for (const viewport of [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1024', width: 1024, height: 768 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'phone-390', width: 390, height: 844 },
] as const) {
  test(`reference objects settle on four complete concentric rings at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')

    const periods = await page.locator('[data-public-object]').evaluateAll((objects) => Object.fromEntries(objects.map((object) => [
      object.getAttribute('data-public-object'),
      Number(object.getAttribute('data-period-seconds')),
    ])))
    expect(periods).toEqual(expectedPlayheads)

    const rings = await page.locator('[data-orbit-ring]').evaluateAll((elements) => elements.map((element) => ({
      base: Number(element.getAttribute('data-base-diameter')),
      direction: element.getAttribute('data-direction'),
      duration: Number(element.getAttribute('data-duration')),
      id: element.getAttribute('data-orbit-ring'),
      screen: Number(element.getAttribute('data-screen-diameter')),
      trackWidth: Number(element.getAttribute('data-track-width')),
    })))
    expect(rings).toEqual(expectedRings.map((ring) => ({ ...ring, trackWidth: 1 })))

    const boundaries = await page.locator('[data-orbit-boundary]').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { centerX: box.x + box.width / 2, centerY: box.y + box.height / 2, width: box.width }
    }))
    expect(boundaries).toHaveLength(4)
    expect(Math.max(...boundaries.map((ring) => ring.centerX)) - Math.min(...boundaries.map((ring) => ring.centerX))).toBeLessThanOrEqual(0.5)
    expect(Math.max(...boundaries.map((ring) => ring.centerY)) - Math.min(...boundaries.map((ring) => ring.centerY))).toBeLessThanOrEqual(0.5)
    expect(boundaries.map((ring) => ring.width)).toEqual([...boundaries.map((ring) => ring.width)].sort((a, b) => a - b))

    const outer = boundaries.at(-1)!
    expect(outer.centerX - outer.width / 2).toBeGreaterThanOrEqual(15)
    expect(outer.centerY - outer.width / 2).toBeGreaterThanOrEqual(15)
    expect(outer.centerX + outer.width / 2).toBeLessThanOrEqual(viewport.width - 15)
    expect(outer.centerY + outer.width / 2).toBeLessThanOrEqual(viewport.height - 15)

    const semanticObjects = await page.locator('[data-public-object]').evaluateAll((objects) => objects.map((object) => ({
      angle: Number(object.getAttribute('data-object-angle')),
      attached: object.getAttribute('data-track-attached'),
      delay: Number(object.getAttribute('data-arrival-delay')),
      glyph: object.getAttribute('data-orbit-glyph'),
      label: object.querySelector('[data-orbit-label="always"]')?.textContent,
      orbitId: object.getAttribute('data-orbit-id'),
      upright: object.getAttribute('data-glyph-upright'),
    })))
    expect(semanticObjects.map((object) => object.glyph)).toEqual([
      'sundial',
      'navigation-flag',
      'open-book',
      'viewfinder',
      'tree-ring',
    ])
    expect(semanticObjects.map((object) => object.angle)).toEqual([314, 236, 161, 96, 88])
    expect(semanticObjects.map((object) => object.delay)).toEqual([0.6, 0.8, 1, 1.2, 1.4])
    expect(new Set(semanticObjects.map((object) => object.orbitId)).size).toBe(4)
    expect(semanticObjects.every((object) => object.attached === 'true' && object.upright === 'true')).toBe(true)
    expect(semanticObjects.map((object) => object.label)).toEqual(['此刻', '正在做', '最近在学', '生活切片', '时间档案'])

    await page.waitForTimeout(2_250)
    const samples = await measureOrbitPathDistances(page, 24)
    expect(samples).toHaveLength(120)
    expect(Math.max(...samples.map((sample) => sample.distance)), JSON.stringify(samples.filter((sample) => sample.distance > 4))).toBeLessThanOrEqual(4)
  })
}
