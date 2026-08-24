import { describe, expect, it } from 'vitest'
import { getPublicDestination, publicDestinations } from './publicDestinations'

describe('public destinations', () => {
  it('defines the five approved public destinations in route order', () => {
    expect(publicDestinations.map((item) => [item.slug, `/${item.slug}`, item.glyph])).toEqual([
      ['now', '/now', 'sundial'],
      ['doing', '/doing', 'navigation-flag'],
      ['learning', '/learning', 'open-book'],
      ['moments', '/moments', 'viewfinder'],
      ['archive', '/archive', 'tree-ring'],
    ])
  })

  it('inherits the exact four ring periods and approved arrival wave', () => {
    expect(publicDestinations.map((item) => item.periodSeconds)).toEqual([30, 40, 40, 50, 60])
    expect(publicDestinations.map((item) => item.angleDegrees)).toEqual([314, 236, 161, 96, 88])
    expect(publicDestinations.map((item) => item.arrivalDelaySeconds)).toEqual([0.6, 0.8, 1, 1.2, 1.4])
  })

  it('uses all four authored orbit identities', () => {
    expect(new Set(publicDestinations.map((item) => item.orbitId))).toEqual(
      new Set(['orbit-a', 'orbit-b', 'orbit-c', 'orbit-d']),
    )
  })

  it('keeps a visible Chinese label and compact label for every destination', () => {
    expect(publicDestinations.map((item) => item.label)).toEqual([
      '此刻',
      '正在做',
      '最近在学',
      '生活切片',
      '时间档案',
    ])
    expect(publicDestinations.every((item) => item.shortLabel.trim().length > 0 && item.shortLabel.length <= 4)).toBe(true)
  })

  it('does not promote technology marks into the destination model', () => {
    expect(publicDestinations.every((item) => !('technologyMark' in item) && !('sourceTech' in item))).toBe(true)
  })

  it('finds an approved destination without inventing missing content', () => {
    expect(getPublicDestination('doing')?.label).toBe('正在做')
    expect(getPublicDestination('missing')).toBeUndefined()
  })
})
