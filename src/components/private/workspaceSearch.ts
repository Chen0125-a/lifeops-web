import { SEARCH_TYPES, type SearchResult, type SearchType } from '../../api/searchApi'

export const SEARCH_RECENT_KEY = 'lifeops.search.recent'

export const searchTypeLabels: Record<SearchType, string> = {
  goal: '目标', project: '项目', task: '任务', record: '记录', review: '回顾', knowledge: '知识',
  'public-draft': '发布草稿', 'life-item': '生活条目', recipe: '食谱', medicine: '用药事实', fitness: '运动',
  'household-item': '家居物品', 'shopping-item': '购物项', 'day-plan': '日计划', 'cooking-record': '烹饪记录',
}

const groupDefinitions: Array<{ id: string; label: string; types: SearchType[] }> = [
  { id: 'work', label: '工作推进', types: ['goal', 'project', 'task'] },
  { id: 'records', label: '记录与回顾', types: ['record', 'review'] },
  { id: 'knowledge', label: '知识沉淀', types: ['knowledge'] },
  { id: 'life', label: '生活管理', types: ['life-item', 'recipe', 'medicine', 'fitness', 'household-item', 'shopping-item', 'day-plan', 'cooking-record'] },
  { id: 'publishing', label: '公开发布', types: ['public-draft'] },
]

export function groupSearchResults(results: readonly SearchResult[]) {
  return groupDefinitions
    .map((group) => ({ id: group.id, label: group.label, items: results.filter((result) => group.types.includes(result.type)) }))
    .filter((group) => group.items.length > 0)
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SearchResult>
  return typeof item.id === 'string' && typeof item.title === 'string' && typeof item.excerpt === 'string'
    && typeof item.context === 'string' && typeof item.updatedAt === 'string' && typeof item.route === 'string'
    && item.route.startsWith('/app/') && SEARCH_TYPES.includes(item.type as SearchType)
}

export function readRecentSearchResults(storage: Pick<Storage, 'getItem'>): SearchResult[] {
  try {
    const parsed = JSON.parse(storage.getItem(SEARCH_RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter(isSearchResult).slice(0, 6) : []
  } catch {
    return []
  }
}

export function rememberSearchResult(storage: Pick<Storage, 'getItem' | 'setItem'>, result: SearchResult) {
  const recent = readRecentSearchResults(storage).filter((item) => item.type !== result.type || item.id !== result.id)
  storage.setItem(SEARCH_RECENT_KEY, JSON.stringify([result, ...recent].slice(0, 6)))
}
