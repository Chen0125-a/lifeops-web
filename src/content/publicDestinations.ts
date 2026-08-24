export type PublicDestinationSlug =
  | 'now'
  | 'doing'
  | 'learning'
  | 'moments'
  | 'archive'

export type PublicDestinationGlyph =
  | 'sundial'
  | 'navigation-flag'
  | 'open-book'
  | 'viewfinder'
  | 'tree-ring'

export interface PublicDestination {
  slug: PublicDestinationSlug
  label: string
  shortLabel: string
  description: string
  glyph: PublicDestinationGlyph
  orbitId: 'orbit-a' | 'orbit-b' | 'orbit-c' | 'orbit-d'
  periodSeconds: 30 | 40 | 50 | 60
  phase: number
  angleDegrees: 314 | 236 | 161 | 96 | 88
  arrivalDelaySeconds: 0.6 | 0.8 | 1 | 1.2 | 1.4
  objectSize: 44 | 60 | 68
  color: string
}

export const publicDestinations: readonly PublicDestination[] = [
  {
    slug: 'now',
    label: '此刻',
    shortLabel: '此刻',
    description: '从此刻的光线与节奏，看见正在发生的生活。',
    glyph: 'sundial',
    orbitId: 'orbit-a',
    periodSeconds: 30,
    phase: 0,
    angleDegrees: 314,
    arrivalDelaySeconds: 0.6,
    objectSize: 44,
    color: '#C78A17',
  },
  {
    slug: 'doing',
    label: '正在做',
    shortLabel: '在做',
    description: '沿着尚在生长的行动，进入今日的进行时。',
    glyph: 'navigation-flag',
    orbitId: 'orbit-b',
    periodSeconds: 40,
    phase: 0,
    angleDegrees: 236,
    arrivalDelaySeconds: 0.8,
    objectSize: 44,
    color: '#2F68C7',
  },
  {
    slug: 'learning',
    label: '最近在学',
    shortLabel: '在学',
    description: '翻开近期反复琢磨、练习与沉淀的内容。',
    glyph: 'open-book',
    orbitId: 'orbit-b',
    periodSeconds: 40,
    phase: 0,
    angleDegrees: 161,
    arrivalDelaySeconds: 1,
    objectSize: 60,
    color: '#2A7A56',
  },
  {
    slug: 'moments',
    label: '生活切片',
    shortLabel: '切片',
    description: '透过取景框，拾起被日常光线保留下来的瞬间。',
    glyph: 'viewfinder',
    orbitId: 'orbit-c',
    periodSeconds: 50,
    phase: 0,
    angleDegrees: 96,
    arrivalDelaySeconds: 1.2,
    objectSize: 68,
    color: '#C2564F',
  },
  {
    slug: 'archive',
    label: '时间档案',
    shortLabel: '档案',
    description: '顺着年轮回望长期积累的选择、变化与痕迹。',
    glyph: 'tree-ring',
    orbitId: 'orbit-d',
    periodSeconds: 60,
    phase: 0,
    angleDegrees: 88,
    arrivalDelaySeconds: 1.4,
    objectSize: 68,
    color: '#6857A8',
  },
] as const

export const getPublicDestination = (slug: string) =>
  publicDestinations.find((destination) => destination.slug === slug)
