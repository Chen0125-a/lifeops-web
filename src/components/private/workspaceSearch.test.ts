import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../../api/searchApi'
import { groupSearchResults, readRecentSearchResults, rememberSearchResult } from './workspaceSearch'

const task: SearchResult = { type: 'task', id: 't1', title: '完成视觉验收', excerpt: '关闭 P5', context: '日程', updatedAt: '2026-08-23T00:00:00.000Z', route: '/app/schedule?task=t1' }
const note: SearchResult = { type: 'knowledge', id: 'k1', title: '检索证据', excerpt: '搜索契约', context: '知识', updatedAt: '2026-08-22T00:00:00.000Z', route: '/app/knowledge?note=k1' }
const recipe: SearchResult = { type: 'recipe', id: 'r1', title: '恢复餐', excerpt: '鸡胸肉', context: '食谱', updatedAt: '2026-08-21T00:00:00.000Z', route: '/app/life/recipes?recipe=r1' }

describe('searchWorkspace', () => {
  it('groups all accepted result types into stable product domains', () => {
    expect(groupSearchResults([task, note, recipe])).toEqual([
      { id: 'work', label: '工作推进', items: [task] },
      { id: 'knowledge', label: '知识沉淀', items: [note] },
      { id: 'life', label: '生活管理', items: [recipe] },
    ])
  })

  it('stores only bounded, route-safe recent destinations and ignores malformed storage', () => {
    const storage = window.sessionStorage
    storage.clear()
    rememberSearchResult(storage, task)
    rememberSearchResult(storage, recipe)
    rememberSearchResult(storage, task)
    expect(readRecentSearchResults(storage)).toEqual([task, recipe])

    storage.setItem('lifeops.search.recent', '{broken')
    expect(readRecentSearchResults(storage)).toEqual([])
  })
})
