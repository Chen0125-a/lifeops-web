export const SEARCH_TYPES = [
  'goal', 'project', 'task', 'record', 'review', 'knowledge', 'public-draft',
  'life-item', 'recipe', 'medicine', 'fitness', 'household-item', 'shopping-item',
  'day-plan', 'cooking-record',
] as const

export type SearchType = typeof SEARCH_TYPES[number]

export interface SearchDocument {
  userId: string
  type: SearchType
  sourceId: string
  title: string
  bodyText: string
  tagsText: string
  sourceText: string
  updatedAt: string
  deletedAt: string | null
}

export interface SearchResult {
  type: SearchType
  id: string
  title: string
  excerpt: string
  context: string
  updatedAt: string
  route: string
}

export interface SearchInput {
  query: string
  types?: SearchType[]
  limit?: number
}

export interface SearchStore {
  search(userId: string, input: SearchInput): Promise<SearchResult[]>
}

const typeSet = new Set<string>(SEARCH_TYPES)
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
const plainText = (value: string) => value.replace(/[<>]/gu, '').replace(/\s+/gu, ' ').trim()

export function parseSearchTypes(values: readonly string[]): SearchType[] {
  const types = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  if (types.some((type) => !typeSet.has(type))) throw new Error('UNSUPPORTED_SEARCH_TYPE')
  return types as SearchType[]
}

function routeFor(document: SearchDocument) {
  const id = encodeURIComponent(document.sourceId)
  switch (document.type) {
    case 'goal': return `/app/goals?goal=${id}`
    case 'project': return `/app/goals?project=${id}`
    case 'task': return `/app/schedule?task=${id}`
    case 'record': return `/app/records?record=${id}`
    case 'review': return `/app/reviews?review=${id}`
    case 'knowledge': return `/app/knowledge?note=${id}`
    case 'public-draft': return `/app/publish?draft=${id}`
    case 'life-item': return `/app/life/ingredients?item=${id}`
    case 'recipe': return `/app/life/recipes?recipe=${id}`
    case 'medicine': return `/app/life/medicine?item=${id}`
    case 'fitness': return `/app/life/fitness?activity=${id}`
    case 'household-item': return `/app/life/household?item=${id}`
    case 'shopping-item': return `/app/life/shopping?item=${id}`
    case 'day-plan': return `/app/life/plans?day=${id}`
    case 'cooking-record': return `/app/life/recipes?cooking=${id}`
  }
}

function matchingText(document: SearchDocument, query: string) {
  const fields = [document.title, document.tagsText, document.bodyText, document.sourceText].map(normalize)
  if (fields[0] === query) return { score: 4, excerpt: document.title }
  if (fields[0].includes(query)) return { score: 3, excerpt: document.title }
  if (fields[1].includes(query)) return { score: 2, excerpt: document.tagsText }
  if (fields[2].includes(query)) return { score: 1, excerpt: document.bodyText }
  if (fields[3].includes(query)) return { score: 1, excerpt: document.sourceText }
  return undefined
}

export function searchDocuments(documents: readonly SearchDocument[], input: SearchInput & { userId: string }): SearchResult[] {
  const query = normalize(input.query)
  if (!query) return []
  const types = input.types ? parseSearchTypes(input.types) : undefined
  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 20)))

  return documents
    .filter((document) => document.userId === input.userId && document.deletedAt == null)
    .filter((document) => !types || types.includes(document.type))
    .map((document) => ({ document, match: matchingText(document, query) }))
    .filter((entry): entry is { document: SearchDocument; match: { score: number; excerpt: string } } => Boolean(entry.match))
    .sort((left, right) => right.match.score - left.match.score
      || right.document.updatedAt.localeCompare(left.document.updatedAt)
      || left.document.sourceId.localeCompare(right.document.sourceId))
    .slice(0, limit)
    .map(({ document, match }) => ({
      type: document.type,
      id: document.sourceId,
      title: plainText(document.title),
      excerpt: plainText(match.excerpt).slice(0, 220),
      context: plainText(document.sourceText || document.tagsText || document.updatedAt.slice(0, 10)).slice(0, 220),
      updatedAt: document.updatedAt,
      route: routeFor(document),
    }))
}
