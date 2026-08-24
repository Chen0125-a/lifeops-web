import { describe, expect, it } from 'vitest'
import type { PortablePayload } from '../../domain/lifeCommerce'
import type { Review } from '../../domain/reviews'
import {
  parseLifeProjectionMarkdown,
  projectLifeKnowledge,
  serializeLifeProjection,
  type LifeProjectionDocument,
} from './lifeProjection'

const updatedAt = '2026-08-22T08:00:00.000Z'

const payload = {
  catalogItems: [],
  inventoryTransactions: [{ id: 'inventory-secret', idempotencyKey: 'never-export-this' }],
  shoppingItems: [{
    id: 'shopping-1', kind: 'formal', itemId: 'rice', requestedQuantity: 2, purchasedQuantity: 1,
    remainingQuantity: 1, unit: 'kg', neededOn: '2026-08-24', priority: 'high', storeGroup: '市场',
    status: 'partial', version: 3, createdAt: updatedAt, updatedAt,
  }],
  purchases: [],
  refunds: [],
  budgets: [{
    id: 'budget-1', name: '八月餐食', scope: { kind: 'all-life' },
    period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
    limitMinor: 120000, thresholds: [0.7, 0.9], rolloverMinor: 0, version: 2, createdAt: updatedAt, updatedAt,
  }],
  recipes: [{
    id: 'recipe/番茄蛋', name: '番茄炒蛋', description: '家常做法', coverMediaId: null,
    prepMinutes: 8, cookMinutes: 6, difficulty: 'easy', categoryId: null, tagIds: ['家常'], storageNotes: '当天食用',
    entityVersion: 4, currentVersion: {
      id: 'recipe-version-4', recipeId: 'recipe/番茄蛋', number: 4, servings: 2, yieldQuantity: null, yieldUnit: null,
      components: [{ id: 'component-1', itemId: 'tomato', quantity: 300, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{ id: 'step-1', instruction: '低火炒熟', ingredientItemIds: ['tomato'], durationSeconds: 180, imageMediaId: null, caution: '避免飞溅', position: 0 }],
      promotedNote: null, createdAt: updatedAt,
    },
    createdAt: updatedAt, updatedAt, deletedAt: null,
    password: 'never-export-password',
  }],
  cookingSessions: [{
    id: 'cook-1', recipeId: 'recipe/番茄蛋', recipeVersionId: 'recipe-version-4', plannedServings: 2,
    note: '下次少放一点盐', entityVersion: 2, progress: { currentStepIndex: 1, completedStepIds: ['step-1'], actualIngredients: [], timers: [] },
    status: 'completed', createdAt: updatedAt, completedAt: updatedAt, sessionToken: 'never-export-token',
  }],
  fitnessActivities: [{
    id: 'fitness-1', name: '室内骑行', defaultMinutes: 35, kcalPerHour: 420, intensity: 'moderate',
    steps: ['热身', '稳定骑行'], equipment: ['单车'], entityVersion: 2, createdAt: updatedAt, updatedAt,
  }],
} satisfies PortablePayload

const reviews: Review[] = [{
  id: 'review-1', type: 'weekly', period: { from: '2026-08-15', to: '2026-08-21' }, status: 'draft',
  achievements: ['保持记录'], problems: ['睡眠偏晚'], causes: ['晚间任务过多'], insights: ['提前收尾'], nextChanges: ['22:30 停止工作'],
  evidence: {
    period: { from: '2026-08-15', to: '2026-08-21' }, goals: { active: 1, completed: 0 }, projects: { active: 1, completed: 0 },
    tasks: { total: 4, completed: 3, skipped: 0, cancelled: 0 }, habits: { entries: 5, done: 4, partial: 1, intentionalSkips: 0 },
    records: { total: 2, ids: ['record-private'] }, priorCommitments: [], hasFacts: true,
  },
  actions: [], version: 3, createdAt: updatedAt, updatedAt, deletedAt: null,
}]

describe('Life knowledge projection', () => {
  it('uses stable encoded paths and deterministic required frontmatter', () => {
    const first = projectLifeKnowledge({ payload, reviews })
    const second = projectLifeKnowledge({ payload, reviews })
    expect(first).toEqual(second)
    const recipe = first.find((document) => document.type === 'recipe')!
    expect(recipe.path).toBe('LifeOps/Life/Recipes/recipe%2F%E7%95%AA%E8%8C%84%E8%9B%8B.md')
    const markdown = serializeLifeProjection(recipe)
    expect(markdown).toContain('lifeops_id: "recipe/番茄蛋"')
    expect(markdown).toContain('type: "recipe"')
    expect(markdown).toContain('version: 4')
    expect(markdown).toContain(`updated_at: "${updatedAt}"`)
    expect(markdown).toContain('  - "家常"')
    expect(parseLifeProjectionMarkdown(markdown, recipe.path)).toEqual(recipe)
  })

  it('creates readable documents for every approved type while excluding raw and secret fields', () => {
    const documents = projectLifeKnowledge({ payload, reviews })
    expect(documents.map(({ type }) => type)).toEqual([
      'budget-summary', 'cooking-note', 'fitness-summary', 'life-review', 'recipe', 'shopping-summary',
    ])
    const joined = documents.map(serializeLifeProjection).join('\n')
    expect(joined).toContain('# 番茄炒蛋')
    expect(joined).toContain('低火炒熟')
    expect(joined).toContain('下次少放一点盐')
    expect(joined).toContain('室内骑行')
    expect(joined).toContain('保持记录')
    expect(joined).toContain('八月餐食')
    expect(joined).toContain('剩余数量')
    expect(joined).not.toContain('inventory-secret')
    expect(joined).not.toContain('never-export-this')
    expect(joined).not.toContain('never-export-password')
    expect(joined).not.toContain('never-export-token')
    expect(joined).not.toContain('record-private')
  })

  it('exports only explicitly selected projection types', () => {
    const documents = projectLifeKnowledge({ payload, reviews, selectedTypes: ['recipe', 'budget-summary'] })
    expect(documents.map(({ type }) => type)).toEqual(['budget-summary', 'recipe'])
  })

  it('rejects identity-changing or unsupported frontmatter during round trip', () => {
    const document: LifeProjectionDocument = {
      lifeopsId: 'recipe-1', type: 'recipe', version: 1, updatedAt, title: 'Recipe', tags: [], body: '# Recipe',
      path: 'LifeOps/Life/Recipes/recipe-1.md',
    }
    const markdown = serializeLifeProjection(document)
    expect(() => parseLifeProjectionMarkdown(markdown.replace('type: "recipe"', 'type: "platform-secret"'), document.path)).toThrow(/type/i)
    expect(() => parseLifeProjectionMarkdown(markdown.replace('version: 1', 'version: 0'), document.path)).toThrow(/version/i)
  })
})
