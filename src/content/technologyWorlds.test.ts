import { describe, expect, it } from 'vitest'
import { technologyWorlds } from './technologyWorlds'

describe('technology world registry', () => {
  it('places all ten technologies on real orbit tracks', () => {
    expect(technologyWorlds).toHaveLength(10)
    expect(new Set(technologyWorlds.map((world) => world.slug)).size).toBe(10)
    expect(technologyWorlds.every((world) => Number.isInteger(world.orbitIndex))).toBe(true)
    expect(technologyWorlds.every((world) => world.orbitIndex >= 0 && world.orbitIndex <= 3)).toBe(true)
    expect(technologyWorlds.find((world) => world.slug === 'argo-cd')?.orbitIndex).toBeDefined()
    expect(technologyWorlds.find((world) => world.slug === 'git')?.orbitIndex).toBeDefined()
  })

  it('contains honest content and primary HTTPS references for every world', () => {
    for (const world of technologyWorlds) {
      expect(world.role.length).toBeGreaterThan(20)
      expect(world.currentUse.length).toBeGreaterThan(20)
      expect(world.architecture.length).toBeGreaterThan(20)
      expect(world.learningNotes.length).toBeGreaterThan(0)
      expect(world.officialUrl).toMatch(/^https:\/\//)
    }
  })
})
