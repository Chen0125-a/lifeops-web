const root = ['lifeops'] as const

function entityKeys(entity: string) {
  const all = [...root, entity] as const
  return {
    all,
    lists: [...all, 'list'] as const,
    list: (filters: Readonly<Record<string, unknown>> = {}) => [...all, 'list', filters] as const,
    details: [...all, 'detail'] as const,
    detail: (id: string) => [...all, 'detail', id] as const,
  }
}

export const queryKeys = {
  all: root,
  auth: {
    all: [...root, 'auth'] as const,
    session: [...root, 'auth', 'session'] as const,
  },
  goals: entityKeys('goals'),
  projects: entityKeys('projects'),
  milestones: entityKeys('milestones'),
  tasks: entityKeys('tasks'),
  schedule: entityKeys('schedule'),
  habits: entityKeys('habits'),
  records: entityKeys('records'),
  reviews: entityKeys('reviews'),
  knowledge: entityKeys('knowledge'),
  publishing: entityKeys('publishing'),
  platform: entityKeys('platform'),
  snapshots: entityKeys('snapshots'),
  life: entityKeys('life'),
  lifeCatalog: entityKeys('life-catalog'),
  lifeTaxonomy: entityKeys('life-taxonomy'),
  lifeUnits: entityKeys('life-units'),
  lifeTrash: entityKeys('life-trash'),
  lifeInventory: entityKeys('life-inventory'),
  lifeRecipes: entityKeys('life-recipes'),
  lifePlanning: entityKeys('life-planning'),
  lifeCommerce: entityKeys('life-commerce'),
} as const
